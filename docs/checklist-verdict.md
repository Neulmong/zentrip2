# 체크리스트 전수 판정 — 1차 (정적 판정)

판정일 2026-08-11 · 대상 `checklist.md` 355개 항목 · **AI 호출 0회**

> **2026-08-12 재판정 (spec 2.6)** — 주 AI 공급자가 Gemini → **DeepSeek**으로 바뀌면서
> A 섹션의 공급자 의존 항목 7개를 다시 봤다. 아래 표에 «2.6:» 로 표시한 줄이 그것이다.
> **A-19가 🚫(구조적 충족 불가) → ✅로 뒤집혔다** — DeepSeek은 컨텍스트 캐싱이 무료로
> 자동 동작한다(실측 913 입력 토큰 중 896 적중). 나머지 6개는 근거 문구만 바뀌고 판정은 같다.

## 판정 기호

| 기호 | 뜻 |
|---|---|
| ✅ | 충족 — 코드·자동 테스트로 확인 |
| ❌ | **미충족** — 고쳐야 한다 |
| ⚠️ | **문구가 2.2 기준** — spec 2.5로 재해석해 판정 (CLAUDE.md 지시) |
| 📦 | 2차(산출물 판정)로 넘김 — AI 생성물을 읽어야 한다 |
| 🚫 | 판정 불가 — 배포·사람 눈·미확보 자료 |

---

## A. 실행 구조 (24) — ✅17 ⚠️5 📦2

| ID | 판정 | 근거 |
|---|---|---|
| A-01 | ✅ | AI 호출 라우트 6개, 각 `ai().call` **1회**(실측 grep). 나머지 13개는 0회 |
| A-02 | ✅ | `BROCHURE_PHASES` 3 + 등록 1 = 4요청 |
| A-03 | ✅ | `PAGE_PHASES` 3요청 |
| A-04 | ✅ | `execution_logs` AI 기록 57건, **최대 10,366ms**, 60초 초과 0건 |
| A-05 | ✅ | `runStep`에 재시도 루프 없음. 재호출은 `run-pipeline.ts` |
| A-06 | ✅ | `products.retry_counts` 4종, `hasRetryBudget`가 판정 |
| A-07 | ✅ | `setInterval`·폴링 0건. 백오프는 실패 후 대기(폴링 아님) |
| A-08 | ✅ | `AI_TIMEOUT_MS = 25_000`, `maxDuration = 60` 라우트 16개 |
| A-09 | ✅ | 큐·Cron·워커 0건 |
| A-10 | ✅ | `applications/route.ts:139` `after()` |
| **A-11** | ⚠️→✅ | 문구는 `claude-opus-5`(2.4). **2.6은 `deepseek-v4-flash`** — 코드 일치, 날짜 접미사 없음. «2.6: `pro` 계열은 `assertAllowed`가 호출 전에 차단 — `test:policy` U20» |
| A-12 | ✅ | `temperature`·`top_p`·`top_k`·`budget_tokens`·`output_format` **0건** |
| **A-13** | ⚠️→✅ | Claude `output_config.effort` → «2.6: DeepSeek `reasoning_effort` 생성 `medium`/검증 `low`». 예비 경로는 `thinkingLevel` `MEDIUM`/`LOW`. 생성·검증 구분이 양쪽 모두 일치 |
| **A-14** | ✅ | **1차 판정에서 ❌로 적었던 것을 정정한다.** `@google/genai`는 `retryOptions`를 **넘기지 않으면 재시도하지 않는다**(`apiCall`: `if (!retryOptions) return runFetch()`). 타입 문서의 「default to 5」는 `retryOptions`를 넘겼을 때 `attempts`의 기본값이라 그것을 옵션 자체의 기본값으로 오독했다. **실측: 429 응답에 나가는 HTTP 요청 1회** (`test:policy` U18). DeepSeek은 `maxRetries: 0` ✅ |
| **A-15** | ⚠️→✅ | Claude `output_config.format` → «2.6: 주 경로는 `json_object` + **`lib/ai/schema.ts` 서버 검증**이 강제 지점». 프롬프트 "JSON만 출력" 지시는 스키마 명세 형태로만 존재하고, 구조 보증은 서버가 진다(§4.3 표). 예비 경로는 `responseSchema` |
| **A-16** | ⚠️ | `additionalProperties`는 Claude strict 모드 요구사항. 주 경로의 서버 검증기·예비 경로의 `responseSchema` 모두 요구하지 않음 → **해당 없음**. 스키마에 재귀·수치·문자열 길이 제약 0건 ✅ |
| A-17 | ✅ | «2.6: `deepseek.ts` — `finish_reason`(`length`·`content_filter`) → 빈 본문 → 파싱 → 스키마 순서». 예비 경로 `gemini.ts`는 `blockReason` → `finishReason` → 본문 |
| **A-18** | ⚠️→✅ | `cache_control`은 Claude 전용. «2.6: DeepSeek은 **요청 필드 없이 자동 캐싱**되므로 「캐시 지시자」에 대응하는 코드가 없는 것이 정상이다». 시스템 프롬프트 상수화·가변값 0건이 그 조건을 만족시킨다 ✅ |
| **A-19** | ⚠️→🚫→**✅** | «2.6: 뒤집혔다. `cachedTokens`가 실제로 0이 아니다 — 실측 입력 913 토큰 중 **896 적중**(`prompt_cache_hit_tokens`). 2.5에서 「무료 티어라 구조적으로 충족 불가」로 적었던 항목이 공급자 교체로 해소됐다» |
| A-20 | ✅ | `#3`·`#5` 실패 → `409 retry`. AI 실패 6종 전부 같은 경로(`AiErrorType` 6종) |
| A-21 | ✅ | `lib/policy.ts` `PRECONDITIONS`가 §14.5 표와 1:1. `current_step` 조건 0건. `test:policy` |
| A-22 | 📦 | 재시도 6경로·재생성 3경로의 **실제 재실행** 확인 필요 |
| A-23 | ✅ | `ConflictExtra` 판별 유니온으로 `reason` 강제. `test:stale` 19건 |
| A-24 | ✅ | `retry_from` §11.6 일치, `items` 동봉. `test:policy` |

---

## B. 데이터 저장 무결성 (11) — ✅9 📦2

| ID | 판정 | 근거 |
|---|---|---|
| B-01 | 📦 | 5개 산출물이 다 찬 행 확인 필요 |
| B-02 | ✅ | `execution_id` UNIQUE (마이그레이션). `verify:schema` |
| B-03 | ✅ | 교체 경로는 #17뿐(`test:stale` #17, `RESUBMIT_PLAN`) |
| B-04 | ✅ | `products`에 `theme` 컬럼 없음. `page_content.theme`에만 |
| B-05 | ✅ | `verify:schema` 기본값 검증 |
| B-06 | ✅ | `writeFile`·`outputs/run-`·`brochure.html` **0건** |
| B-07 | ✅ | `slug` UNIQUE, 생성 전 NULL. `test:api` |
| B-08 | ✅ | `set_updated_at` 트리거 (밀리초 절단) |
| B-09 | ✅ | `verify:schema` 4종 확인 |
| B-10 | ✅ | `abnormality_flags`에 `attempt_no`·`product_id` |
| B-11 | ✅ | 마이그레이션 129·164행 `on delete set null` |

---

## C·D. 폼 입력 · 선택 항목 (25) — ✅18 📦7

| ID | 판정 | 근거 |
|---|---|---|
| C-01·C-02 | ✅ | `validateFormInput` 프론트·서버 공유. `test:api` 400 + 행 미생성 |
| C-03·C-04·C-05 | ✅ | `hasDayMarker`, 40자, 15일 상한. `test:policy`·`test:api` |
| C-06·C-07 | ✅ | `form_input` 최상위 6키, `일정`은 `행사정보` 하위. `test:api` |
| C-08~C-12 | 📦 | `confirmed_data` 실물 대조 필요 |
| C-13 | ✅ | `CHILD_NOT_OFFERED = '해당 없음'`. `test:api` |
| C-14 | ✅ | `test:api` §7.4 구조 7건 |
| C-15·C-17·C-18 | ✅ | `normalize.ts` `space()`/`combineTripPeriod`/`tripDays`. `test:policy` |
| C-16 | ✅ | 폼이 숫자 입력 + `원` 고정 접미사 |
| C-19 | ✅ | `PLACEHOLDER`는 `buildConfirmedData`에서만. `test:api` |
| D-01·D-05·D-06 | ✅ | `fill()` 4개 선택 항목, 파생 계산 없음 |
| D-02·D-03·D-04 | 📦 | 소개서·페이지 양쪽 표기 대조 필요 |

---

## E. 일정 분해 · 숫자 출처 (12) — ✅5 ❌2 📦5

| ID | 판정 | 근거 |
|---|---|---|
| E-01 | ✅ | `일정원문`에 `space()`만 적용 |
| E-02~E-04 | 📦 | 실제 분해 결과 대조 필요 |
| E-05 | ✅ | 3단계 구현 — `checkEvidence`(기계) → `checkNouns`(기계) → AI. `axis0.ts:90~` |
| E-06·E-07·E-08 | ✅ | `PLACEHOLDER` 채움 + `itinerary_partial`, `day_overflow`, `no_day_marker` 3분기. `DAY_MARKERS` 6종 |
| E-09 | ✅ | `category = pipeline`. `test:api` |
| **E-10** | ❌ | **숫자 출처 판정 4단계 중 기계 1~3단계가 없다.** §6.3.1은 「기계 토큰 추출 → 허용 출처 4종 포함 검사 → 위반 후보 표시 → AI 확인」을 요구하는데, 구현은 **4단계(AI 확인)만** 있다 — 근거는 `ai-contracts.ts:100`의 프롬프트 한 줄뿐 |
| **E-11** | ❌ | 같은 이유. 허용 출처 4종(`form_input` 전체 · 같은 일차 `원문근거` · **일차 번호** · **여행기간 일수/일수−1**)을 **기계로 검사하는 코드가 없다.** `checkNouns`는 명사구용이고 `haystack.includes(후보)` 방식이라 이 규칙과 다르다 |
| E-12 | ✅ | `checkNouns`가 `일정[].내용`(서술 필드)에만 적용 |

---

## F. 이미지 (13) — ✅12 📦1

`npm run test:images` **28건 전부 통과**로 F-01·02·03·04·05·06·11·12·13 실측 완료.

| ID | 판정 | 근거 |
|---|---|---|
| F-01·F-02·F-04·F-05·F-06·F-11·F-12 | ✅ | `test:images` |
| F-03 | ✅ | 사라진 슬롯을 **지우지 않고 로그만** 남김(`form-input:192`) → "확인 없는 삭제 0건" 충족. ※ 해석 여지는 아래 「판정 유의」 참조 |
| F-07 | ✅ | `hero` 미업로드 시 테마 그라디언트 폴백 (`sections.tsx`) |
| F-08 | ✅ | `verify:responsive` 375px 69건 |
| F-09 | ✅ | `media.tsx` `priority` / `next/image` 기본 lazy |
| F-10 | ✅ | `form.tsx:411` 저작권·초상권 고지 |
| F-13 | ✅ | `test:images` 보상 삭제 확인 |

---

## G·H. 소개서 · 페이지 (38) — ✅13 📦25

구조·규칙은 코드로 확인되나, **값 반영·표기는 산출물 판정(2차)** 대상이다.

| ID | 판정 | 근거 |
|---|---|---|
| G-08·G-09 | ✅ | 소개서에 이미지·테마 미적용, jsonb + 고정 컴포넌트 |
| G-10·G-11·G-12·G-13 | ✅ | `status-view.ts` 배지·버튼, `validate-brochure` 소진 시 `brochure_ready`+`axis_1=fail`. `test:policy` |
| G-14 | ✅ | `409 retry_from:3` + `검증영역: "생성"`. `test:policy` |
| G-15 | ✅ | `checkBrochure()` — 섹션 8개·순서·source·토큰·길이 4종 |
| G-01~G-07 | 📦 | 실제 `brochure_content` 대조 |
| H-05·H-06·H-07·H-11·H-12·H-13·H-14·H-15·H-16 | ✅ | `buildPage`/`checkPage`/`resolveTheme`/`RESET_ON['product-create']`. `test:policy` |
| H-01~H-04·H-08~H-10 | 📦 | 실제 `page_content` 대조 |

---

## I. 검증 4축 (23) — ✅12 📦11

| ID | 판정 | 근거 |
|---|---|---|
| I-02 | ✅ | 0차가 `decompose` 요청 안에서 AI 1회로 처리 |
| I-05 | ✅ | 기준값이 `form_input`(`validate-brochure`/`validate-page` user 프롬프트) |
| I-06 | ✅ | 3차 시작 조건 `axis_2 = pass` (`PRECONDITIONS`) |
| I-15·I-16·I-17 | ✅ | `emptySnapshot`/`computeVerdict`/`withAxis`. `test:policy` |
| I-18 | ✅ | `VALIDATION_SCHEMA`가 판정·`items`만. 재시도 판단은 `runStep` |
| I-20 | ✅ | `ValidationItem` 6필드 |
| I-21 | ✅ | `items` 상한·조기 중단 없음 |
| I-22 | ✅ | `contentHash` 사전순 정렬 + SHA-256 + `sha256:` 접두사. `test:policy` |
| I-23 | ✅ | 상세 화면 "검증 이후 편집됨" |
| I-19 | ✅ | 이미지-텍스트 내용 정합성 검증 항목 없음 |
| I-01·I-03·I-04·I-07~I-14 | 📦 | 실제 판정 결과 대조 |

---

## J. 편집기 (25) — ✅24 📦1

`lib/edit-contract.ts` + `Editor.tsx` 정독 완료. `test:policy` 다수 포함.

| ID | 판정 | 근거 |
|---|---|---|
| J-01 | ✅ | 수정·삭제·삽입·순서변경 4종 모두 배선(`Editor.tsx:96,113,306,333`) |
| J-02·J-04 | ✅ | `locked` 섹션 숨김 차단, 삭제는 `visible:false` |
| J-03·J-13 | ✅ | `APPLY_EDITABLE` 2키만, 불변 항목 검사 |
| J-05·J-05b·J-05c | ✅ | `BLOCK_TYPES` 3종, `blk_` 접두사, `renumber()`가 hero/apply 사이 강제 |
| J-06 | ✅ | `checkImageRefs` — `image_id`가 업로드분에만 |
| J-07 | ✅ | `renumber()`/`moveSection()` |
| J-08 | ✅ | `validateEdit` 테마 변경 거부 |
| J-09 | ✅ | `LENGTH_LIMITS_SAVE` 6종. `test:policy` |
| J-10·J-11·J-12 | ✅ | `human_edited`, `diffSections` 4종 action, `content_edited` |
| J-14 | ✅ | 편집 후 재검증 라우트 없음 |
| J-15·J-16 | ✅ | `verificationBadge`/`editBadge` 2축 독립. `test:policy` |
| J-17·J-22 | ✅ | `PRECONDITIONS.content` — `page_content` 존재 + 4상태 |
| J-18 | ✅ | `verify:responsive` 뷰포트 전환 3종 |
| J-19 | ✅ | 미리보기가 편집기 내부. 공개 경로 0건 |
| J-20·J-21 | ✅ | slug 편집·`slug_changed`·게시 중 경고 |
| J-23 | 📦 | 삽입 블록이 2·3차 대상에 포함되지 않았는지 실물 확인 |

---

## K. 게시 · URL (15) — ✅12 🚫1 📦2

| ID | 판정 | 근거 |
|---|---|---|
| K-01·K-02·K-03·K-04 | ✅ | `proposeSlug`/`withSuffix`, 한글 → `p-{base36}`, `slug_conflict`. `test:policy` |
| **K-05** | 🚫 | **실제 배포 필요.** `.vercel` 없음, 미배포 → **판정 불가** |
| K-06 | ✅ | `loadPublishedBySlug`가 쿼리에 `status='published'` 고정. `test:publish` |
| K-07~K-10 | ✅ | `publishGate`/`publishProcedure`. `test:policy` 다수 |
| K-11·K-12·K-13 | ✅ | slug 조건 `draft/reviewing`, `published_at` 덮어쓰기 금지. `test:publish` |
| K-14 | ✅ | `unpublish` 후 404 + 신청 보존. `test:publish` |
| K-15 | ✅ | 자동 게시 경로 0건 |

---

## L·M. 신청 · 이메일 (20) — ✅18 🚫1 📦1

`test:application` **63건 전부 통과** (§13.3 본문 15건 신규 포함).

| ID | 판정 | 근거 |
|---|---|---|
| L-01~L-08·L-10 | ✅ | `test:application` |
| L-09 | ✅ | `verify:responsive` 375px |
| M-02~M-08·M-10 | ✅ | `test:application` §13.3 본문 검사 10항목 + 총액 0건 + URL 안내 문구 |
| **M-01** | 🚫 | **실제 수신 확인 필요.** Resend 도메인 미인증이라 가입 이메일로만 도달 — 사람이 메일함을 봐야 함 |
| M-09 | ✅ | `test:admin-applications` 재발송 + `email_resent` |

---

## N·O. 상태 · 재생성 (28) — ✅25 📦3

| ID | 판정 | 근거 |
|---|---|---|
| N-01·N-02·N-04·N-06·N-07·N-08·N-11 | ✅ | `status-view.ts` §15.1 표 그대로. `test:policy` 다수 |
| N-03·N-03b | ✅ | `input_error`는 0차·폼에서만. **이번 세션 A-0 수정으로 422 + 폼 복귀 확정.** `test:exhaustion` 12건 |
| N-05 | ✅ | `/new?product_id=` 값 유지 + 사유. `test:exhaustion` |
| N-09·N-10 | 📦 | 전이 이력 대조 |
| N-12·N-13 | ✅ | `RESUME_AT` 6행, `precondition` → refetch |
| N-14·N-15 | ✅ | #17만 `form_input` 교체, `input_error`에서만. `test:stale` |
| N-16 | ✅ | `page` 소진 → `brochure_ready` + `axis_2=fail` |
| O-01~O-05·O-08·O-09·O-11 | ✅ | `planRestart`/`RESET_ON`/`discardAxes`. `test:policy` |
| O-06 | 📦 | 폐기 축의 로그 추적 확인 |
| O-07 | ✅ | `human_edited` 확인 모달 |
| O-10 | ✅ | `page` 라우트가 기존 slug 재사용 |

---

## P·Q·R·S. 인증 · 로그 · 플래그 · 재시도 (39) — ✅33 ⚠️2 🚫1 📦3

| ID | 판정 | 근거 |
|---|---|---|
| P-01·P-02 | ✅ | `proxy.ts` middleware. `test:api`·`test:demo` |
| P-03 | ✅ | HMAC + httpOnly + SameSite=Lax (`Secure`는 프로덕션만 — 로컬 http 제약) |
| P-04 | ✅ | 상수 시간 비교 + 분당 5회. **이번 세션 A-3 수정으로 실패만 집계.** `test:auth` 9건 |
| P-05·P-06·P-07 | ✅ | `/admin` 필터 8종, 신청 내역, 연락처 마스킹 |
| **P-08** | ⚠️→✅ | 문구가 `ANTHROPIC_API_KEY`(2.4). «2.6은 **`DEEPSEEK_API_KEY`**, `GEMINI_API_KEY`는 예비 경로용». `NEXT_PUBLIC_` 0건, 전부 서버 전용 ✅ |
| P-09 | ✅ | 19개 엔드포인트 존재·메서드 일치. `test:stale`이 13개 쓰기 라우트 실측 |
| Q-01~Q-05·Q-08 | ✅ | `test:logs` 34건 |
| Q-06·Q-07 | 📦 | 11단계·lifecycle 6종 전수 기록 확인 |
| Q-09 | ✅ | 저장은 영어, 화면만 한글. `test:api`·`test:logs` |
| Q-10 | ✅ | 저장 시점 마스킹. `test:application` |
| Q-11 | ✅ | `validate-page`·`validate-consistency` 양쪽 `trailingLogs` |
| **Q-12** | ⚠️→🚫 | `stop_reason`(→`finish_reason`)·`usage`·`error_type`은 기록 ✅. **`cache_read_input_tokens`는 무료 티어 캐싱 불가로 충족 불가** (A-19와 같은 사유) |
| Q-13 | ✅ | 로그는 트랜잭션 밖, 실패해도 본 동작 유지 |
| Q-14 | ✅ | `form_input_resubmitted` 기록 |
| R-01·R-03·R-05·R-06·R-07 | ✅ | `logging.ts`, `verify:schema` 중복 차단 |
| R-02 | ✅ | `runStep` 순서 — 로그 → 플래그 |
| R-04 | ✅ | 5종 전부 구현(`logging.ts:180~215`) |
| S-01~S-09 | ✅ | `RETRY_LIMIT=2`, 4종 비공유, `RESET_ON`, `COUNTER_AXIS` 1:1. `test:policy` 다수 |

---

## T. 에이전트 권한 및 실행 순서 (11) — ⚠️11

**섹션 전체가 재해석 대상이다.** T 섹션은 「에이전트 6종 + 스킬 15개」 아키텍처를 전제하는데, CLAUDE.md가 **`.claude/agents/`·`.claude/skills/`를 "구현 중 참조 금지"(2.2 기준이라 spec 2.5와 23건+ 어긋남)** 로 규정했고, 실제 구현은 **서버 라우트가 직접 AI를 1회 호출**하는 방식이다.

| ID | 판정 | 재해석 |
|---|---|---|
| T-01 | ⚠️→✅ | 에이전트 6단계 = 라우트 6개(`decompose`→`brochure`→`validate-brochure`→`page`→`validate-page`→`validate-consistency`). 각 단계 종료 직후 `writeLogs` + `detectAbnormalities` ✅ |
| T-02 | ⚠️→✅ | 0차는 `decompose` 안에서 기계 검사 + AI 1회 ✅. 검증 라우트는 판정·`items`만 반환 ✅ |
| T-03 | ⚠️→✅ | 라우트 1건 = AI 1회, 연쇄 호출 0건 ✅ |
| T-04 | ⚠️→✅ | `execution_id`·`attempt_no`·`retry_counts`·`current_step` DB 보관 ✅ |
| T-05 | ⚠️→✅ | 분해가 `decompose`에서 수행되고 `confirmed_data`에 담김 ✅ |
| **T-06** | ⚠️→❌ | **「스킬 15개가 모두 실제로 하는 일이 있다」는 현 아키텍처에서 성립하지 않는다.** 스킬 문서는 호출되지 않는다(CLAUDE.md가 참조 금지) |
| T-07 | ⚠️→✅ | 삭제된 3개 참조 0건 |
| T-08 | ⚠️→✅ | Step별 AI 1회 배정 일치 |
| T-09 | ⚠️→✅ | 라우트 1건 = AI 1회 ✅ |
| T-10 | ⚠️→✅ | `buildConfirmedData` 안에서 `fill()`이 정규화보다 먼저 |
| T-11 | ⚠️→✅ | draft 등록을 서버 라우트가 수행 ✅ |

---

## U·V. 보안 · 반응형 (17) — ✅8 🚫9

| ID | 판정 | 근거 |
|---|---|---|
| U-01~U-05 | 🚫 | **`SUPABASE_ANON_KEY` 미설정** — 스크립트는 완성돼 있고 키만 넣으면 즉시 실행 |
| U-06·U-07·U-08 | ✅ | `test:security` 7건 |
| U-09 | 📦 | 잔여 항목 |
| V-01 | ✅ | `docs/responsive-verification.md` + `verify:responsive` |
| V-02·V-03·V-05 | ✅ | `verify:responsive` 69건 실측(기록만 한 건 0건) |
| V-04 | ✅ | 생성 4종 / 편집 6종. `test:policy` |
| **V-06** | ✅ | **육안이 아니라 계산으로 판정했다.** WCAG 2.1 상대 휘도 공식으로 7종 전부 실측 — 본문 대비 최저 `resort 12.97:1`, 기준 4.5:1을 전부 상회. 폼 label 20개 htmlFor↔id 일치, 이미지 alt, 다크 모드 0건까지 `verify:a11y` 24건 통과 |
| **V-07** | 🚫 | **LCP 2.5초 미측정** — 배포 후에야 의미 있는 수치 |
| V-08 | ✅ | 진행 표시 + 실패 사유·버튼. 이번 세션 A-0·A-1로 개선 |

---

## W·AA·AB (25) — ✅17 📦7 🚫1

| ID | 판정 | 근거 |
|---|---|---|
| W-01~W-07 | 📦 | **AI 생성분 기준** — 2차 판정 대상(§W 머리말이 명시) |
| AA-01·AA-02 | ✅ | **이번 세션 B-2로 13개 쓰기 라우트 전부 충족.** `test:stale` 19건 |
| AA-03 | ✅ | `run-pipeline.ts` stale → refetch, 자동 재시도 0건 |
| AA-04 | ✅ | 편집기 "다른 사람이 먼저 저장했습니다" |
| AA-05 | ✅ | `withSuffix` 5회 → `slug_conflict` |
| AA-06·AA-07 | ✅ | 보상 삭제로 트랜잭션 경계 구현, Storage·로그는 밖 |
| AA-08 | ✅ | `test:images` F-13 |
| AB-01~AB-10 | ✅ | `test:delete` 30건 |

---

## X·Y·Z. 승인 준비 · 범위 위반 · 게이트 (29) — ✅13 🚫5 📦11

| ID | 판정 | 근거 |
|---|---|---|
| X-01~X-04 | 📦 | 산출물·실행 이력 기반 |
| **X-05** | 🚫 | **입력→배포 10분 실측** — 배포 미실시로 판정 불가 |
| Y-01~Y-13 | ✅/📦 | 범위 위반(코드·디자인 작업 0건 등) — 코드로 확인 가능한 것은 ✅, 산출물 기반은 📦 |
| Z 게이트 | — | G0~G6은 위 섹션 판정의 합. 아래 요약 참조 |

---

# 1차 판정 요약

| 판정 | 개수 | 비율 |
|---|---:|---:|
| ✅ 충족 | **약 233** | 66% |
| 📦 2차(산출물)로 이월 | **약 71** | 20% |
| 🚫 판정 불가 | **약 19** | 5% |
| ⚠️ 재해석 후 충족 | **약 29** | 8% |
| ❌ **미충족** | **3** | 1% |

## ❌ 미충족 3건 — 고쳐야 할 것

| ID | 내용 | 심각도 |
|---|---|---|
| **E-10** | 숫자 출처 판정의 기계 단계(토큰 추출)가 없다 | 🟠 |
| **E-11** | 허용 출처 4종 기계 검사가 없다 | 🟠 |
| **T-06** | 스킬 15개가 호출되지 않는다(아키텍처 변경으로 무효) | ⚪ 문서 정리 |

## 🚫 판정 불가 19건 — 막고 있는 것 3가지

| 막는 것 | 항목 |
|---|---|
| **미배포** | K-05 · X-05 · V-07 |
| **`SUPABASE_ANON_KEY` 없음** | U-01~U-05 (5건) |
| **사람 눈·수동** | M-01(메일 수신) ※ V-06은 계산으로 해소 |
| **무료 티어 구조적 한계** | A-19 · Q-12 (컨텍스트 캐싱 불가) |

## ⚠️ 재해석 29건 — 체크리스트가 2.2/2.4 기준

CLAUDE.md의 지시(*"AI 공급자 항목은 spec 2.5 기준으로 읽는다"*)대로 판정했다.
`A-11`(모델명) · `A-13`(effort) · `A-15`(스키마 강제) · `A-16`(additionalProperties) ·
`A-18`·`A-19`(캐싱) · `P-08`(환경변수명) · `T` 섹션 전체(에이전트/스킬 아키텍처).

**체크리스트 본문을 2.5로 갱신하지 않으면 다음 판정자도 같은 혼선을 겪는다.**

## 판정 유의 1건

**F-03** — "여행기간 축소 시 사라진 슬롯의 이미지 삭제를 사용자에게 확인한다(확인 없는 삭제 0건)".
구현은 **삭제하지 않고 로그만** 남긴다. 뒷부분("확인 없는 삭제 0건")은 충족이지만
앞부분("확인")에 해당하는 UI는 없다. **판정자 해석에 달린 [필수] 항목**이다.

---

# 2차 판정 (산출물) — 2026-08-11 · AI 0회

`npm run verify:artifacts` — **통과 75 · 실패 0 · 건너뜀 2**

판정 대상: 4축 통과 + 산출물 3종 완비 **2건**

| 상품 | 성격 | 덮은 경로 |
|---|---|---|
| `jeju-edit-test` | 생성 직후 | 생성 경로 |
| `p-5aw6et` | 사람 편집(삽입 블록 2개) | 편집 경로 · 블록 규정 |

판정기는 **서버가 생성 직후 돌리는 검사기를 그대로 재사용**한다
(`checkBrochure`·`checkPage`·`checkEvidence`·`checkNouns`·`contentHash`).
기준이 두 벌이 되면 어느 쪽이 맞는지 알 수 없기 때문이다.

## 해소된 📦 항목

| 섹션 | 항목 | 결과 |
|---|---|---|
| B | B-01 | ✅ 산출물 5종 완비 |
| C | C-07·C-08·C-12·C-17·C-19 | ✅ 입력 10필드 글자 단위 대조 — 변형 0건 |
| D | D-02·D-03·D-04 | ✅ `추후 추가 예정`이 양쪽에 동일 표기 |
| E | E-02·E-03·E-04 | ✅ 일차 수 일치 · 원문근거 부분문자열 · 창작 명사 0건 |
| G | G-01·G-01b·G-01c·G-04·G-05·G-05b·G-07·G-15 | ✅ 서버 검사 통과 |
| H | H-01·H-01b·H-01c·H-03b·H-04b·H-05·H-06·H-07·H-09·H-13·H-15 | ✅ |
| I | I-07·I-15·I-16·I-20·I-21·I-22 | ✅ |
| J | J-05b·J-05c·**J-23** | ✅ 삽입 블록이 검증 items에 0건 |
| W | W-01~W-06 | ✅ 고유명사·가격 원본 유지 |

**J-23이 특히 중요하다** — §10.4의 책임 분리(사람 편집분은 AI 검증 대상이 아니다)가
실제 데이터에서 지켜지고 있음을 확인했다. 검증 기록 어디에도 `blk_`가 없다.

## 남은 한계

표본 2건. *"…한 건이 0건이다"* 문구는 「지금까지의 모든 실행에서」라는 뜻이므로
표본이 늘수록 단단해진다. 다만 두 건이 **생성 경로와 편집 경로로 갈려** 최소 조건은 충족한다.
관통 1회(AI 6회)를 더 성공시키면 `verify:artifacts` 재실행만으로 갱신된다.

---

# 3차 — 게이트 판정 및 남은 작업

## Z. 최종 판정 게이트

체크리스트 규칙: **앞 게이트가 실패하면 뒤 게이트는 판정하지 않는다.**
아래는 순서를 무시하고 전부 미리 판정한 것이다 — 막힌 것을 풀 때 무엇이 남는지 보이게 하려는 목적이다.

| 게이트 | 대상 | 판정 | 막는 것 |
|---|---|---|---|
| **G0. 실행 구조** | A | ✅ **통과** | (A-19는 무료 티어 구조적 불가 — 예외 처리 필요) |
| **G1. 입력·데이터 무결성** | B·C·D·E·F·W | ❌ **실패** | **E-10·E-11** 숫자 출처 기계 검사 없음 |
| **G2. 소개서 정합성** | G + I-01~03 | ✅ **통과** | — |
| **G3. 페이지 정합성** | H + I-04~23 | ✅ **통과** | — |
| **G4. 상태·편집·게시** | J·K·N·O·V | ⏸ **보류** | K-05(미배포) · V-06(육안) · V-07(LCP) |
| **G5. 신청·이메일·보안** | L·M·U | ⏸ **보류** | U-01~05(`ANON_KEY`) · M-01(수신 확인) |
| **G6. 기록·운영 완결성** | P·Q·R·S·T·AA·AB·X·Y | ❌ **실패** | **T-06** 스킬 미호출 · (Q-12 구조적 불가) · X-05(미배포) |

**핵심**: 실제로 「만들다 만 것」은 **G1의 2건(E-10·E-11)** 과 **G6의 문서 정리 1건(T-06)** 뿐이다.
G4·G5의 보류 9건은 코드 문제가 아니라 **환경(배포·키·사람 확인)** 이고,
G6의 T-06은 아키텍처 변경에 따른 **문서 정리** 대상이다.

---

## 남은 작업 — 확정 목록

### 🔴 P0 · 데모(2026-08-14, 3일 뒤) 직결

| # | 작업 | 유형 | 해소되는 항목 | 비용 |
|---|---|---|---|---|
| 2 | ~~**AI 쿼터 확보**~~ — **2026-08-12 해소.** DeepSeek 충전 완료 → spec 2.6에서 **주 공급자로 승격**(Gemini는 예비). 실측 `npm run probe:deepseek` 통과 | 환경 | §20 대본 완주 | 완료 |
| 3 | **커밋 푸시** (원격이 step06에 멈춰 있음) | 운영 | 유실 위험 제거 | 5분 |
| 4 | **Vercel 배포** | 운영 | **K-05 · X-05 · V-07 → G4 해제** | 30분~ |
| 5 | `SUPABASE_ANON_KEY` 한 줄 | 환경 | **U-01~U-05 → G5 진전** | 2분 |

**A-14 정정 기록**: 1차 판정에서 「SDK가 5회 재시도한다」고 적었으나 **오판이었다.**
SDK는 `retryOptions`를 넘길 때만 재시도한다. 다만 **넘기는 순간 기본값 5가 켜지고 429가 재시도 대상**이므로,
누군가 「명시적으로 꺼두자」며 `retryOptions`를 추가하면 그때 진짜 문제가 된다.
그 함정을 `test:policy` U18이 막는다 — 나가는 HTTP 요청 수를 직접 센다.

### 🟠 P1 · 게이트 통과용

| # | 작업 | 유형 | 해소 |
|---|---|---|---|
| 6 | **숫자 출처 기계 검사 구현** (§6.3.1 1~3단계) | 개발 | **E-10·E-11 → G1 통과** |
| 7 | `CONTACT_INFO` 실제 문구 · Resend 키 교체 | 환경 | 고객 메일 품질 |
| 9 | 신청 메일 실제 수신 확인 | 사람 | **M-01 → G5** |

### ⚪ P2 · 문서 정리 (코드 변경 없음)

| # | 작업 | 해소 |
|---|---|---|
| 10 | **체크리스트를 spec 2.5로 갱신** — A-11·A-13·A-15·A-16·A-18·A-19·P-08·Q-12 | ⚠️ 29건 |
| 11 | **T 섹션 재작성 또는 삭제** — 에이전트/스킬 아키텍처 전제 | **T-06 → G6** |
| 12 | A-19·Q-12에 「무료 티어 예외」 명시 | 구조적 불가 2건 |
| 13 | F-03 해석 확정 (현 상태 유지 / 안내 추가 / 확인 후 삭제) | 판정 유의 1건 |
| 14 | 판정 끝난 테스트 상품 3건 정리 (배포 전) | 공개 노출 제거 |

---

## 판정 근거 재현

```bash
npm run test:policy        # 209 — 규칙·계약
npm run verify:artifacts   #  75 — 산출물 (AI 0회)
npm run test:stale         #  19 — 동시성 13라우트
npm run test:images        #  28 — 이미지 F섹션
npm run test:application   #  63 — 신청·§13.3 본문
npm run test:auth          #   9 — 로그인 제한
npm run verify:responsive  #  69 — 375/768/1280
npm run test:exhaustion    #  12 — 소진 경로 (AI 실패 서버 필요)
```
