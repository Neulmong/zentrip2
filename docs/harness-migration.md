# 하네스 전환 계획 — 스킬·에이전트를 런타임 실행 근거로 만든다

**권위:** `spec.md` 2.6이 여전히 유일한 권위다. 이 문서는 spec을 바꾸지 않고, spec을 **어디에 적어두는지**를 바꾼다.

---

> ## 📌 이어서 작업하려면 **§7부터** 읽는다
>
> **§0~§6은 계획 문서이고 전환은 이미 끝났다.** 설계 판단의 근거로 남겨둔 것이며,
> 그 안의 수치(스킬 16개·라우트 7개·AI 6회…)와 「지금 건드리지 않는다」류의 문장은
> **8/12 낮 시점의 기록이다.** 현재 상태는 §7이 갖는다.
>
> | 궁금한 것 | 어디 |
> |---|---|
> | 지금 어떻게 돌아가나 | §7.1 |
> | 무엇이 검증됐나 | §7.2 |
> | **무엇이 남았나** | **§7.3 ⑤** |
> | 처음 여는 사람이 할 일 | §7.4 |
>
> 전환 당시(8/12 낮) 상태: 라우트 7 · 스킬 21 · AI 6회.
> **현재(8/12 밤): 라우트 10 · 스킬 24 · AI 5회 · 검사 155건 · 미구현 0.**

---

## 0. 전환 착수 시점의 상태 (2026-08-12 낮 · 히스토리)

| 대상 | 런타임 사용 |
|---|---|
| `.claude/skills/` 16개 | **0건.** `app/`·`lib/`·`components/` 어디도 참조하지 않는다 |
| `.claude/agents/` 5개 | **0건.** 서브에이전트를 스폰하는 라우트가 없다 |
| DeepSeek | 6곳 — `/decompose`·`/brochure`·`/validate-brochure`·`/page`·`/validate-page`·`/validate-consistency` |

스킬의 규칙은 이미 TS 순수 모듈로 **흡수**되어 있다(`lib/pipeline/*`, `lib/logging.ts`, `lib/orchestrator.ts`).
즉 지금 구조는 "스킬을 안 쓴다"가 아니라 **"스킬을 사람이 손으로 코드에 베껴 넣었다"** 다.
전환의 목표는 베낀 사본을 지우고 원본을 실행하게 만드는 것이다.

### 이미 있는 발판 3개

1. 6개 AI 호출이 전부 `lib/ai`의 provider 중립 인터페이스 하나(`ai().call`)를 통과한다 — 갈아끼울 지점이 1곳이다.
2. 각 AI 호출이 이미 `label`로 **스킬 이름**을 붙이고 `execution_logs`에 남긴다
   (`itinerary-decomposition`·`content-structuring`·`consistency-check`·`fact-check-1/2`·`intro-overview`).
3. `runStep`(`lib/orchestrator.ts`)이 재시도 카운터·409·이상 플래그·조건부 갱신을 이미 spec 2.6대로 처리한다.

### 넘을 벽

`.claude/**`는 **Claude Code CLI만 읽는 파일**이다. Vercel 서버리스 함수는 이 디렉터리를 트레이싱하지 않으며
(어느 모듈도 import하지 않으므로 번들에 포함되지 않는다) SKILL.md를 해석해 실행하는 능력도 없다.
따라서 **전달 경로**와 **의미 해석**을 우리가 만들어야 한다.

---

## 1. 전달 — 빌드 타임 코드젠

`scripts/build-harness.mts`가 `.claude/**`를 읽어 `lib/harness/generated/registry.ts`를 생성한다.
`prebuild`·`predev`에 물린다. 산출물은 커밋한다(빌드에서 재생성하고 drift를 검사한다).

`fs.readFile`을 런타임에 쓰지 않는 이유 3가지:

1. **번들 트레이싱** — `.claude/**`는 import되지 않아 Vercel 번들에 없다. `outputFileTracingIncludes`로 우겨넣을 수는 있지만 핫 패스에 비동기 IO가 들어간다.
2. **캐시 적중** — 시스템 프롬프트는 요청 간 **바이트 단위로 동일**해야 한다(실측 913 중 896 적중). 동결된 문자열 상수는 이를 보장하고, 파일 읽기는 EOL·인코딩 드리프트 위험을 안는다. **이 저장소는 Windows다** — 코드젠은 CRLF를 `\n`으로 정규화해 프롬프트 바이트를 고정한다.
3. **실패 시점** — SKILL.md가 망가졌으면 **빌드가 죽는다.** 데모 중 런타임 500보다 낫다.

---

## 2. 의미 — 매니페스트와 프롬프트의 분리

SKILL.md 본문은 이미 두 종류의 내용이 섞여 있다.

| 섹션 | 성격 | 하네스에서의 용도 |
|---|---|---|
| `## 목적`·`## 판정 규칙`·`## 금지 사항`·`## 출력`·규칙 표 | AI에게 줄 지시 | **시스템 프롬프트 본문** |
| `## 실행 조건`(호출 주체·AI 호출 횟수)·`## 산출물`(로그·전달 대상) | 배선 정보 | **매니페스트** |

그래서 프롬프트에 배선 정보가 섞이지 않게, 매니페스트가 **어느 섹션을 프롬프트로 쓸지 지정**한다.
코드젠은 지정된 `##` 섹션만 원문 그대로 뽑아 이어붙인다. 문서 하나가 사람과 런타임 양쪽을 만족한다.

### 매니페스트는 `.claude/harness/manifest.json` 하나다 (확정 · 2026-08-12)

frontmatter에 `harness:` 키를 넣는 방식을 검토했으나 **중앙 파일 하나로 결정**했다. 이유 3가지:

1. **불변식이 그래프 수준이다.** 라우트당 AI 예산, 체인 순서, 고아 스킬, `spec` 스킬이 체인에 섞였는지 —
   전부 여러 스킬을 동시에 봐야 판정된다. 16개 파일에 흩어져 있으면 검사기가 전부 읽어 재조립해야 한다.
2. **YAML 파서가 필요 없다.** `package.json`에 YAML 의존성이 없다. JSON이면 `JSON.parse`로 끝나고,
   SKILL.md에서는 frontmatter를 건너뛰고 `##` 섹션만 뽑으면 되므로 파서를 쓸 일이 아예 없다.
3. **Claude Code의 frontmatter 미지 키 처리에 의존하지 않는다.** 이틀 남은 일정에서 확인되지 않은
   전제를 21개 문서에 심지 않는다.

`kind`가 세 값인 이유: 20개 스킬이 같은 성격이 아니다.

| `kind` | 개수 | 성격 |
|---|---:|---|
| `mechanical` | 11 | AI 0회. `impl`이 가리키는 순수 함수가 실행된다 |
| `ai` | 5 | SKILL.md의 지정 섹션이 **시스템 프롬프트 그 자체**다 |
| `spec` | 4 | `runStep`·`logging.ts`가 이미 수행하는 규정. **체인에서 실행되지 않는다** |

`spec`을 체인에 끼우면 로그가 두 번 쌓인다. 하네스는 이들을 실행하지 않고 `implemented_by` 대상이
계속 존재하는지만 검사한다.

`routes`가 맵인 이유: `validator-agent` 하나가 라우트 3개(`validate-brochure`·`validate-page`·
`validate-consistency`)를 담당한다. 에이전트를 3개로 쪼개면 문서의 통일성이 깨지므로, 문서 1개에 라우트 3개를 둔다.

### 라우트가 7개가 됐다

`POST /api/products`(라우트 ①)를 하네스에 넣었다. `input-guard`의 자리는 폼 제출 라우트이지
분해 라우트가 아니다 — 2.2 문서가 이 스킬을 Step 02에 배치한 것은 웹 폼이 없던 시절의 배선이다.
`ai_budget: 0`인 라우트가 하나 생기며, 이것이 규약 R3(mechanical이 기본)의 실례가 된다.

---

## 3. 런타임

```
lib/harness/
  generated/registry.ts   ← 코드젠 산출물. 동결된 프롬프트 문자열 + 파싱된 매니페스트
  loader.ts               ← 매니페스트 타입·조회. registry 외부를 읽지 않는다
  impls.ts                ← mechanical 스킬 이름 → 순수 함수 등록표
  run.ts                  ← runAgent()
```

`runAgent(agentName, routeKey, product)`:

1. 매니페스트를 로드한다. 없으면 **throw** (빌드 검사를 통과했다면 발생하지 않는다).
2. `skills`를 선언 순서대로 실행한다.
3. **각 스킬 실행 전에 누적 `ai` 합계를 `ai_budget`과 대조하고, 초과하면 throw.**
   절대원칙 1(1요청 1AI호출)이 지금은 사람이 지키는 규율인데, 하네스에서는 **코드가 강제한다.**
4. `kind: ai` 스킬은 registry의 동결 프롬프트를 `system`으로, 선언된 schema·effort로 `lib/ai`를 호출한다.
5. `kind: mechanical` 스킬은 `impls.ts`의 함수를 호출하고, 선언된 `asserts`를 반환값에 대해 검사한다.
6. 결과를 `StepOutcome`으로 변환한다.

### 손대지 않는 것

`lib/orchestrator.ts`(`runStep`)·`lib/logging.ts`·`lib/policy.ts`·`lib/ai/*`·`lib/client/run-pipeline.ts`.

재시도 카운터 4종·409 `reason` 5종·이상 플래그 5종·조건부 갱신·클라이언트 재개 표는 이미 spec 2.6대로
구현되고 4개 스위트로 검증됐다. 하네스는 `runStep`의 **`work` 콜백 안쪽만** 대체한다.
**이것이 이틀 안에 되는 유일한 이유다.** 하네스가 상태 기계까지 삼키면 검증을 처음부터 다시 해야 한다.

### 전환 후 라우트

```ts
export const maxDuration = 60

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runStep(
    agentStepConfig('intake-agent', 'decompose', { productId: id, clientUpdatedAt: await readUpdatedAt(req) }),
    (p) => runAgent('intake-agent', 'decompose', p),
  )
}
```

`decompose/route.ts`는 148행에서 약 12행이 된다. **라우트 코드에 프롬프트가 없다** — 이것이 판정선이다.

### 프롬프트의 이동

`lib/pipeline/ai-contracts.ts`의 `*_SYSTEM` 상수 6개를 **삭제**하고 SKILL.md 본문으로 옮긴다.
`*_SCHEMA`와 `interface`는 TS에 남긴다 — 타입과 짝이어야 하고, SKILL.md는 스키마의 **이름만** 지정한다.

`intro-overview` 라벨에 대응하는 스킬이 없다. `intro-content-fill`의 `kind`를 `ai`로 올려 흡수한다
(§8.7에서 `source: "generated"`인 필드는 `overview.핵심일정` 하나뿐이므로 이 스킬의 자연스러운 일이다).

---

## 4. 문서 재기준화 — 21개

하네스가 문서를 실행하는 순간, **문서의 틀린 값이 그대로 실행된다.** 실측한 2.2 잔재:

| 잔재 | 해당 문서 | 2.6 값 |
|---|---|---|
| 재시도 카운터 3종 | `abnormality-detection`·`data-normalization`·`fact-check`·`product-orchestrator` | **4종** `normalization`·`brochure`·`page`·`consistency`, 예산 비공유 (§11.6) |
| `verdict` 한글 저장 | `execution-log-collection`·`input-guard`·`itinerary-decomposition`·`web-content-structure-gen` | 저장은 `pass`/`fail`/`-`, 화면에서만 한글 (§5.4) |
| 여행기간 단일 필드 | `input-guard` | `form_input`은 `여행기간_시작`·`여행기간_종료` 2필드 (§6.2.1) |
| 카운터 3종 표기 | `intake-agent.md` | 위와 동일 |

CLAUDE.md도 함께 뒤집는다. `.claude/`는 더 이상 "🚫 구현 중 참조 금지"가 아니라 **구현의 실행 근거**다.
`origin-spec.md`의 지위(히스토리)는 그대로다.

### 신규·수정 (완료 · 2026-08-12)

**신설 스킬 5개** — 전부 `kind: mechanical`(AI 0회). 규약 R2에 따라 기존 스킬에서 쪼개거나
라우트 코드에 흩어져 있던 단일 기능을 스킬로 올렸다.

| 스킬 | 출처 | 단일 기능 |
|---|---|---|
| `optional-field-fill` | `input-guard`에서 분할 | 선택 4항목 `추후 추가 예정` 채움 |
| `axis0-verification` | `decompose` 라우트 코드에서 승격 | 0차 기계 검증 4종 |
| `brochure-contract-check` | `checkBrochure` 승격 | 소개서 구조 계약 4종 |
| `page-contract-check` | `checkPage` 승격 | 페이지 구조 계약 4종 |
| `slug-issue` | `web-content-structure-gen`에서 분할 | slug 발급 |

**성격 변경 2건**

| 스킬 | 변경 | 이유 |
|---|---|---|
| `intro-content-fill` | `kind: ai`로 확정 · `intro-overview` 라벨 흡수 | §8.7에서 `source: "generated"`인 필드는 `overview.핵심일정` 하나뿐이다 |
| `tonal-manner-apply` | 어투 다듬기 → **보호값 검증**(AI 0회) | 어투는 뼈대의 고정 문형이 이미 결정한다. 남은 실질은 이 스킬 자신의 "변경 0건 확인" 조항이다 |

**`kind: spec` 4건** — `product-orchestrator`·`execution-log-collection`·`abnormality-detection`·
`draft-registration`. `runStep`·`logging.ts`가 이미 수행하므로 체인에서 실행하지 않는다(R7).

**삭제 0건.** `grill-me`는 삭제 후보였으나 **취소했다** — `disable-model-invocation: true`가 붙은
`/grill-me` 슬래시 커맨드 진입점이고 6줄로 `/grilling`을 호출하는 의도된 shim이다. 중복이 아니다.
`grilling`과 함께 파이프라인 밖이므로 매니페스트 대상에서 제외한다.

### AI 예산 검산 (검증 통과 · 2026-08-12)

| 에이전트 · 라우트 | 스킬 체인 | 합계 |
|---|---|---:|
| `intake-agent` · products | input-guard(0) | **0** |
| `intake-agent` · decompose | optional-field-fill(0) → data-normalization(0) → itinerary-decomposition(**1**) → axis0-verification(0) | 1 |
| `content-writer-agent` · brochure | intro-content-fill(**1**) → intro-template-writer(0) → tonal-manner-apply(0) → brochure-contract-check(0) | 1 |
| `validator-agent` · validate-brochure | fact-check(**1**) | 1 |
| `web-builder-agent` · page | theme-design-token-match(0) → content-structuring(**1**) → web-content-structure-gen(0) → page-contract-check(0) → slug-issue(0) | 1 |
| `validator-agent` · validate-page | fact-check(**1**) | 1 |
| `validator-agent` · validate-consistency | consistency-check(**1**) | 1 |

**대본 1회 AI 총합 = 6회. 전환 전과 동일하다.** 스킬을 11개 늘렸지만 늘어난 것은 전부
`kind: mechanical`이므로 API 호출은 1건도 늘지 않았다 — 규약 R3이 설계에 반영된 결과다.

`log-monitor-agent`는 라우트를 갖지 않는다 — `kind: spec` 스킬들의 소유자로 남고 `runStep`이 수행한다.

### 체인 순서에서 AI의 자리

| 라우트 | AI 위치 | 이유 |
|---|---|---|
| `brochure` | **1번(맨 앞)** | 조립이 `핵심일정` 값을 필요로 한다 |
| `decompose` | 3번 | 정규화된 `일정원문`이 있어야 분해한다 |
| `page` | 2번 | 테마는 독립, 조립은 확장 서술을 기다린다 |

**공통 원칙: AI는 조립 전에 서술만 만들고, 값 필드는 기계가 채운다.** 2.2 문서들이
"같은 프롬프트의 연속 단계"로 1AI호출 제약을 우회했던 지점이 전부 이 형태로 풀렸다.

### API 호출을 더 줄일 여지 (데모 후)

`consistency-check`(3차)는 기계 대조로 내릴 여지가 있다 — 페이지가 소개서 값을 코드로 승계하므로
> **⚠️ 이 판단은 뒤집혔다 — §7.3 ③을 보라.** 아래는 8/12 낮 시점의 기록이다.
> 실제로는 `source` 경로를 조인 키로 쓰면 기계 대조가 성립하고, 그렇게 전환했다(AI 6 → 5회).

대조가 거의 항등식이다. 성공하면 대본당 AI 6회 → 5회. **지금 건드리지 않는다:** 3차 축의 의미와
§20 1:15의 4축 검증 배지가 바뀌므로, 데모 대본이 검증된 상태를 흔들 수 없다.

---

## 5. 검증 — 하네스가 진짜인지 증명한다

`npm run test:harness` 신규. 4개 검사:

1. **프롬프트 부재** — `app/api/**/route.ts`에 프롬프트 문자열이 0건. `ai-contracts.ts`에 `*_SYSTEM` export가 0건.
2. **AI 예산** — 모든 에이전트·라우트 조합의 `ai` 합계 ≤ 1. 하나라도 넘으면 실패.
3. **load-bearing 증명** — SKILL.md 본문 한 글자를 바꾸면 registry의 프롬프트 해시가 바뀐다. 안 바뀌면 문서가 장식이라는 뜻이므로 실패.
4. **drift** — 커밋된 `registry.ts`가 현재 `.claude/`와 일치. `kind: spec` 스킬의 `implemented_by` 대상이 존재.

기존 `npm run test:policy`·`npm run test:demo`는 **그대로 통과해야 한다.** 이것이 전환의 합격선이다.

---

## 6. 일정과 되돌림

| 날짜 | 작업 |
|---|---|
| 8/12 | frontmatter 로드 확인 → 매니페스트 스키마 확정 → 문서 21개 재기준화 → `build-harness.mts` |
| 8/13 오전 | `lib/harness/` 구현 → `decompose` **1개만** 전환 → `test:demo` 통과 확인 |
| 8/13 오후 | 남은 라우트 5개 순차 전환 (커밋 1개 = 라우트 1개) → `test:policy`·`test:harness` |
| 8/14 오전 | 예비 · 데모 |

### 되돌림 장치

되돌릴 시간이 없는 것이 최대 리스크다. 그래서:

- **커밋 1개 = 라우트 1개.** 6개를 한꺼번에 바꾸지 않는다. 각 커밋 뒤 `test:demo`를 돌린다.
- **첫 전환 커밋에서 프롬프트 바이트는 정확히 동일해야 한다.** 문면을 다듬는 것은 데모 후다.
  현재 프롬프트로 §20 대본 통과와 DeepSeek 캐시 적중이 실측됐다. 하네스 전환과 프롬프트 변경을
  같은 커밋에 넣으면 실패했을 때 원인을 분리할 수 없다.
- `git tag demo-fallback`을 전환 시작 전 커밋에 붙인다. 8/13 오후까지 `test:demo`가 안 통과하면 그 태그로 시연한다.

### 남는 정직한 한계

`kind: mechanical` 스킬에서 SKILL.md는 **프롬프트가 아니라 명세 + 배선**이다. 실제 변환은 TS 함수가 한다.
문서를 고쳐도 `impl` 함수의 동작이 자동으로 바뀌지는 않는다 — 바뀌는 것은 체인 순서, 배선, `asserts` 검사다.
AI 호출 0회를 유지하려면(절대원칙 1·§4.2) 이 한계는 피할 수 없다. 모든 스킬을 AI로 돌리면
요청당 호출이 3배가 되고 페이지 확장이 이미 §5.5의 20초 임계에 붙어 있으므로 데모가 깨진다.
`kind: ai` 스킬 6개에서는 SKILL.md가 프롬프트 **그 자체**이며, 이쪽이 문서가 완전히 load-bearing인 지점이다.

---

# 7. 인계 — 2026-08-12 시점 (여기서 멈췄다)

**전환은 끝났다.** 이 절부터는 계획이 아니라 **실제로 무엇이 되어 있고 무엇이 남았는지**의 기록이다.
다른 사람이 이 폴더를 열었을 때 이 절만 읽으면 이어서 작업할 수 있어야 한다.

## 7.1 지금 어떻게 돌아가는가

```
POST /api/products/{id}/decompose        ← 라우트는 3줄이다
  └ runAgent('decompose', {req, productId})       lib/harness/run.ts
      ├ routeSpec()                              .claude/harness/manifest.json 조회
      ├ applyEntry()                             manifest.entry (page 라우트만)
      └ runStep()                                 lib/orchestrator.ts — 하네스 바깥(R7)
          └ runChain()                            선언된 순서대로 스킬 실행
              ├ optional-field-fill      mechanical  AI 0회
              ├ data-normalization       mechanical  AI 0회
              ├ itinerary-decomposition  ai          AI 1회 ← 예산 대조 후 호출
              └ axis0-verification       mechanical  AI 0회
          └ OUTCOME['decompose']                   lib/harness/agents/intake-agent.ts
                                                   → StepOutcome (응답코드·복귀 경로)
```

**무엇이 어떤 순서로 실행되는지는 코드가 아니라 `manifest.json`이 답한다.**
하네스가 구동하는 라우트 6개는 자기 이름만 안다. 프롬프트는 SKILL.md에만 있고
빌드 타임에 구워진다.

| 파일 | 역할 |
|---|---|
| `.claude/harness/manifest.json` | 🔒 배선의 유일한 출처. **라우트 10 · 에이전트 5 · 스킬 24** |
| `.claude/skills/<n>/SKILL.md` | 🔒 `## 프롬프트` 펜스 = 시스템 프롬프트, `## user 지시문` 펜스 = user 지시문 (ai 스킬 **4개**) |
| `lib/harness/generated/registry.ts` | 자동 생성. 직접 편집 금지 — `npm run build:harness`가 덮어쓴다 |
| `lib/harness/run.ts` | `runAgent` — 라우트가 부르는 유일한 함수. 체인 실행 + `asserts` 평가 |
| `lib/harness/loader.ts` | 매니페스트 조회 · `assertBudget`(R3) · `promptOf`/`userPromptOf`(R4) · `agentOf` |
| `lib/harness/context.ts` | 스킬 체인이 공유하는 자료 버스. 스킬은 서로를 모른다 |
| `lib/harness/impls.ts` | mechanical 스킬 **12종** 등록표 |
| `lib/harness/ai-skills.ts` | ai 스킬 **4종**. system·user 지시문 모두 문서에서 온다 |
| `lib/harness/asserts.ts` | 스킬 계약 평가기. 매니페스트 `asserts`를 **실행한다** |
| `lib/harness/agents/*.ts` | 라우트별 `StepOutcome` 매핑 — 응답코드는 에이전트의 일 |
| `lib/harness/materials.ts` | DB 재료 적재. 스킬을 순수 함수로 남긴다 |

**라우트 10개 중 4개는 하네스가 구동하지 않는다**(`driven_by: "route"`) —
`products`·`form-input`·`content`·`slug`. 배선을 문서에 남기려고 등록했을 뿐,
`runChain`은 그 체인을 돌리지 않는다. 자세한 이유는 §7.3 ②.

## 7.2 실측 검증 (2026-08-12)

```
npm run test:demo      43 통과 · 0 실패   ← §20 대본 관통. **AI 5회**
npm run test:harness  155 통과 · 0 실패 · **미구현 0**   (8/12: 103 → 155)
npm run test:policy   265 통과 · 0 실패                  (8/12: 247 → 265)
npm run test:exhaustion 12 통과 · 0 실패  ← AI를 일부러 실패시킨 서버가 필요하다
npx tsc --noEmit       0
npm run lint           0
npm run build          통과
```

**8/12 재검증** — `test:demo`를 여러 번 돌렸고 전부 43 통과 · 0 실패다.
첫 실행 2:22(dev 라우트 컴파일 포함, `validate-page` 409 → 재시도 통과),
예열 후 1:28. 이상 플래그는 §7.3 ④의 이유로 뜰 수 있으며 정상이다.

`test:demo`는 **개발 서버가 떠 있어야 한다.** 4축 전부 pass → draft → 게시 →
비로그인 `/p/{slug}` → 신청 → 이메일 → 로그 14행 순서까지 확인된다.

### ⚠️ dev 서버가 죽으면 페이지가 전부 500이 된다

첫 관통 시도에서 실패 9건이 났고 원인은 코드가 아니라 **고아 dev 서버**였다.
`.next/dev/logs/next-development.log`에 `write EPIPE`가 10초마다 쌓이면
그 서버의 렌더 워커가 죽은 상태이며(`Jest worker encountered 2 child process
exceptions`) 모든 React 페이지가 500을 낸다. **API 라우트는 정상 응답하므로
파이프라인 테스트만 보면 정상으로 보인다.**

`/p/존재하지-않는-slug`가 404가 아니라 500이면 그 상황이다. 서버를 재시작한다.

## 7.3 무엇이 끝났고 무엇이 남았나

**2026-08-12 시점에 계획된 항목은 전부 끝났다.** 아래 ①~④는 그 기록이고,
**지금 남은 일은 ⑤에 있다.** 이어서 작업하려면 ⑤부터 읽는다.

### ① 문서 재기준화 — **완료 (2026-08-12)**

`.claude/`가 실행 근거이므로 **문서에 남은 2.2 값은 그대로 실행된다.** 전수 점검해서 닫았다.
코드 동작은 처음부터 2.6대로 맞았고, 고친 이유는 **다음 사람이 문서를 믿고 옛 값으로 구현하는 것**을
막기 위해서다. 근거는 CLAUDE.md의 「2.2 → 2.6에서 뒤집힌 값」 대조표.

| 파일 | 고친 것 |
|---|---|
| `agents/content-writer-agent.md` · `web-builder-agent.md` | **체인 표에서 `memo-leak-check`가 빠져 있었다.** `slug-issue`도 5번으로 잘못 적혀 있었다(실제 6번) |
| `skills/product-orchestrator/SKILL.md` | 카운터 3종 → **4종**, 「0차는 `brochure` 공유」 → **`normalization`** · 409 `reason` 5종 표 신설 · 선행 조건표를 `current_step` → **재료 기준**(§14.5) |
| `skills/abnormality-detection/SKILL.md` | `retry_counts` 4종 · 중복 범위 `(step,type)` → **`(execution_id, attempt_no, step, type)`** |
| `skills/web-content-structure-gen/SKILL.md` | 길이 계약 **생성 시 6종 → 4종**(§17.1) · slug 발급 절 삭제(→ `slug-issue`) · 출력에서 slug·길이판정 제거 |
| `skills/tonal-manner-apply/SKILL.md` | 「어투를 다듬는다」 → **보호값 검증 전용**(AI 0회). 이름만 유지 |
| `skills/intro-content-fill/SKILL.md` | 「전 필드 치환」 → **`overview.핵심일정` 하나만**. 체인 2번 → **1번** |
| `skills/intro-template-writer/SKILL.md` | 체인 1번 → **2번** · 시작 조건 `current_step` → 재료 기준 · 값 치환이 여기 |
| `skills/content-structuring/SKILL.md` · `theme-design-token-match/SKILL.md` | 순서가 서로 뒤집혀 있었다(1↔2) |
| `skills/input-guard/SKILL.md` | 선택 항목 채움 주장 삭제(→ `optional-field-fill`) · `decompose` 체인 → **라우트 ①** |
| `skills/data-normalization/SKILL.md` · `itinerary-decomposition/SKILL.md` | `## 실행 조건` → `## 배선`(매니페스트를 가리키게) |
| `CLAUDE.md` | AI 소요 시간표를 **probe 수치 → 실제 파이프라인 수치**로 (아래 ④) |

**스킬 5개의 `## 프롬프트` 펜스는 한 글자도 건드리지 않았다** — 해시 5개가 전부 그대로이고
DeepSeek 캐시 적중이 유지된다. 고친 것은 전부 사람이 읽는 산문·표다.

「스킬 두 개가 AI 호출 1회를 나눠 쓴다」는 2.2식 서술이 4개 문서에 있었다. 하네스에서는
성립하지 않는다 — `ai_budget`은 **스킬 단위**로 대조된다(R3). 전부 「AI는 이 스킬 하나가
쓰고 나머지는 AI 0회」로 고쳤다.

### ①-b 검사기 보강 — **완료**

위 `memo-leak-check` 누락은 **`test:harness` 103건이 전부 통과하는 상태에서 살아 있었다.**
검사기가 매니페스트↔코드만 대조하고 **에이전트 문서는 안 봤기 때문**이다.

`scripts/test-harness.mts`에 **§10 「에이전트 문서의 체인 표 ↔ 매니페스트」** 를 추가했다.
표의 스킬 목록·순서·번호가 매니페스트와 다르면 실패한다. 라우트가 없는
`log-monitor-agent`는 `owns_spec_skills`와 대조하고 전부 `kind: spec`인지도 본다.

역검증했다 — 표에서 `memo-leak-check` 한 줄을 지우면 그 항목만 정확히 실패한다.

검사 총계: **103 → 117건.**

### ①-c 완성도 감사 — **완료 (2026-08-12 밤)**

데모를 빼고 완성도만 보고 전수 감사했다. 결함 3건과 구조 문제 3건을 고쳤다.

| # | 무엇이 잘못됐나 | 고친 곳 |
|---|---|---|
| 1 | **성공 시 `retry_index`가 틀렸다.** 실패가 아니면 카운터가 `'brochure'`로 고정돼, 0차를 2번 재시도한 뒤 성공하면 회차가 0으로 남았다 — 재시도했다는 사실이 로그에서 사라졌다(§5.4) | `orchestrator.ts` `StepConfig.counter` 신설 · `run.ts`가 매니페스트 `counter`를 전달 |
| 2 | **하지도 않은 작업이 통과로 기록됐다.** 추가 단계가 무조건 `verdict: pass`라, AI가 실패해 분해가 없었는데도 `itinerary_decomposed`가 통과로 남았다 | `StepOutcome.extraVerdicts` 신설 · 기본값을 주 판정으로 · 분해 성공 시에만 `intake-agent`가 명시 |
| 3 | **필드 누락을 두 검사가 다 놓쳤다.** `assertFactsUnchanged`는 없는 값을 건너뛰었고 `checkBrochure`는 `data` 방향만 봤다 — 조립부 회귀가 가장 흔히 나타나는 형태에 정확히 구멍 | `brochure.ts` 양쪽 보강 · `test:policy`에 회귀 2건 추가 |
| 4 | **`asserts`가 선언만 되고 실행되지 않았다.** `impls.ts`의 수동 검사는 `Array.isArray()`라 영원히 참이었다 | `lib/harness/asserts.ts` 신설 · `runChain`이 평가 · 빈 검사 삭제 |
| 5 | **`agentOf()`가 죽은 코드였다.** 매니페스트의 `agent` 필드가 런타임에 한 번도 읽히지 않았다 | `runAgent`가 호출 |
| 6 | **`impl`이 구속력이 없었다.** 검사기는 「export되는가」만 봤고 실제 호출은 안 봤다 | `test:harness` §9-1 신설 |

**실증.** ②는 `npm run test:exhaustion`(AI를 일부러 실패시킨 서버)으로 확인했다 —
`itinerary_decomposed`가 이전의 `pass` 자리에 **`fail`** 로 기록된다.
①은 타입·코드 수준에서 고쳤고, 재시도 후 성공하는 시나리오는 AI가 간헐적으로
실패해야 재현되므로 실측하지 못했다.

**`page` 라우트의 중복 조회는 고치지 않았다.** `applyEntry`와 `runStep`이 같은 상품을
두 번 읽지만, 두 번째 읽기는 낭비가 아니라 **안전장치**다 — 그 사이 다른 요청이
갱신하면 첫 번째 행은 이미 낡았고, 낡은 행으로 시작 조건을 판정하면 §16.1.1이
막으려는 상황을 우리가 만든다. 근거를 코드 주석에 남겼다.

검사 총계: **117 → 132건**(라우트 등록 뒤 149건). `test:policy` 247 → 249건.

### ② 미결정 3건 (판단 필요)

| 항목 | 상태 | 판단 |
|---|---|---|
| ~~매니페스트 밖 라우트 3개~~ | **완료** — 아래 참조 | 라우트 7 → 10 · 스킬 21 → 24 |
| `tonal-manner-apply` 유지 | 체인에 있고 정상 산출물에 0건임이 실측됨 | 유지. 회귀 감지용이고 AI 0회다. **문서는 보호값 검증 전용으로 재기준화 완료** |
| `consistency-check`를 mechanical로 내릴까 | 3차 축의 의미와 §20 1:15 검증 배지가 바뀐다 | **미결.** AI 6 → 5로 줄고 예산 여유도 생기지만, 3차 축이 「AI 의미 대조」에서 「기계 값 대조」로 성격이 바뀐다 |

#### 매니페스트 밖 라우트 — 등록 완료 (2026-08-12)

전수 조사해 보니 이전 판본이 적은 `form-input` 하나가 아니라 **3개**였다. 전부 등록했다.

| 라우트 | 신설 스킬 | impl |
|---|---|---|
| `PATCH /form-input` | (기존) `input-guard` | `form-validation#validateFormInput` |
| `PATCH /content` | **`edit-contract-check`** · **`edit-history-diff`** | `edit-contract#validateEdit` · `#diffSections` |
| `PATCH /slug` | **`slug-format-check`** | `pipeline/slug#isValidSlug` |

`lib/edit-contract.ts`가 가장 큰 구멍이었다 — 편집 저장 규칙이 코드에만 있었다.
**생성 시 4종 / 저장 시 6종**이 갈리는 지점이 거기이므로, 새 SKILL.md가 그 관계를
명시하고 `page-contract-check`와 서로를 가리키게 했다.

**`agent: null`을 도입했다.** 편집 저장·주소 변경은 담당 에이전트가 없다 —
에이전트 5종은 전부 생성·검증 주체이고 편집은 그 어느 쪽도 아니다. 억지로 배정하면
그 에이전트 문서가 자기가 하지 않는 일을 설명하게 된다. 대신 `driven_by: "route"`와
짝이어야 하며 코드젠·검사기가 검산한다.

**러너를 만들지 않았다.** `driven_by: "route"` 스킬은 `runChain`이 돌리지 않으므로
`impls.ts` 러너를 쓰면 실행되지 않는 코드가 된다. 검사기를 만족시키려고 죽은 코드를
쓰게 하는 것이 더 나쁘다 — 대신 §9-1이 「그 라우트가 선언한 impl을 실제로 부르는가」를 본다.

### ③ 남은 3건 — **전부 완료 (2026-08-12 밤)**

셋 다 「AI에게 보내는 바이트가 바뀌는」 변경이라 한 묶음으로 처리했다.

| # | 항목 | 결과 |
|---|---|---|
| 1 | `consistency-check`를 mechanical로 | **AI 6 → 5회.** 두 콘텐츠 모델이 같은 `source` 경로를 쓰므로 그것을 조인 키로 기계 대조가 된다 |
| 2 | user 지시문을 SKILL.md로 | **R4 완결 · 미구현 0건.** 변형키(`brochure`/`page`)를 도입해 `fact-check`의 두 지시를 분리 |
| 3 | spec §6.3 판정 3단계 | **구현.** AI가 `핵심표현`을 신고하고 **기계가 근거를 대조해 판정한다** |

#### 「재실측이 필요하다」는 전제가 틀렸다

이전 판본은 셋 다 캐시 적중을 깨므로 `probe:deepseek` 재실측이 필요하다고 적었다.
**DeepSeek 컨텍스트 캐시는 최장 공통 접두를 잡고 system이 앞에 온다** — user 쪽 변경은
system 프리픽스 적중을 깨지 않는다. 2번은 문장을 바이트 그대로 옮겼으므로 user 바이트도
동일하다. 3번만 system 프롬프트가 바뀌어 해시가 갱신됐다(`4f11348221a9` → `1b9a0793e09a`).

#### 3단계를 한 호출 안에서 성립시킨 방법

spec §6.3은 3단계 주체를 「AI(`itinerary-decomposition`의 **호출 1회 안에서**)」로 못박는다.
그런데 2단계는 AI 출력(`내용`)에 대해 도는 검사라 **호출 전에는 후보가 없다.**
한 호출 안에서 되게 하려면 AI가 **미리 신고**하는 수밖에 없다.

| 주체 | 하는 일 |
|---|---|
| AI | `내용`에 쓴 장소·시설·활동·고유명사를 `핵심표현`으로 신고 |
| **기계** | 신고된 표현이 `원문근거`·다른 확정 값에 있는지 대조 → **판정** |

**판정 주체가 기계다.** AI는 근거를 제시할 뿐 통과 여부를 정하지 않으므로 §6.3 마지막
문단(「AI가 자기 생성물을 자기가 검사하는 구조에만 의존하지 않는다」)을 지킨다.

2단계 `위반후보`는 계속 표시만 한다 — `extractNouns`가 동사 활용형을 명사구로 오인하기
때문이다. 신고 목록에는 그 오인이 없다. **그것이 3단계를 하드 실패로 쓸 수 있는 이유다.**

실측(`test:demo`): AI가 `["김해공항","올레 7코스"]`·`["성산일출봉","해녀박물관"]`처럼
고유명사만 정확히 신고했고 활용형은 하나도 섞이지 않았다. 「추후 추가 예정」 일차는 빈 배열.

### ③-b `day` 형식 결함 — **고침 (2026-08-12 밤)**

3단계 데이터를 들여다보다 발견했다. AI가 `day`를 `"1"`이 아니라 **`"1일"`**로
반환하고 있었고 **아무 테스트도 이것을 보지 않았다.**

조용한 결함이 아니다. `buildPage`가 일차별 이미지 슬롯을 `itinerary_day_${day}`로
만드는데 업로드된 슬롯 이름은 `itinerary_day_1`이다. `day`가 `"1일"`이면
`itinerary_day_1일`을 찾게 되어 **일차별 사진이 페이지에 붙지 않는다.**

**원인은 산문과 프롬프트가 갈린 것이다.** SKILL.md 산문은 「`day`는 문자열로
저장한다(`"1"`)」로 규정했지만 **실행되는 `## 프롬프트` 펜스에는 그 규칙이 없었다.**

프롬프트에 규칙을 넣고 `checkDayNumbers`(0차 확정 위반)로 이중화했다. 값을 덮어쓰지
않은 이유: 고치면 **AI가 규칙을 어긴 사실이 사라진다.** 같은 어긋남이 `내용`·
`원문근거`에서 일어나도 알 수 없게 된다.

실증 — 이미지를 올린 채 `decompose → brochure → validate-brochure → page` 관통:

```
day 값       ["1","2","3","4"]
업로드 슬롯   [hero, itinerary_day_1..4]
페이지 슬롯   ["itinerary_day_1","itinerary_day_2","itinerary_day_3","itinerary_day_4"]
```

---

## 7.5 spec 2.7 — 배열화 + 자연어 초안 (2026-08-12 밤~)

**실제 기획 메모 하나를 넣어 보고 시작됐다.** 제주 올레 걷기 축제 상품 · 숙소 2곳 ·
카페·음식점 13곳 · 여행지 포인트 7곳. 2.6 구조로는 담을 자리가 없었다.

### ① `숙박`·`상점`을 객체 배열로

| 무엇 | 2.6 | 2.7 |
|---|---|---|
| 숙소 2곳 | `숙박.숙소명` 한 칸에 병기 | `숙박[]` · 카드 n개 |
| 카페 13곳 | `상점정보` 500자에 문장으로 밀어 넣음(이름+주소만 330자) | `상점[]` · 행마다 `{상점명, 구분, 위치, 상점정보}` |
| 상한 초과 | **값을 잘라야 한다** — §16.1 위반 | 원소가 늘어도 계약이 그대로 |

**`source` 경로에 인덱스를 도입했다**(`숙박[0].숙소명`). 3차 검증이 `source` 문자열을
조인 키로 쓰므로(`consistency.ts`의 `collect`) 인덱스 경로를 쓰면 **원소 단위 대조가
추가 구현 없이 성립한다.** 대가로 **행 순서가 값의 일부**가 됐다 — §7.4가 순서 보존을
규정하고 0차가 행 수 변화를 잡는다.

파급: `lib/pipeline/paths.ts` 신설(경로 해석 단일 출처) · `normalize`·`axis0`·`brochure`·
`page`·`consistency`·`edit-contract` · 렌더러 `CardList` · 편집기 `RowsField` ·
검토 화면(`String(v)`가 `[object Object]`를 찍고 있었다) · SKILL.md 9개 · 에이전트 3개.

**필수 필드를 줄였다**: `객실타입`·`상점정보`를 선택으로 내렸다(§7.2). 행마다 요구하면
객실이 미확정인 숙소나 설명 없는 가게를 **목록에서 빼야** 한다.

### ② 자연어 초안 라우트 #20 (§7.5)

폼 위에 「자연어로 입력」 패널. 메모를 붙여넣으면 AI 1회로 폼을 채운다.
**확정은 사람이 한다** — `form_input`은 [소개서 생성]을 누를 때 §7.1 검증을 거쳐 만들어진다.

`§16.1`을 깎지 않았다. 「입력에 없는 값을 만들지 않는다」는 `form_input` 확정 **뒤**
구간(§8·§9)의 규칙이고, 초안은 그 앞이며 사이에 사람의 검토가 있다.

체인 4단계 · `planner-agent` 신설:

```text
freeform-parse(0) → trip-planning(AI 1) → draft-assemble(0) → draft-form-check(0)
```

`runStep` 밖이다 — 상품 행이 없어 로그·카운터·조건부 갱신의 대상이 없다.
`lib/harness/draft.ts`가 같은 규율(매니페스트 순서 · `assertBudget` · `promptOf`)로 돌린다.

### ③ 세 번의 실패에서 나온 설계 — 여기가 이 절의 핵심이다

처음 구현은 **AI가 폼 값을 직접 쓰게** 했다. 세 번 연속 실패했고, 그때마다 원인이
설계였다. 되돌리지 않도록 근거를 남긴다.

| # | 증상 | 원인 | 고친 방식 |
|---:|---|---|---|
| 1 | `max_tokens` · 62초 · 본문 0자 | AI가 카페 13곳의 **이름·주소를 다시 타이핑**했다 | 후보 **번호만** 고르게 하고 값 치환을 `draft-assemble`로 (R3의 mechanical) |
| 2 | 여전히 8000 토큰 전부 추론 · 본문 0자 | **번호와 산문을 함께** 요구했다. 제약 만족 + 작문이 한 호출에 섞임 | `일정원문`도 AI에서 뺐다. AI는 `일정: [{day, 후보[]}]`만 정하고 문장은 기계가 조립 |
| 3 | `low`·`minimal`·파라미터 없음 **전부** 본문 0자 (63~74초) | **사고 연쇄 자체가 발산한다.** 장소 26곳 × 5일은 제약 만족 문제다 | `thinking: {type:"disabled"}` → **2.9초 · 416토큰 · 완전** |

`effort` 3종이 된 이유가 이것이다(`plan`). **`generate`로 되돌리면 이 라우트가 항상
409를 낸다.** 표는 spec §4.3 · `lib/ai/deepseek.ts`의 `EFFORT`.

얻은 것은 속도만이 아니다 — **이름·주소가 AI를 거치지 않으므로 바뀔 수 없다.**
§7.5 ②의 누락 0건 검사가 문자열 대조로 성립하는 근거가 그것이다.

### ④ 곁가지로 드러난 결함 3건

| 무엇 | 왜 문제인가 | 고침 |
|---|---|---|
| **25초 타임아웃이 발동하지 않았다** | SDK 클라이언트의 `timeout` 옵션만 걸려 있었고, 추론이 긴 호출이 **58.2초**에 돌아왔다. `maxDuration` 60초이므로 플랫폼이 먼저 끊어 409 대신 504가 나가고 §11.6 재시도를 건너뛴다 | 요청마다 `AbortSignal.timeout` (예비 경로는 처음부터 그랬다) |
| **프롬프트가 조용히 잘릴 수 있었다** | 펜스 안에 `## `로 시작하는 줄을 두면 `section()`이 거기서 섹션을 끊는다 | 코드젠이 그 경우를 **빌드 실패**로 만든다. `test:harness`도 잡는다 |
| **편집기가 일차를 늘릴 수 있었다** | `checkDays` 주석은 「개수는 편집 대상이 아니다」인데 구현은 `text` 유무만 봤다 | 행 수 대조 추가(`checkDays`·`checkRows`) |

### ⑤ 실측 (2026-08-12 밤)

| 항목 | 값 |
|---|---|
| `plan-draft` 1회 | **3.2~3.3초** (사고 끔 · 출력 ~416토큰) |
| `test:plan-draft` | **18 통과 · 0 실패** (AI 2회) |
| `test:harness` | **181 · 0 · 미구현 0** |
| `test:policy` | **270 · 0** |
| `test:demo` | **48 · 0** (숙소 2행 · 상점 3행 픽스처 · 재시도 0회) |
| `test:real` | **18 · 0 · 114초** — 실제 메모(상호 15곳)가 자연어부터 게시까지 관통 |

**`test:real`이 이 작업의 종료 조건이었다.** 대본 픽스처는 배열이 「돌아간다」만 보이고
실제 입력 규모에서 어떻게 되는지는 안 보인다. 관통 결과 상점 13곳이 초안 → `form_input`
→ 소개서 → 페이지 → 공개 페이지까지 **13행 그대로** 갔고, 사람이 올린 `제휴` 한 건도
끝까지 유지됐다. 데이터를 지우지 않으므로 브라우저로 열어 확인할 수 있다.

### ⑥ 픽스처 배열화 — 12개 스크립트

`tsc`가 잡아주지 않는 종류의 파급이었다. 폼 POST는 필드 이름이 문자열이고, DB 직접
삽입은 `form_input`이 jsonb다 — **타입 검사를 전부 통과하면서 런타임에 400이 난다.**

| 계열 | 파일 | 무엇 |
|---|---|---|
| 폼 POST | `test-demo` · `test-pipeline` · `test-images` · `test-api` · `test-stale` | 평면 이름 → `숙박[0].숙소명` 표기 |
| DB 삽입 | `test-logs` · `test-delete` · `test-application` · `test-admin-applications` · `test-security` · `test-publish` · `verify-responsive` · `probe-gemini` | 단일 객체 → 객체 배열 |
| 검증 로직 | `verify-artifacts` · `test-api` | 행마다 대조하도록 (첫 행만 보면 둘째 숙소가 사라져도 통과한다) |

**`test:demo`는 숙소 2행 · 상점 3행으로 올렸다.** 1행씩이면 배열 경로가 사실상 미검증이다 —
인덱스가 항상 `[0]`이라 `source` 경로가 다른 원소를 가리키는 결함이 드러나지 않고, 렌더러가
첫 행만 그려도 화면이 정상으로 보인다. §7.3 ⑤-1의 「이미지를 올리지 않아 슬롯 경로가
미검증이었다」와 같은 종류의 구멍이다.

공개 페이지 검사도 함께 고쳤다. 숙박 섹션이 정의 목록 → **카드 목록**이 되면서
「`숙소명`이라는 낱말이 HTML에 있는가」가 성립하지 않는다(카드 제목은 **값**이다).
`객실타입`으로 바꾸고, 숨긴 상점 3행의 **값**이 한 글자도 남지 않는지 따로 본다.

### ⑦ 타임아웃 수정이 드러낸 것 — 데모 전에 알아야 한다

`AbortSignal` 수정으로 **25초가 실제로 걸리게 됐다.** 2.6까지는 발동하지 않았고, 그래서
30~60초짜리 호출이 조용히 통과하고 있었다. 고친 것은 맞지만(58.2초 호출은 Vercel에서
`maxDuration` 60초에 걸려 409 대신 504가 된다) **전에 통과하던 느린 호출이 이제 실패한다.**

실제로 배열 픽스처를 넣은 첫 실행에서 분해가 **3회 연속 타임아웃**했다(25.8·26.0·25.7초 → 422).
원인은 `숙박`·`상점` 객체를 프롬프트에 통째로 싣던 것이었고, **이름 목록으로 바꿔** 19.2초로
내렸다. 그 뒤 재시도 0회로 통과한다.

**남은 위험은 검증 2종이다** — 그 둘은 `form_input` 전체를 싣는다(12.0 → 15.2 · 12.8 → 17.3초).
상점이 13곳인 실제 상품으로 파이프라인을 끝까지 돌린 실측이 아직 없다.

실제 메모의 산출물 — 축제(11.05~11.07)가 2·3·4일차에, 숙소 2곳이 앞뒤 일차에,
카페 13곳이 권역별로 묶였다. 상호 15곳 **누락 0건**.

---

## ⑤ 지금 남은 일 ← **여기부터가 다음 사람의 몫이다**

> **2026-08-13 추가** — 데모 후에 착수할 큰 항목이 하나 더 생겼다: 상세 페이지의
> 구성·분위기를 AI가 정하게 하는 **spec 2.8**. 설계와 자리는 **§8**에 정해 뒀고
> 구현은 한 줄도 하지 않았다. 아래 ⑤-1~⑤-4보다 파급이 크므로 §8을 먼저 읽는다.

### ⑤-1 `test:demo`가 이미지를 올리지 않는다 (우선)

§7.3 ③-b의 결함이 오래 살아남은 이유가 이것이다. 대본이 이미지 없이 돌아서
**슬롯 경로 전체가 미검증**이다. `slotIf()`가 항상 `''`를 반환하므로 슬롯 이름이
틀려도 결과가 같다.

고치는 법: `scripts/test-demo.mts`의 폼에 `image:hero`·`image:itinerary_day_{n}`을
붙이고, 페이지 생성 뒤 `sec_itinerary.days[].image_slot`이 업로드 슬롯과 같은지 본다.
1×1 PNG 한 장을 base64로 박아 쓰면 되고 AI 호출은 늘지 않는다.

### ⑤-2 산문과 프롬프트가 갈리는 것을 막을 방법

③-b가 드러낸 구조적 문제다. 검사기는 「선언한 섹션이 SKILL.md에 있는가」는 보지만
**「산문의 규칙이 프롬프트에도 있는가」는 볼 수 없다** — 자연어 대조라 기계로 안 된다.

현실적인 완화책은 하나뿐이다: **값 규칙은 반드시 기계 검사로 이중화한다.**
프롬프트가 빠져도 0차가 잡는다. `checkDayNumbers`가 그 본보기다.
새 값 규칙을 프롬프트에 넣을 때마다 대응하는 기계 검사를 함께 넣는지 확인한다.

### ⑤-3 `mechanical` 스킬 12개의 산문은 여전히 실행되지 않는다

이것은 **결함이 아니라 받아들인 한계다**(§6 「남는 정직한 한계」). 다만 CLAUDE.md의
「실행 근거 범위표」가 그 경계를 명시하므로, 다음 사람이 `mechanical` SKILL.md를
고치고 동작이 바뀌었다고 믿는 일은 없어야 한다.

더 줄이고 싶으면 방향은 하나다 — **`asserts`를 늘린다.** 지금은 1개
(`data-normalization.변경이력_존재`)뿐이다. 스킬이 보장하는 것을 `asserts`로 적으면
그만큼 산문이 실행 가능해진다. 평가기는 `lib/harness/asserts.ts`에 추가한다.

### ⑤-4 손대지 않은 것들

| 항목 | 상태 |
|---|---|
| `lib/orchestrator.ts`·`lib/logging.ts`·`lib/policy.ts`·`lib/ai/*` | 하네스 **바깥**(R7). 이번에 `orchestrator`만 로그 결함 2건으로 수정 |
| `components/`·`app/admin/`·`app/p/` 렌더링 | 이번 작업 범위 밖 |
| `checklist.md` 판정 항목 ~355개 | 대조하지 않았다 |

## 7.4 이어서 작업하는 사람이 먼저 읽을 것

1. **`CLAUDE.md`의 🔒 하네스 규약 R1~R7** — 코드 작성에도 적용되는 규약이다. 예외는 없다
2. **`CLAUDE.md`의 「실행 근거가 어디까지인지」 범위표** — `.claude/`의 무엇이 실제로
   실행되고 무엇이 사람이 읽는 명세인지. **이걸 모르면 문서를 고치고 동작이 바뀌었다고 믿는다**
3. **`CLAUDE.md`의 「2.2 → 2.6에서 뒤집힌 값」 대조표** — 문서를 고칠 때마다 이 표로 대조한다
4. **`.claude/harness/manifest.json`** — 배선을 알고 싶으면 코드가 아니라 이 파일이다
5. **위 §7.3 ⑤** — 지금 남은 일

### 처음 여는 사람이 할 일 (5분)

```bash
npm ci
cp .env.local.example .env.local     # 키를 채운다
npm run build:harness                # .claude/ → registry.ts
npm run test:harness                 # 155 통과 · 0 실패 · 미구현 0 이어야 한다
npm run test:policy                  # 265 통과 · 0 실패
```

여기까지는 **키 없이도 돈다.** AI가 필요한 것은 `probe:deepseek`·`test:demo`뿐이다.

```bash
npm run dev                          # 별도 터미널
npm run probe:deepseek               # 주 AI 경로 실측 — 키를 건드렸으면 이것부터
npm run test:demo                    # §20 대본 관통. AI 5회를 쓴다
```

⚠️ `test:demo`는 **실제 AI를 5회 호출하고 이메일을 1통 보낸다.** 수신은 Resend 가입
주소로만 되며 기본값은 `delivered@resend.dev`(테스트 주소)다.

### 규칙 4개만 지키면 된다

- **순서를 바꾸려면** `manifest.json`을 고친다. 코드가 아니다
- **프롬프트를 바꾸려면** SKILL.md의 `## 프롬프트` / `## user 지시문` 펜스를 고치고
  `npm run build:harness`
- **값 규칙을 프롬프트에 넣으면 기계 검사도 함께 넣는다** — §7.3 ⑤-2의 교훈이다
- **커밋 전에** `npm run test:harness` — 실패하면 커밋하지 않는다

### 되돌림

`git tag demo-fallback` → `6f0289b`. 규약·매니페스트·검사기만 들어간 **문서 커밋**이고
`app/`·`lib/`의 코드는 전환 전 상태다. 즉 이 태그를 꺼내면 라우트가 직접 `ai()`를
부르는 옛 경로로 시연할 수 있다.

단 그 시점에 남아 있는 결함 2건을 알고 써야 한다:
- §5.5 `itinerary_partial` 이상 플래그가 발화하지 않는다 (`7b606a4`에서 수정)
- 0차 명사구 검사가 정상 서술을 반려할 수 있다 (`2478d87`에서 수정)

### 전환 이후 커밋 (태그 → HEAD)

| 커밋 | 내용 |
|---|---|
| `524e09f` | 프롬프트 5개를 SKILL.md로 이식 — 바이트 동일 |
| `8e1528d` | 코드젠 `.claude/` → `registry.ts` · 드리프트 검사 |
| `1f20caa` | impl 함수 4개 — `buildConfirmedData` 분할 · `verifyAxis0` · 보호값 검증 |
| `2478d87` | 0차 명사구 판정을 spec §6.3 구조로 (표시 ≠ 실패) |
| `7b606a4` | `lib/harness/` 런타임 — `runAgent` · 예산 기계 강제 · `itinerary_partial` 수정 |
| `cd77f99` | 라우트 6개 전환 · `*_SYSTEM` 5개 삭제 |
| `2442ea8` | 로그 verdict 재기준화 |
| `3c8fd14` | 인계 문서 §7 신설 |

### 8/12 밤 — 완성도 감사와 그 후속 (커밋 8개)

| 커밋 | 내용 |
|---|---|
| `d92a4f6` | 스킬·에이전트 문서의 2.2 잔재 전수 재기준화 (`memo-leak-check` 누락 포함) |
| `3fdaef0` | 로그 거짓 기록 2건·검사 구멍 1건 수정 + **`asserts`를 실제로 실행** |
| `d5a68a6` | 검사기 103 → 132. 문서 사본·선언의 강제를 대조한다 |
| `e76b463` | 인계 문서 — 감사 결과 |
| `16fd057` | 매니페스트 밖 라우트 3개 등록 (`edit-contract-check` 등 신설) |
| `e35b12b` | 인계 문서 — 등록 완료 |
| `a3724ba` | **3차 검증을 AI → 기계.** 대본당 AI 6 → 5회 |
| `17dc7c8` | **user 지시문을 SKILL.md로. R4 완결 · 미구현 0** |
| `d3655d9` | **spec §6.3 판정 3단계 구현** — AI 신고 + 기계 판정 |
| `8a1dcee` | `day`가 «1일»이면 일차별 사진이 사라지던 결함 수정 |

이 구간에서 **`app/`의 라우트 코드는 한 줄도 바뀌지 않았다.** 바뀐 것은
`lib/orchestrator.ts`(로그 결함 2건)·`lib/pipeline/*`·`lib/harness/*`·`.claude/*`·
검사 스크립트다.

---

# 8. spec 2.8 설계 — 상세 페이지의 구성·분위기를 AI가 정한다 (2026-08-13 결정 · **착수는 데모 후**)

**아직 한 줄도 구현하지 않았다.** 이 절은 R6(「새 기능은 자리를 먼저 정한다」)에 따라
**자리와 근거만** 정해 둔 것이다. `spec.md`는 여전히 2.7이며, **착수하는 사람이
`spec.md`를 2.8로 올린 다음 코드를 고친다** — 규정만 2.8이고 코드가 2.7이면
그 사이에 구현하는 사람이 없는 규정을 믿는다.

## 8.1 무엇이 문제였나

여행마다 테마·분위기·구성이 달라야 하는데 2.7은 셋 다 고정이다.

| 무엇 | 2.7의 상태 | 왜 문제인가 |
|---|---|---|
| 구성 | 9섹션 **고정 · 순서 고정** · 삭제 금지(§9.3) | **비행기를 타지 않는 여행**도 항공 섹션이 그려진다 |
| 표기 | 항공편은 선택 입력(§7.2)이지만 미입력이면 §6.1이 `추후 추가 예정`으로 채운다 | 「없는 것」이 **「아직 안 정한 것」으로 보인다.** 고객이 항공편이 추가될 것으로 읽는다 |
| 테마 | 여행스타일 select → 테마 키 **1:1 기계 매핑**(§9.4) | 스타일 6종 밖의 상품은 전부 `default`. 상품의 성격이 화면에 반영되지 않는다 |

**결함이 가장 선명한 것은 두 번째 줄이다.** 「없음」과 「미정」을 구분하는 자리가
페이지에 없다.

## 8.2 정한 것 — AI의 재량은 「재료가 있는 것들 사이」로 한정한다

```
AI가 정한다        theme (분위기) · sections[].order (구성·순서)
기계가 정한다      섹션이 존재할 수 있는지 (재료 유무)
```

| 판정 | 규칙 | 근거 |
|---|---|---|
| 재료 **없음** | 값이 `해당 없음` → **섹션 제외** | 기획자가 폼에서 명시적으로 「미이용」을 체크한 경우뿐이다 |
| 재료 **미정** | 값이 `추후 추가 예정` → **섹션 유지 · 흐리게 표시** | §6.1의 목적이 「빈칸을 기획자가 알아차리게」이므로 유지가 맞다 |
| 재료 **있음** | 섹션 **필수 포함.** AI가 뺄 수 없다 | §16.1 — AI가 사실정보를 지우는 경로를 만들지 않는다 |

**「해당 없음」을 재료 없음의 신호로 쓰는 근거는 spec에 이미 있다** — §6.1의
`가격.아동` 미운영 체크가 같은 구조다(`0`을 넣어 「0원」으로 보이는 것을 막으려고
문자열 `해당 없음`을 저장한다). 새 개념을 만들지 않고 그 선례를 4개 섹션으로 넓힌다.

### 폼에 추가할 체크 4종

| 체크 | 저장 | 사라지는 섹션 | 실제 수요 |
|---|---|---|---|
| 항공 미이용 | `항공편` 전체 = `해당 없음` | `flight` | 국내 버스·기차 여행 |
| 숙박 없음 | `숙박` = **0행** | `accommodation` | 당일치기 |
| 식사 미포함 | `식사.식사정보` = `해당 없음` | `meal` | 식사 자유 상품 |
| 제휴상점 없음 | `상점` = **0행** | `shop` | 제휴가 없는 상품 |

⚠️ **`숙박`·`상점`은 2.7에서 「1건 이상」이 계약이다.** 체크 시 **0행을 허용**하도록
§7.4와 0차 검증을 함께 고쳐야 한다. 체크 없이 0행이면 여전히 입력 오류다.

**구조 섹션 5개는 생략 대상이 아니다** — `hero`·`summary`·`itinerary`·`price`·`apply`.
행사명·기간·일정·가격은 필수 폼 그룹이고, 신청 폼이 없으면 상품 페이지가 아니다.

## 8.3 자리 — `page` 라우트 체인 6 → 7 (**AI 호출은 1회 그대로**)

이 설계의 핵심 이점이 여기다. **재량이 늘어도 AI 호출이 늘지 않는다** —
테마·순서 판단이 이미 있는 `content-structuring` 호출에 **같이 실린다**(수십 토큰).

| # | 스킬 | kind | 2.7 | 2.8 |
|---:|---|---|---|---|
| 1 | **`section-material-gate`** | mechanical | — | **신설.** 재료 유무로 **허용 섹션 집합**을 확정한다 |
| 2 | `content-structuring` | **ai (1회)** | 서술 확장 | + **`theme` 후보 · `order` 계획.** 허용 집합을 user 지시문에 실어 보낸다 |
| 3 | `theme-design-token-match` | mechanical | 1번 · 여행스타일 → 키 | **2번 뒤로 이동.** AI가 고른 키를 **검증**하고 무효면 여행스타일 매핑 → `default` 폴백 |
| 4 | `web-content-structure-gen` | mechanical | 조립 | 섹션 집합·`order`를 반영해 조립 |
| 5 | `page-contract-check` | mechanical | **섹션 9개·순서 고정** 검사 | **집합 = 허용 집합 · `hero` 처음 · `apply` 끝 · `order` 1..n 연속** |
| 6 | `memo-leak-check` | mechanical | 그대로 | 그대로 |
| 7 | `slug-issue` | mechanical | 그대로 | 그대로 |

**게이트를 AI 앞에 두는 이유**: 뒤에 두면 AI가 존재할 수 없는 섹션에 출력 토큰을
쓰고 기계가 그것을 버린다. 앞에 두면 애초에 후보에 없다. 사후 검사(5번)는 그대로 남는다 —
**게이트는 AI에게 알려 주는 것이고, 강제는 계약 검사가 한다.**

**테마를 「키 선택」으로 두고 색을 직접 쓰게 하지 않는 이유**: `#RRGGBB`를 AI가 쓰면
§17.2의 대비 4.5:1을 보증할 수 없다. 지금 토큰 표는 대비가 **사전 계산**돼 있다
(`theme.tsx` 주석 — primary 6색 전부 흰색 대비 4.8:1 이상). 표현력을 늘리려면
**테마 키를 늘린다** — AI 프롬프트가 아니라 `THEME_TOKENS`를 늘리는 일이다.

## 8.4 소개서는 바꾸지 않는다 (8섹션 고정 유지)

기획자의 결정이다. 소개서는 **AI 주관 없이 값만 채워 검증하는 문서**로 남는다 —
지금도 AI가 쓰는 문장은 `overview.핵심일정` 하나뿐이고 나머지는 기계 치환이다.

**항공이 `해당 없음`이어도 소개서는 항공 섹션을 유지한다.** 소개서는 검토용 문서이고
(§8.6), 기획자는 「항공: 해당 없음」이 자기 의도인지 확인해야 한다. 값이 화면에서
사라지면 그 확인이 불가능하다.

**따라서 3차 검증(소개서 8섹션 ↔ 페이지 n섹션)의 대응표가 비대칭이 된다.**

```
페이지에 없는 섹션  →  그 섹션의 재료가 「해당 없음」일 때만 대조 생략 (그 외에는 실패)
```

이 한 줄이 3차 축을 지킨다 — AI가 섹션을 조용히 빠뜨리면 재료가 있으므로 **실패**다.
`consistency.ts`의 `collect`가 `source` 경로를 조인 키로 쓰므로 구현은 「페이지 쪽
키가 없을 때 재료를 확인한다」 한 갈래 추가다.

## 8.5 손대야 하는 곳 · 손대지 않아도 되는 곳

| 계층 | 무엇 |
|---|---|
| **렌더러 — 변경 0** | `PageRenderer`가 이미 `sections`를 순회하고 `order`로 정렬하며 `type → 컴포넌트` 맵으로 그린다. **부재 섹션은 자연히 안 그려지고 순서도 이미 데이터가 정한다.** 「9섹션 고정」은 렌더링 제약이 아니라 계약 제약이었다 |
| 폼 | 체크 4종(§8.2) · `숙박`·`상점` 0행 허용 |
| 0차 검증 | `해당 없음` 필드를 정규화·명사구 검사에서 제외(§6.1 선례) · 0행 허용 조건 |
| 편집 계약 | 「기본 9섹션 불변」 → **「그 상품이 가진 기본 섹션 집합 불변」.** 삭제는 지금처럼 `visible: false`로만 |
| 3차 검증 | §8.4의 비대칭 규칙 한 갈래 |
| 검사 | **항공 없는 상품 픽스처**를 `verify:artifacts`·`verify:responsive`에 추가. `verify:artifacts`는 **순서를 가정하지 않고** 「집합과 계약」만 본다 |
| 문서 | `spec.md` §6.1·§7.2·§7.4·§9.2·§9.3·§9.4·§10.2·§11.1 · SKILL.md 4개 · `web-builder-agent` 체인 표 · `checklist.md` |

## 8.6 받아들여야 하는 대가

| 대가 | 판단 |
|---|---|
| **같은 입력에 다른 테마·순서가 나올 수 있다** | 시연에서는 장점이지만 회귀 검사는 「유효한 키인가 · 계약을 지켰는가」만 볼 수 있다. **스크린샷 비교식 검사는 성립하지 않는다** |
| AI 출력이 조금 늘어난다 | 테마 키 1개 + `order` n개 = 수십 토큰. 페이지 확장은 11.7초로 40초에 28.3초 여유가 있어 무시할 수 있다 |
| 게이트가 폼 체크에 의존한다 | 기획자가 체크를 안 하면 2.7과 같은 화면이 된다. **자동 추론하지 않는 것이 의도다** — 「항공편이 비었으니 없는 여행일 것」이라고 기계가 단정하면 그것이 §16.1 위반이다 |
