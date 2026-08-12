# zentrip — 구현 지침

여행 상품 페이지 자동 생성·배포 플랫폼. Next.js(App Router) + Supabase + DeepSeek API + Resend, Vercel 단일 프로젝트.

## ⚠️ 문서 권위 — 이것부터 읽는다

| 문서 | 지위 |
|---|---|
| **`spec.md` (2.6)** | **구현의 유일한 권위.** 스키마·상한·규정·응답코드 전부 |
| `workflow.md` (2.5) | 단계 순서·분기·복귀. spec과 어긋나면 spec |
| `checklist.md` (2.4) | ⚠ AI 공급자 항목은 spec 2.6 기준으로 읽는다. 판정 항목 약 355개. 게이트 G0~G6 |
| `origin-spec.md` (2.2) | **이전 판본.** 방향성 대조용 히스토리. 구현 근거로 쓰지 않는다 |
| **`.claude/skills/` · `.claude/agents/`** | **🔒 런타임 실행 근거.** 프롬프트·스킬 체인·판정 규칙의 유일한 출처 |
| **`.claude/harness/manifest.json`** | **🔒 배선의 유일한 출처.** 라우트 → 에이전트 → 스킬 체인 · AI 예산 |
| **`docs/harness-migration.md` §7** | **📌 인계 문서. 이어서 작업하려면 이 절부터 읽는다** — §7.1 지금 어떻게 돌아가나 · §7.2 실측 · **§7.3 ⑤ 남은 일** · §7.4 처음 여는 사람 |
| `docs/harness-migration.md` §0~§6 | 전환 계획·근거. **8/12 낮 시점의 수치가 그대로 남아 있다** — 현재 상태는 §7이 갖는다 |

**⚠️ 2026-08-12에 뒤집힌 규칙:** `.claude/`는 더 이상 "구현 중 참조 금지"가 아니다.
**정반대로, 구현이 반드시 경유해야 하는 실행 근거다.** 아래 하네스 규약이 이를 강제한다.
spec.md는 여전히 유일한 권위이고, `.claude/`는 **spec을 실행 가능한 형태로 적어둔 곳**이다 —
둘이 어긋나면 spec이 이기고, `.claude/`를 고친다.

#### ⚠️ 「실행 근거」가 어디까지인지 — 과장하지 않는다

`.claude/`의 **전부**가 실행되는 것은 아니다. 이 경계를 모르면 문서를 고치고
동작이 바뀌었다고 잘못 믿게 된다. 실제로 실행되는 것은 다음 넷이다.

| 무엇 | 어디 | 실행 방식 |
|---|---|---|
| **시스템 프롬프트** | `ai` 스킬 5개의 `## 프롬프트` 펜스 | 코드젠이 바이트 그대로 구워 AI에 전달. **문서가 곧 동작** |
| **스킬 실행 순서** | `manifest.json`의 `skills` 배열 | `runChain`이 선언 순서대로 실행 |
| **AI 예산** | `manifest.json`의 `ai_budget` | `assertBudget`이 호출 **전에** 대조하고 초과 시 던짐 |
| **스킬 계약** | `manifest.json`의 `asserts` | `runChain`이 스킬 실행 후 평가하고 위반 시 던짐 |

**나머지는 사람이 읽는 명세다.** 특히 `mechanical` 스킬 12개의 SKILL.md 산문은
런타임에 관여하지 않는다 — 실제 변환은 `impl`이 가리키는 `lib/pipeline/*.ts`가 한다.
**그 산문을 고쳐도 프로그램 동작은 바뀌지 않는다.** 동작을 바꾸려면 `impl` 함수를 고치고,
문서는 그 변경을 **설명**하도록 함께 고친다(규약 R5).

이것이 AI 0회를 지키기 위해 받아들인 한계다(절대원칙 1). 모든 스킬을 AI로 돌리면
요청당 호출이 3배가 되고 §5.5의 20초 임계를 넘긴다. 근거는
`docs/harness-migration.md` §6 「남는 정직한 한계」.

### 2.2 → 2.6에서 뒤집힌 값 (스킬 문서 재기준화 대조표)

**이 표의 왼쪽 값이 문서에 남아 있으면 다음 사람이 그 값으로 구현한다.**
`ai` 스킬의 프롬프트라면 그대로 실행되기까지 한다.
스킬·에이전트 문서를 고칠 때마다 이 표로 대조한다.

| 항목 | 2.2 (구 스킬 문서) | **2.6 (실행할 값)** | spec |
|---|---|---|---|
| 재시도 카운터 | 3종, 0차가 `brochure` 공유 | **4종** `normalization`·`brochure`·`page`·`consistency`, 예산 비공유 | §11.6 |
| 라우트 시작 조건 | `current_step` 값으로 판정 | **재료 기준** (산출물 존재 + 선행 축 판정값) | §14.5 |
| 409 응답 | 코드만 | **`reason` 필수** `retry`/`precondition`/`stale`/`slug_conflict`/`product_not_published` | §14.6 |
| 여행기간 | 단일 필드 | `form_input`은 `여행기간_시작`·`여행기간_종료` **2필드**, `confirmed_data`에서만 결합 | §6.2.1·§7.4 |
| 정규화 대상 | 모든 날짜·금액 값 | 날짜는 여행기간 2필드만, 금액은 `가격.성인`·`가격.아동` 2필드만 | §6.2 |
| 조사 파이프 | 값 필드에도 적용 | **`source: "generated"` 서술 필드에만.** 값 필드 금지 | §8.8 |
| 길이 계약 | 항상 6종 | 생성 시 **4종** / 편집 저장 시 **6종** | §17.1 |
| 로그 `verdict` | `통과`/`반려` | **저장은 영어** `pass`/`fail`/`-`, 화면에서만 한글 | §5.4 |
| 신청 로그 | 원본 기록 | `category=application`은 **저장 시점 마스킹** | §5.4 |
| 이상 플래그 중복 | `(step, type)` | **`(execution_id, attempt_no, step, type)`** | §5.5 |
| **AI 공급자** | `claude-opus-5` (2.4까지) | **`deepseek-v4-flash` 주 · Gemini 예비** (2.6), `lib/ai` provider 중립 인터페이스 | §4.3 |
| 동시성 | 없음 | 전 쓰기 라우트 `updated_at` 조건부 갱신 → **409 `stale`** | §16.1.1 |

## 🔒 하네스 규약 — 절대 불가침

**이 규약은 런타임 실행과 코드 작성 양쪽에 동시에 적용된다. 예외는 없다.**
데모 일정·버그 급함·"이번 한 번만"은 예외 사유가 아니다. 규약을 어겨야 풀리는 문제라면
**규약이 아니라 스킬·에이전트 문서를 고쳐서** 푼다.

### 구조

```
라우트  →  runStep(상태·로그·재시도)  →  runAgent(에이전트 1개)
                                            └→ 스킬 체인 (선언된 순서)
                                                 ├ mechanical 스킬 (AI 0회)  ← 기본
                                                 ├ mechanical 스킬 (AI 0회)
                                                 └ ai 스킬 (AI 1회)         ← 라우트당 최대 1개
```

**에이전트가 스킬을 호출한다. 스킬은 단일 기능을 수행한다.** 이 두 문장이 구조의 전부다.

### R1 — 라우트는 에이전트만 부른다

서버 라우트에 파이프라인 로직을 쓰지 않는다. `runStep` + `runAgent` 외의 것이 라우트에 있으면 위반이다.
**라우트가 `ai()`를 직접 호출하는 것은 금지다.** AI 호출은 `ai` 스킬만 한다.

### R2 — 스킬은 단일 기능이다

스킬 하나는 일 하나만 한다. 두 가지 일을 하면 **두 스킬로 쪼갠다.**
"정규화하고 분해한다"는 두 스킬이다. `## 목적`이 두 문장으로 갈라지면 분할 신호다.

### R3 — mechanical이 기본, ai는 예외 (API 최소화)

새 스킬의 기본값은 `kind: mechanical`(AI 0회)이다. `kind: ai`는 **입력에 없는 서술을 새로 써야 할 때만** 쓴다.
값 치환·형식 통일·구조 조립·기계 대조는 전부 mechanical이다.
`ai` 스킬을 만들려면 "이 일을 mechanical로 할 수 없는 이유"를 SKILL.md에 적는다.

**라우트당 AI 호출은 최대 1회다.** `manifest.json`의 `ai_budget`이 이를 선언하고 `runAgent`가 스킬 실행 전마다
누적 합계를 대조해 초과 시 **던진다.** 절대 원칙 1이 규율에서 기계 강제로 승격된 지점이다.

### R4 — 프롬프트는 SKILL.md에만 있다

TS 파일에 시스템 프롬프트 문자열을 두지 않는다. `*_SYSTEM` 상수를 만들지 않는다.
프롬프트를 바꾸려면 SKILL.md를 고친다. `npm run test:harness`가 라우트·`lib/` 전체에서 프롬프트 문자열 0건을 검사한다.

JSON 스키마와 TS 타입은 `lib/pipeline/ai-contracts.ts`에 남는다(타입과 짝이어야 한다).
SKILL.md는 스키마의 **이름만** 지정한다.

### R5 — 문서를 고치지 않는 동작 변경 커밋은 금지

파이프라인 동작이 바뀌는데 `.claude/` 아래가 그대로인 커밋은 위반이다.
**순서를 바꾸려면 `manifest.json`을, 판정·금지사항·프롬프트를 바꾸려면 SKILL.md를,
역할·응답코드를 바꾸려면 에이전트 문서를 먼저 고친다.** 코드는 그 다음이다.

### R6 — 새 기능은 자리를 먼저 정한다

무엇을 만들기 전에 **"어느 에이전트의 몇 번째 스킬인가"** 를 답한다.
답이 없으면 스킬을 신설하고 `manifest.json`에 등록한 뒤 구현한다. 순서를 뒤집지 않는다.

### R7 — 상태 기계는 하네스가 삼키지 않는다

`lib/orchestrator.ts`(`runStep`)·`lib/logging.ts`·`lib/policy.ts`·`lib/ai/*`·`lib/client/run-pipeline.ts`는
하네스의 **바깥**이다. 재시도 카운터 4종·409 `reason` 5종·이상 플래그 5종·조건부 갱신·클라이언트 재개 표는
이미 spec 2.6대로 검증됐다. 하네스는 `runStep`의 `work` 콜백 **안쪽만** 대체한다.
`kind: spec` 스킬(`product-orchestrator`·`execution-log-collection`·`abnormality-detection`)은
이 영역을 문서화하며, 체인에서 실행되지 않는다 — 실행하면 로그가 두 번 쌓인다.

### 위반 검사

```bash
npm run test:harness   # R1·R3·R4 + 매니페스트 정합성. 실패하면 커밋하지 않는다
```

## 절대 원칙

1. **1요청 1AI호출.** 서버 라우트 1건은 AI를 최대 1회. 타임아웃 25초, SDK 자동 재시도 없음, `maxDuration` 60초 (§4.2·§4.3).
   **하네스 규약 R3이 `ai_budget`으로 기계 강제한다**
2. **재시도는 클라이언트가 같은 API를 재호출.** 서버 내부 루프·폴링·큐·Cron 없음. `202` 사용 안 함
3. **AI 출력은 JSON 스키마로 강제.** 주 경로(DeepSeek)는 strict 모드가 없어 `json_object` + **`lib/ai/schema.ts` 서버 검증**이 관문이고, 예비 경로(Gemini)만 `responseSchema`로 제공자가 강제한다. 어긋난 구조가 파이프라인에 들어가는 경로는 없다 (§4.3)
4. **검증 기준값은 `form_input`.** `confirmed_data`는 0차의 검증 대상이지 기준이 아니다 (§11.1)
5. **AI는 `page_content`/`brochure_content` JSON만 만든다. HTML 생성 금지.** 렌더링은 고정 React 컴포넌트 (§9.1)
6. **`source` 맵 필수.** `source` 없는 사실정보 필드는 그 자체로 실패 (§8.8·§9.3)
7. **입력에 없는 값을 만들지 않는다.** 일차 서술은 `원문근거` 범위 안에서만 (§6.3·§16.1)
8. **모델은 `deepseek-v4-flash`** (DeepSeek 종량제, OpenAI 호환 SDK). `reasoning_effort` 생성 `medium`/검증 `low`,
   타임아웃 25초, `maxRetries: 0` (§4.3). **`deepseek-v4-pro`는 쓰지 않는다** — `AI_MODEL`에 pro·비flash 값이
   들어오면 `lib/ai/deepseek.ts`가 호출 전에 던진다. 막히면 `AI_PROVIDER=gemini`로 예비 경로 전환.
   **라우트는 `lib/ai`의 provider 중립 인터페이스만 호출한다** — 모델을 바꿔도 라우트는 수정하지 않는다

## 목표

**데모: 2026-08-14(금).** 평가 대상은 *돌아가는 결과물의 시연*이며, 종료 조건은 **spec §20의 3분 시나리오**다.
로그인 → `/new` 폼+이미지 → [소개서 생성](4요청) → [상품 생성](3요청) → 편집기 → [게시] → 비로그인 `/p/{slug}` → 신청 → 이메일 → `/admin/logs/{execution_id}`.

§20 경로에 없는 기능은 후순위. 측정 기준은 §1 — 입력부터 배포까지 10분, 코드·디자인 작업 0건.

### AI 공급자 제약 (확정 · 2026-08-12 실측)

- **주 경로는 DeepSeek `deepseek-v4-flash` 하나다.** `pro`는 금지 — provider가 호출 전에 던진다

#### ⚠️ 소요 시간은 두 종류다 — probe 수치를 파이프라인 기준으로 쓰지 않는다

`probe:deepseek`은 **작은 샘플 입력**(795~1105 토큰)을 보낸다. 실제 라우트는 `form_input` ·
`confirmed_data` · `page_content`를 통째로 직렬화해 보내므로 입력이 훨씬 크고, **그만큼 느리다.**
아래 두 열은 같은 날(2026-08-12) 같은 모델로 잰 값이다.

| 호출 | `probe:deepseek` | **실제 파이프라인** (`execution_logs.elapsed_ms`) | 25초까지 여유 |
|---|---:|---:|---:|
| 일차 분해 | 5.2초 | **22.5초** | **2.5초** ← 가장 위험 |
| 소개서 개요 | — | 3.4초 | 21.6초 |
| 1차 검증 | 1.6초 | **12.0초** | 13.0초 |
| 페이지 확장 | 14.0초 | **21.2초** | 3.8초 |
| 2차 검증 | 1.6초 | **12.8초** | 12.2초 |
| 3차 검증 | 1.6초 | 6.7초 | 18.3초 |

- **일차 분해와 페이지 확장이 §5.5 `processing_delayed` 임계값(20초)을 상시 넘는다.**
  이상 플래그 2건이 매 실행 뜨는 것은 **정상이고 설계대로다.** 없어져야 할 값이 아니다
- **타임아웃 25초까지 여유가 분해 2.5초뿐이다.** 조금만 느려지면 409 → 재시도로 간다.
  `test:demo` 1회차에서 실제로 `validate-page`가 409 후 재시도로 통과했다(2회차는 재현 안 됨).
  **재시도 경로가 그 상황을 위해 있으므로 고장이 아니다** — 대본 3:00 안에 들어온다
- **프롬프트를 늘리면 이 여유를 깎는다.** user 메시지 지시문을 SKILL.md로 옮기는 작업이
  데모 뒤로 미뤄진 이유가 이것이다 — 옮긴 뒤 이 표를 **다시 재야 한다**
- `npm run dev` 첫 요청은 라우트 컴파일 때문에 38초까지 나온다. 프로덕션 빌드에는 없는 비용이다.
  **리허설 전에 라우트를 한 번씩 예열하면** 관통 2:22 → 1:28로 줄어든다(실측)
- **빈 본문이 4회 중 1회 관측된다** (`json_object` 모드, 종료 사유 `stop`인데 본문만 빔).
  `schema_invalid` → §11.6 재시도 경로로 처리된다. 재호출로 해소됨을 실측
- **컨텍스트 캐싱이 자동으로 걸린다** (실측 913 중 896 적중). 시스템 프롬프트를 바이트 단위로 고정할 이유가 실효를 갖는다
- **예비 경로는 Gemini** — `AI_PROVIDER=gemini`. 무료 티어는 모델당 하루 20회라 대본 3회분이고,
  일일 한도는 대기로 회복되지 않는다. 상시 경로로 쓰지 않는다

### 데모 대본 제약 (확정)

- **Resend 도메인 미인증으로 간다** (§13.3이 규정한 경로). 발신은 `onboarding@resend.dev` 고정이고
  **수신은 Resend 가입 이메일 주소로만** 된다. 따라서 §20 2:40의 신청 폼에는 **본인 가입 이메일**을 입력한다.
- 컷 라인: §20에 안 나오는 **삽입 블록 3종·순서변경**이 1순위 축소 대상.
  절대 자르지 않는 것은 **4축 검증 배지(1:15)** 와 **비로그인 `/p/{slug}` 접속(2:20)** 이다.

## 환경 변수

전부 **서버 전용**. `NEXT_PUBLIC_` 접두사 변수를 만들지 않는다 (공개 페이지도 서버 렌더링).
`DEEPSEEK_API_KEY` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `RESEND_API_KEY` · `ADMIN_PASSWORD` · `SESSION_SECRET` · `SITE_URL` · `CONTACT_INFO` · (선택) `AI_PROVIDER` · `AI_MODEL` · `GEMINI_API_KEY`(예비 경로용)

## 명령

### 키 없이 도는 것 — 처음 열면 여기부터

```bash
npm ci
npm run build:harness    # .claude/ → lib/harness/generated/registry.ts 코드젠
npm run test:harness     # 🔒 하네스 규약 위반 검사. 커밋 전 필수 (155 · 0 · 미구현 0)
npm run test:policy      # 규칙·계약 회귀 (265 · 0)
npx tsc --noEmit && npm run lint
npm run build            # 프로덕션 빌드. prebuild가 코드젠을 다시 돌려 드리프트를 잡는다
```

### AI·DB 키가 필요한 것

```bash
npm run dev              # 개발 서버 (predev가 코드젠을 돌린다)
npm run probe:deepseek   # 주 AI 경로 실측 — 키·모델을 건드렸으면 이것부터
npm run test:demo        # §20 대본 관통. dev 서버 필요 · **AI 5회 + 이메일 1통**
npm run test:exhaustion  # 재시도 소진 경로. AI를 일부러 실패시킨 서버가 필요하다
```

`test:demo`·`test:exhaustion`은 `KEEP=1`을 붙이면 데이터를 남긴다(기본은 지운다).

**첫 요청은 라우트 컴파일 때문에 느리다.** 관통 실측 2:22(첫 실행) → 1:28(예열 후).
시연·측정 전에는 한 번 돌려 예열한다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
