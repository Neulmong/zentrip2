# 하네스 전환 계획 — 스킬·에이전트를 런타임 실행 근거로 만든다

**결정 (2026-08-12):** 인앱 하네스 방식. 데모(2026-08-14 금)를 하네스 경로로 시연한다.
**권위:** `spec.md` 2.6이 여전히 유일한 권위다. 이 문서는 spec을 바꾸지 않고, spec을 **어디에 적어두는지**를 바꾼다.

---

## 0. 지금 상태 (실측)

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
