# workflow.md — 여행 상품 소개서·웹페이지·게시·신청 파이프라인

> **문서 버전 2.5** (2026-08-11). `spec.md` **2.6**과 짝을 이룬다. 개정 이력: [CHANGELOG.md](./CHANGELOG.md)
>
> 2.4 → 2.5는 AI 공급자 교체(Claude → Gemini)만 반영했다. 단계 순서·분기·복귀는 그대로다.
> spec 2.6의 공급자 재교체(Gemini → **DeepSeek** 주 · Gemini 예비)도 §4.3 안에서 끝나 이 문서는 바뀌지 않았다 —
> 단계 순서가 공급자와 무관하다는 설계가 두 번 연속 확인된 셈이다.

## 0. 이 문서의 역할과 경계

| 문서 | 담당 |
|---|---|
| `spec.md` | **무엇을·왜** — 요건, 데이터 모델, 스키마, 제약, 범위 |
| **`workflow.md`** | **어떻게 흐르는가** — 단계 순서, 담당 주체, 조건 분기, 실패 복귀, 로그 시점 |
| `checklist.md` | **어떻게 검증하는가** — 예/아니오 판정 항목과 게이트 |

**중복 회피 원칙**: 스키마·상한·규정은 이 문서에서 재정의하지 않고 `spec.md` 절을 참조한다. 두 문서가 어긋나면 **`spec.md`가 우선**한다. 아래 8개는 spec이 단일 출처이며 이 문서는 절 번호만 가리킨다.

| 항목 | 단일 출처 |
|---|---|
| AI 호출 계약 (모델·파라미터·출력 강제·실패) | `spec.md` §4.3 — 라우트는 `lib/ai`의 provider 중립 인터페이스만 호출한다 |
| 소개서 8개 섹션 `data` 키 | `spec.md` §8.7 |
| 페이지 9개 섹션 `data` 키 | `spec.md` §9.3 |
| 실패 항목 `items` 구조 | `spec.md` §11.3 |
| API 엔드포인트·AI 호출 횟수 | `spec.md` §14.4 |
| 라우트별 시작 조건 | `spec.md` §14.5 |
| 응답 코드·`reason` | `spec.md` §14.6 |
| 상태 × 화면 × 버튼 | `spec.md` §15.1 |

---

## 1. 목적

폼 입력을 기준값으로 여행 상품 소개서와 상품 페이지를 생성하고, 4축 검증을 거쳐 임시저장(`draft`)으로 등록하며, 기획자의 편집·게시를 지원하고, 고객 신청을 접수해 이메일을 발송하는 전 과정의 실행 순서를 정의한다.

---

## 2. 핵심 원칙

| # | 원칙 | 근거 |
|---:|---|---|
| 1 | **1요청 1AI호출.** 서버 라우트 1건은 AI를 최대 1회 호출한다 | spec §4.2 |
| 2 | **재시도는 클라이언트가 같은 API를 재호출**한다. 서버가 내부에서 반복하지 않는다 | spec §4.2 |
| 3 | **AI 출력은 JSON 스키마로 강제한다.** 프롬프트로 "JSON만 출력하라"고 지시하지 않는다 | spec §4.3 |
| 4 | **검증 기준값은 `form_input`**이다. `confirmed_data`는 검증 대상이지 기준이 아니다 | spec §11.1 |
| 5 | **산출물은 JSON 콘텐츠 모델**이다. AI가 HTML을 생성하지 않는다 | spec §9.1 |
| 6 | **`source` 맵을 반드시 남긴다.** `source`가 없는 사실정보 필드는 그 자체로 실패다 | spec §8.8·§9.3 |
| 7 | **입력에 없는 값을 만들지 않는다.** 일차별 서술은 `원문근거` 범위 안에서만 쓴다 | spec §6.3·§16.1 |
| 8 | **validator는 판정만 한다.** 재시도 여부는 판단하지 않는다 | spec §2.3 |
| 9 | **검증 시점은 고정된다.** 편집 이후 재검증하지 않으며, 편집분은 기획자 책임이다 | spec §10.4·§11.4 |
| 10 | **로그는 성공·실패 모두 남긴다.** 로그 기록 실패가 본 동작을 실패시키지 않는다 | spec §5.4·§16.1.1 |
| 11 | **시작 조건은 재료 기준이다.** `current_step`의 특정 값으로 걸지 않는다 | spec §14.5 |
| 12 | **모든 쓰기는 `updated_at` 조건부 갱신이다.** 불일치 시 `409 stale` | spec §16.1.1 |
| 13 | **도달할 수 없는 상태를 전제하지 않는다.** 화면·버튼은 spec §15.1 표와 대조한다 | spec §15.1 |

---

## 3. 오케스트레이션 2계층

단계가 API로 분할되므로 오케스트레이션이 두 계층으로 나뉜다.

```text
┌─ 상위: 클라이언트 (브라우저) ──────────────────────────────────┐
│  · 단계 순서 결정 및 순차 호출                                  │
│  · 진행 표시 ("일정 정리 중…" / "소개서 작성 중…")              │
│  · 409 reason 분기 (retry → 재호출 / precondition → 재조회)     │
│  · 조건 분기 (2차 fail → 3차 호출 생략)                         │
│  · 이탈 후 복귀 시 current_step으로 재개 지점 판단               │
└───────────────────────────┬────────────────────────────────────┘
                            │ 요청 1건
┌───────────────────────────▼────────────────────────────────────┐
│─ 하위: 서버 라우트 (product-orchestrator 스킬) ─────────────────│
│  · 시작 조건 확인 (재료 기준, spec §14.5)                       │
│  · 에이전트 1개 호출 (= AI 호출 1회, spec §4.3 계약)            │
│  · 서버 검사 (스키마·source·토큰·길이 계약)                     │
│  · retry_counts 갱신, status·current_step 전이 (조건부 UPDATE)  │
│  · execution_logs 기록 → abnormality_flags 감지                │
│  · 응답 코드 + reason 결정                                      │
└────────────────────────────────────────────────────────────────┘
```

| 계층 | 담당 | 담당하지 않음 |
|---|---|---|
| 클라이언트 | 단계 순서, 진행 표시, `reason` 분기, 재개 판단 | 데이터 생성·검증·상태 확정 |
| 서버 라우트 | 시작 조건, 에이전트 1개 호출, 서버 검사, 카운터·상태·로그 | 여러 에이전트 연쇄 호출, 문장 작성, 검증 판단 |

**한 서버 라우트에서 두 개 이상의 에이전트를 연쇄 호출하면 원칙 1을 위반한다.** 예외는 AI를 쓰지 않는 스킬(`input-guard`·`data-normalization`·`draft-registration`·`execution-log-collection`·`abnormality-detection`)이며, 같은 라우트 안에서 함께 실행해도 된다.

---

## 4. 전체 흐름

```text
[기획자]
  │
  │ ══════ ② [소개서 생성] — 클라이언트가 4개 요청을 순차 호출 ══════
  │
  ├─ Step 01  상품 등록                       AI 0회   status = generating
  │            └─ 폼 재검증 실패 → 400, 행 미생성
  │
  ├─ Step 02  정규화 · 일차 분해 · 0차 검증     AI 1회
  │            ├─ 일차 초과 / 구분 불가 → 422, input_error ────────────┐
  │            └─ 0차 fail → 409 retry(2)                              │
  │                                                                     │
  ├─ Step 03  소개서 작성                      AI 1회                   │
  │            └─ 생성 실패 → 409 retry(3) / 소진 → axis_1 = fail       │
  │                                                                     │
  ├─ Step 04  1차 검증 (form_input vs 소개서)   AI 1회                   │
  │            ├─ fail & 여력 → 409 retry(3)                            │
  │            └─ fail & 소진 → 200, brochure_ready + axis_1 = fail     │
  ▼                                                                     │
소개서 검토 화면  /admin/products/{id}          status = brochure_ready   │
  │   axis_1 = pass → [상품 생성] 활성                                   │
  │   axis_1 = fail → [상품 생성] 잠김, [다시 생성]·[입력 수정]           │
  │                                                                     │
  │ ══════ ③ [상품 생성] — 3개 요청 순차 호출 · page/consistency 카운터 0 ══════
  │                                                                     │
  ├─ Step 05  페이지 생성 + slug 발급           AI 1회                   │
  │            └─ 생성 소진 → brochure_ready로 되돌림 + axis_2 = fail    │
  ├─ Step 06  2차 검증 (form_input vs 페이지)   AI 1회                   │
  │            └─ fail → Step 07 호출하지 않음 (② 라우트가 draft 등록)   │
  ├─ Step 07  3차 검증 (소개서 vs 페이지)       AI 1회                   │
  │            └─ 통과 → draft 등록                                      │
  ▼                                                                     │
임시저장 목록 (/admin)                          status = draft            │
  │                                                                     │
  ├─ Step 08  편집 (사람)                      AI 0회  status = reviewing│
  ├─ Step 09  게시 (사람)                      AI 0회  status = published│
  ▼                                                                     │
공개 URL /p/{slug} ─────────────────────────────▶ [고객]                 │
                                                    │                    │
                                    Step 10  신청 + 자동 이메일  AI 0회   │
                                                                         │
  ◀─── Step 11  [다시 생성] — brochure_ready·draft                       │
  ◀─── Step 11  [처음부터 다시] — generating (복구)                       │
  ◀─── Step 12  [입력 수정 후 재제출] — input_error ──────────────────────┘
       Step 13  삭제 — published 아니고 신청 0건일 때
```

---

## 5. 상태 전이

**단일 출처는 `spec.md` §15.1(상태 × 화면 × 버튼)과 §15.2(전이표)다.** 아래는 파이프라인 관점의 요약이며, 어긋나면 spec을 따른다.

| 상태 | 진입 조건 | 파이프라인 위치 |
|---|---|---|
| `generating` | 폼 제출 통과 / [상품 생성] / [다시 생성] / 재제출 | Step 01~04 또는 05~07 진행 중 |
| `input_error` | 일차 분해 실패(초과·구분 불가), 0차 재시도 소진 | Step 02에서 중단. **입력 문제 전용** |
| `brochure_ready` | 1차 검증 완료(통과·소진) 또는 **페이지 생성 소진** | Step 04 종료 / Step 05 소진 |
| `draft` | 2·3차 검증 완료(통과·소진) | Step 06 소진 또는 Step 07 종료 |
| `reviewing` | 편집기 최초 저장 | Step 08 |
| `published` | 게시 게이트 통과 + [게시] | Step 09 |
| `unpublished` | [게시 중단] | Step 09 이후 |

**핵심 규칙 4가지**

1. **`input_error`는 입력 문제에서만 발생한다.** AI가 재시도를 소진한 경우는 **생성물을 남긴 채 해당 축이 `fail`**이 된다(`brochure_ready` 또는 `draft`).
2. **페이지 생성이 소진되면 `draft`가 아니라 `brochure_ready`로 되돌린다.** `page_content`가 없으면 편집기가 렌더링할 대상이 없다(spec §9.5).
3. **`reviewing`·`published`·`unpublished`에서는 [다시 생성]을 제공하지 않는다.** 사람이 편집한 내용이 사라진다.
4. **`generating`은 버림받을 수 있는 유일한 상태다.** 클라이언트가 이탈하면 진행 주체가 사라지므로 복구 버튼 2개를 둔다(§9의 Step 11, spec §15.1.1).

---

## 6. 데이터 규칙

### 6.1 "폼 그룹"과 "데이터 키" 구분

| 용어 | 개수 | 구성 |
|---|---:|---|
| **필수 폼 그룹** (입력 화면 단위) | 6 | 행사정보 · **일정** · 숙박 · 상점 · 가격 · 식사 |
| **데이터 키** (`form_input`·`confirmed_data` 최상위) | 6 | 행사정보 · 숙박 · 상점 · 가격 · 식사 · **항공편** (필수 5, 항공편 선택) |

`일정`은 데이터 키가 아니라 `행사정보.일정원문` · `행사정보.일정`에 들어간다. 상세는 spec §6.0·§6.1.

**`form_input`과 `confirmed_data`는 같은 경로 체계를 쓴다**(spec §7.4). 그래서 `source` 맵의 경로를 양쪽에 그대로 적용할 수 있다.

### 6.2 form_input → confirmed_data 변환 (허용 4종)

| 구분 | 허용 범위 | 적용 대상 |
|---|---|---|
| 정규화 3종 | 날짜 `YYYY-MM-DD` | `여행기간_시작` · `여행기간_종료` 2개 필드만 |
| | 금액 콤마 제거 (단위 `원` 고정) | `가격.성인` · `가격.아동` 2개 필드만 |
| | 공백 정리 (앞뒤 제거 + 내부 축약) | 모든 문자열 필드 |
| 구조 변환 1종 | 여행기간 결합 → `{시작} ~ {종료}` | `행사정보.여행기간` |

`일정원문` · `상점정보` · `식사정보` · `가격.기타`는 **공백 규칙만** 적용한다. 이 4종 외의 변형은 0차 검증에서 실패다. 상세는 spec §6.2·§6.2.1.

| 규칙 | 내용 |
|---|---|
| 기준값 | **`form_input`** (사용자 원본 폼 입력) |
| 파생물 | `confirmed_data`는 위 4종을 적용한 산물이다. **기준값이 아니라 0차 검증의 대상**이다 |
| 여행기간 일수 | `종료 − 시작 + 1` (양끝 포함, `1 ≤ 일수 ≤ 15`). 저장하지 않고 계산한다(spec §6.2.1) |
| 수정 가능 범위 | 글의 표현, 섹션 구성, 렌더링 결과 |
| 수정 금지 | `form_input`(같은 `attempt_no` 안), 사실정보 값, 이미지 슬롯 배치 |
| 누락 데이터 | 임의 생성하지 않고 실패 항목으로 반환 |

### 6.3 일차 분해 판정 3단계

| 순서 | 검사 | 주체 | AI 호출 |
|---:|---|---|---:|
| 1 | `원문근거`가 `일정원문`의 부분 문자열인가 | 기계 | 0 |
| 2 | `내용`의 명사구 후보가 `원문근거` 또는 `confirmed_data`의 다른 값 안에 존재하는가 | 기계 | 0 |
| 3 | 2에서 표시된 후보가 실제 위반인가(조사·어미 변화 제외) | AI | Step 02의 1회에 포함 |

일차 구분 인식 범위는 **6종**(`n일`·`n일차`·`n일 차`·`첫째 날`·`Day n`·`DAY n`)이며 이 목록이 실패 판정의 기준이다. 상세는 spec §6.3.

### 6.4 출처 없는 숫자 판정 4단계

서술 필드(`핵심일정`·`days[].text`·`안내문구`·삽입 블록 `본문`)의 숫자 토큰을 검사한다.

| 순서 | 검사 | 주체 |
|---:|---|---|
| 1 | 숫자 토큰 추출 (`[0-9]+` + 뒤따르는 단위 문자) | 기계 |
| 2 | 허용 출처 4종 안에 있는지 부분 문자열 검사 | 기계 |
| 3 | 어디에도 없는 토큰을 위반 후보로 표시 | 기계 |
| 4 | 표시된 후보가 실제 위반인지 판정 | AI (같은 호출) |

허용 출처 4종은 **`form_input` 전체 · 같은 일차의 `원문근거` · 일차 번호 · 여행기간 일수(`일수`와 `일수 − 1`)**다. 상세는 spec §6.3.1.

---

## 7. 치환과 `source` 맵

### 7.1 치환 형식

```text
{{행사정보.행사명}}         → 값 그대로
{{행사정보.일정}}           → 배열. 일차별로 순회한다
{{가격.성인}}               → 120000원
{{숙박.객실타입}}           → 디럭스룸
```

**최종 출력에 중괄호 토큰과 파이프 기호가 남아 있으면 검증 실패다.**

### 7.2 조사 처리 — 값 필드에 적용하지 않는다

조사를 자동 적용하는 표기(`{{숙박.객실타입|로}}`)는 **`source`가 `"generated"`인 서술 필드 안에서만** 쓸 수 있다.

| 위치 | 조사 파이프 | 이유 |
|---|---|---|
| 사실정보 값 필드 (`숙박.객실타입` 등) | **금지** | `디럭스룸` → `디럭스룸으로`가 되면 `source` 경로의 원본값과 달라져 1·2차 검증이 실패한다 |
| 서술 필드 (`핵심일정`·`days[].text`·`안내문구`) | 허용 | 대조 대상이 값이 아니라 문장이므로 조사가 값을 오염시키지 않는다 |

상세는 spec §8.8.

### 7.3 `source` 맵이 검증의 기반이다

```json
{ "data":   { "headline": "제주 올레 바람 여행" },
  "source": { "headline": "행사정보.행사명" } }
```

- 검증기는 `source`가 가리키는 경로를 따라가 **`form_input`의 대응 값**과 대조한다.
- 출처가 없는 연결 문구는 `source`를 `"generated"`로 표기한다.
- **`source`가 없는 사실정보 필드는 검증 불가이므로 그 자체로 실패다.**
- `image_slot`·`image_slots`에는 `source`를 붙이지 않는다 — 사실정보가 아니라 이미지 참조다.
- 유일한 예외는 `행사정보.여행기간`이며, spec §6.2.1의 결합 규칙으로 대조한다.

---

## 8. 담당 범위

### 8.1 에이전트

| 구성요소 | 담당 업무 | 담당하지 않는 업무 |
|---|---|---|
| 클라이언트 | 단계 순서, 진행 표시, `reason` 분기, 재개 판단 | 데이터 생성·검증·상태 확정 |
| 서버 라우트(오케스트레이터) | 시작 조건, 에이전트 1개 호출, 서버 검사, 카운터·상태·로그, 응답 코드 | 여러 에이전트 연쇄 호출, 문장 작성, 검증 판단 |
| intake-agent | 정규화, 일차 분해, 0차 검증, `input_error` 사유 작성 | 임의 데이터 생성, 필수값 누락 판정(폼이 담당) |
| content-writer-agent | 소개서 섹션 작성 및 `source` 맵 기록 | 페이지 콘텐츠 작성, HTML 생성 |
| web-builder-agent | 페이지 콘텐츠 모델 생성, 테마 결정, slug 발급 | `form_input`·`confirmed_data` 변경, HTML 생성, **draft 등록** |
| validator-agent | 통과/실패, `items` 반환 | 재시도 여부 판단 |
| log-monitor-agent | 단계·상태·입출력·이상 플래그 기록 | 산출물 내용 수정, 알림 발송 |

> **draft 등록은 web-builder-agent가 하지 않는다.** Step 07(또는 2차 소진 시 Step 06)에서 서버 라우트가 `draft-registration`을 직접 실행한다.

### 8.2 단계별 스킬 배치

`.claude/skills/`에는 파이프라인 스킬 **15개**가 있다(워커 14 + 오케스트레이터 1).

`fact-check`는 Step 04·06에서 두 번 쓰이므로 표에 두 줄로 나타난다.

| Step | 담당 에이전트 | 스킬 | AI |
|---:|---|---|---:|
| 01 | (서버 라우트) | — (서버 validation) | 0 |
| 02 | intake-agent | `input-guard` → `data-normalization` → **`itinerary-decomposition`** | 1 |
| 03 | content-writer-agent | `intro-template-writer` → `intro-content-fill` → `tonal-manner-apply` | 1 |
| 04 | validator-agent | `fact-check` (1차) | 1 |
| 05 | web-builder-agent | `content-structuring` → `theme-design-token-match` → `web-content-structure-gen` | 1 |
| 06 | validator-agent → (서버) | `fact-check` (2차) → 소진 시 `draft-registration` | 1 |
| 07 | validator-agent → (서버) | `consistency-check` → `draft-registration` | 1 |
| 08~13 | (서버 라우트) | — | 0 |
| 매 단계 종료 | log-monitor-agent | `execution-log-collection` → `abnormality-detection` | 0 |

**스킬 배치 원칙**: 한 Step 안의 스킬들은 **AI 호출 1회 안에서** 순차 적용되거나(프롬프트 단계 구성), AI를 쓰지 않는 기계 처리다.

| Step | AI 1회를 쓰는 스킬 | AI 0회 스킬 |
|---:|---|---|
| 02 | `itinerary-decomposition` (0차의 3단계 판정도 이 호출 안에서) | `input-guard`, `data-normalization` |
| 03 | `intro-content-fill`(+`tonal-manner-apply` 연속 단계) | `intro-template-writer` |
| 05 | `content-structuring`(+`web-content-structure-gen` 연속 단계) | `theme-design-token-match` |
| 06 | `fact-check` | `draft-registration`(소진 시) |
| 07 | `consistency-check` | `draft-registration` |

---

## 9. 단계별 워크플로우

각 Step의 **시작 조건은 spec §14.5**, **응답 코드·`reason`은 spec §14.6**이 단일 출처다. 아래 표에는 그 절이 정한 값을 옮겨 적지 않고 흐름만 적는다.

### Step 01. 상품 등록

| 항목 | 내용 |
|---|---|
| 담당 | 서버 라우트 |
| API | `POST /api/products` (§14.4 #1) |
| AI 호출 | **0회** |
| 실행 조건 | 기획자가 `/new` 폼을 제출 |
| 처리 | ① 서버 재검증(spec §7.1·§7.2) → ② `products` 행 생성(`form_input`, `execution_id`, `attempt_no = 1`, 카운터 4종 0, `status = generating`, `current_step = pipeline_started`) → ③ 이미지 Storage 업로드 + `product_images` 기록 |
| 원자성 | ②③을 **단일 트랜잭션**으로 처리한다. Storage 업로드 실패 시 커밋하지 않고 400(spec §16.1.1) |
| 출력 | `{product_id}` |
| 실패 시 | **400** + 필드별 오류. 행을 만들지 않는다 |
| 로그 | `pipeline_started` |

### Step 02. 정규화 · 일차 분해 · 0차 검증

| 항목 | 내용 |
|---|---|
| 담당 | intake-agent |
| API | `POST /api/products/{id}/decompose` (#2) |
| AI 호출 | **1회** (`itinerary-decomposition`에 배정) |
| 처리 | ① `input-guard` 관문 검사 + 선택 항목 `추후 추가 예정` 채움 → ② 정규화 3종 + 결합 1종(기계) → ③ 일차 분해(AI 1회) → ④ 0차 검증(기계 3단계 + AI 판정은 ③의 호출 안에서) |
| 출력 | `confirmed_data` |
| 로그 | `itinerary_decomposed`, `normalization_validated` |

> `input-guard`의 채움이 정규화보다 **먼저**다. `data-normalization`이 그 채움 결과를 입력으로 받는다.

#### 조건 분기

```text
IF 원문 일차 수 > 여행기간 일수  OR  일차 구분 6종 식별 불가
  THEN status = input_error, failure_reason 기록 (input-guard가 사유 문장 작성)
       abnormality_flags: pipeline_aborted
       422 → /new?product_id={id} (값 유지)

ELSE IF 원문 일차 수 < 여행기간 일수
  THEN 부족한 일차를 { "원문근거": "", "내용": "추후 추가 예정" }으로 채움
       abnormality_flags: itinerary_partial
       계속 진행

IF 0차 fail  AND  retry_counts.normalization < 2
  THEN retry_counts.normalization += 1
       409 {reason:"retry", retry_from:2}   ← 클라이언트가 Step 02 재호출
ELSE IF 0차 fail
  THEN status = input_error, pipeline_aborted → 422
ELSE
  axis_0 = pass, current_step = normalization_validated → 200 → Step 03
```

> 0차 실패가 `input_error`로 귀결되는 이유: 정규화·분해는 `form_input`을 기계적으로 변환하는 작업이므로 세 번 실패하면 입력 자체에 처리 불가한 요소가 있다는 뜻이다.

### Step 03. 소개서 작성

| 항목 | 내용 |
|---|---|
| 담당 | content-writer-agent |
| API | `POST /api/products/{id}/brochure` (#3) |
| AI 호출 | **1회** (spec §4.3 계약, effort `medium`) |
| 입력 | `confirmed_data` |
| 처리 | 8개 섹션 뼈대 → 치환 → 문장 작성 → 어투 통일. **`source` 맵을 필드마다 기록** |
| 출력 | `brochure_content` — **스키마는 spec §8.7이 단일 출처** |
| 서버 검사 | 섹션 8개·순서 일치, `source` 누락 0건, 미치환 토큰 0건, 길이 계약 4종 |
| 로그 | `brochure_generated` (성공·실패 모두) |

#### 조건 분기

```text
IF AI 호출 성공  AND  서버 검사 통과
  THEN brochure_content 저장, current_step = brochure_generated → 200 → Step 04

ELSE IF retry_counts.brochure < 2          ← 타임아웃·SDK 오류·max_tokens·refusal·스키마 실패
  THEN retry_counts.brochure += 1
       409 {reason:"retry", retry_from:3}
ELSE
  status = brochure_ready, axis_1 = fail
  items에 실패 사유 1건 (검증영역: "생성")
  abnormality_flags: pipeline_aborted → 200
```

> 생성 실패와 1차 검증 실패가 같은 카운터·같은 소진 상태를 쓰는 이유: 기획자에게는 둘 다 "소개서가 제대로 안 나왔다"이고 복귀 대상도 Step 03 재호출로 동일하다. 원인 구분은 `execution_logs.output`에 남는다.

### Step 04. 1차 검증 — `form_input` vs 소개서

| 항목 | 내용 |
|---|---|
| 담당 | validator-agent (`fact-check`) |
| API | `POST /api/products/{id}/validate-brochure` (#4) |
| AI 호출 | **1회** (effort `low`) |
| 입력 | `form_input`, `confirmed_data`(허용 차이 판정용), `brochure_content` |
| 비교 대상 | `source` 맵이 가리키는 값 ↔ `form_input`의 대응 값 |
| 출력 | 판정 + `items`(spec §11.3) |
| 재시도 판단 | **클라이언트**가 `reason`으로 한다 |
| 로그 | `validation_1_completed` (통과·실패 모두) |

검증 항목과 허용 차이는 **spec §11.2가 단일 출처**다. 소개서 대상 축은 1차이며, 판정 범위는 8개 섹션 전 필드다.

#### 조건 분기

```text
IF 통과
  THEN status = brochure_ready, axis_1 = pass → 200 → 소개서 검토 화면

ELSE IF retry_counts.brochure < 2
  THEN retry_counts.brochure += 1
       (2 도달 시 abnormality_flags: retry_accumulated)
       409 {reason:"retry", retry_from:3} + items → 클라이언트가 Step 03부터 재호출
ELSE
  status = brochure_ready, axis_1 = fail
  abnormality_flags: pipeline_aborted → 200 + items
  ([상품 생성] 잠김 / [다시 생성]·[입력 수정] 제공)
```

### Step 05. 페이지 생성

| 항목 | 내용 |
|---|---|
| 담당 | web-builder-agent |
| API | `POST /api/products/{id}/page` (#5) |
| AI 호출 | **1회** (effort `medium`) |
| 시작 조건 | `brochure_content` 존재 · `axis_1 = pass` (spec §14.5 #5) |
| 입력 | `confirmed_data`, `brochure_content`, 이미지 슬롯 목록 |
| 처리 | 8→9 섹션 매핑 + 확장 서술 → 테마 결정 → `page_content` 완성 → **slug 발급** |
| 출력 | `page_content` — **스키마는 spec §9.3이 단일 출처**, slug는 spec §12.1 |
| 서버 검사 | 섹션 9개·`order` 1~9, `source` 누락 0건, 미치환 토큰 0건, 길이 계약 4종, `image_slot`·`image_slots`가 `product_images`에 존재하는 슬롯인지 |
| 로그 | `page_generated` |

**[상품 생성] 버튼이 `page`·`consistency` 카운터를 0으로 초기화한다**(spec §11.6). 이 규칙이 없으면 소진 후 다시 눌러도 즉시 실패한다.

#### 조건 분기

```text
IF AI 호출 성공  AND  서버 검사 통과
  THEN page_content + slug 저장, current_step = page_generated → 200 → Step 06

ELSE IF retry_counts.page < 2
  THEN retry_counts.page += 1 → 409 {reason:"retry", retry_from:5}
ELSE
  status = brochure_ready ← draft가 아니다
  axis_2 = fail, items 1건, pipeline_aborted → 200
```

> `draft`로 보내지 않는 이유: `page_content`가 없으면 편집기가 렌더링할 대상이 없고, 편집 라우트의 시작 조건(spec §14.5 #10)도 `page_content` 존재를 요구한다.

**slug는 재발급하지 않는다.** 이미 발급된 값이 있으면 검증 재시도·[다시 생성]에서도 유지한다(spec §12.1).

### Step 06. 2차 검증 — `form_input` vs 페이지

| 항목 | 내용 |
|---|---|
| 담당 | validator-agent (`fact-check`) → 소진 시 서버(`draft-registration`) |
| API | `POST /api/products/{id}/validate-page` (#6) |
| AI 호출 | **1회** (effort `low`) |
| 판정 범위 | 페이지 **9개 섹션 전 필드** (주 검증) |
| 추가 검증 | `image_slot`·`image_slots` 값이 지정 슬롯과 동일, `alt` 존재, `hero.headline` 40자 이내 |
| 로그 | `validation_2_completed` (+ 소진 시 `draft_registered`) |

#### 조건 분기

```text
IF 통과
  THEN axis_2 = pass → 200 → Step 07 호출

ELSE IF retry_counts.page < 2
  THEN retry_counts.page += 1 → 409 {reason:"retry", retry_from:5} + items
ELSE
  status = draft, axis_2 = fail, axis_3 = null(미실행)
  draft-registration 실행 + draft_registered 로그   ← ②가 직접 담당한다
  pipeline_aborted → 200 + items → 편집기 진입 가능

※ 2차가 fail이면 클라이언트는 Step 07을 호출하지 않는다
```

> **2차 소진 시 ②가 `draft` 전이와 로그를 함께 담당하는 이유**: ③을 호출하지 않으므로 아무도 등록하지 않으면 `draft_registered` 로그가 빠지고, 기록장만 보고는 어떻게 임시저장에 도달했는지 알 수 없다(spec §9.5).

### Step 07. 3차 검증 — 소개서 vs 페이지 + draft 등록

| 항목 | 내용 |
|---|---|
| 담당 | validator-agent (`consistency-check`) → 서버(`draft-registration`) |
| API | `POST /api/products/{id}/validate-consistency` (#7) |
| AI 호출 | **1회** (effort `low`) |
| 시작 조건 | `page_content` 존재 · `axis_2 = pass` |
| 입력 | `brochure_content`, `page_content` |
| 목적 | **교차 검증·회귀 감지** — `source` 맵 누락, 두 생성 경로의 스키마 드리프트, 검증에서 빠진 필드 |
| 출력 | 판정 + `items` + `skipped: ["apply"]` |
| 로그 | `validation_3_completed`, `draft_registered` |

섹션 대응표는 **spec §11.1이 단일 출처**다. 대조 단위는 사실정보 값이며, `원문근거`는 대조하지 않는다(0차의 몫).

#### 조건 분기

```text
IF 통과
  THEN axis_3 = pass, verdict = pass
       draft-registration → status = draft → 200 → 임시저장 목록

ELSE IF retry_counts.consistency < 2
  THEN retry_counts.consistency += 1 → 409 {reason:"retry", retry_from:5} + items
ELSE
  status = draft, axis_3 = fail, verdict = fail
  draft-registration 실행 + draft_registered 로그
  pipeline_aborted → 200 + items → 편집기 진입 가능 (책임 게시 경로 유지)
```

### Step 08. 편집 (사람)

| 항목 | 내용 |
|---|---|
| 담당 | 기획자 + 서버 라우트 |
| API | `PATCH /api/products/{id}/content` (#10), `PATCH /api/products/{id}/slug` (#11) |
| AI 호출 | **0회** |
| 시작 조건 | `page_content` 존재 · `status ∈ {draft, reviewing, published, unpublished}` |
| 처리 | 길이 계약 **6종** 검사 → `page_content` 갱신 → `human_edited = true` → 상태 전이 → `edit_history` 기록 |
| 원자성 | 위 4개를 **단일 트랜잭션**으로 처리한다(spec §16.1.1) |
| 불변 | `form_input`, `confirmed_data`, `validation_snapshot`, `attempt_no` |
| 로그 | `content_edited`, `slug_changed` (`category = lifecycle`) |

**AI 재검증을 하지 않는다.** 편집분의 사실 정확성은 기획자 책임이며, 관리 화면이 배지 2축으로 이를 드러낸다(spec §10.4).

| 항목 | 규정 |
|---|---|
| 길이 계약 | 편집 저장에서는 **6종 전부**를 검사한다. 생성 단계는 4종만이다(spec §17.1) |
| 삽입 블록 | `free_text`·`image`·`notice` 3종. 스키마는 spec §10.2. **검증 대상이 아니다** |
| 동시 편집 | 잠금을 걸지 않는다. `updated_at` 불일치 시 **409 `{reason:"stale"}`** + "다른 사람이 먼저 저장했습니다" 표시 후 재조회 |

### Step 09. 게시 (사람)

| 항목 | 내용 |
|---|---|
| 담당 | 기획자 + 서버 라우트 |
| API | `POST /api/products/{id}/publish` (#12) / `unpublish` (#13) |
| AI 호출 | **0회** |
| 게시 게이트 | `verdict = pass` → 활성 / `fail` → 실패 항목 열람 + 책임 확인 후 활성 / `input_error` → 경로 없음 |
| 처리 | `status = published`, `published_at` 기록(**최초만**) |
| 로그 | `published` / `unpublished` / `publish_override` |

게시는 재빌드 없이 DB 상태 전환으로 즉시 반영된다. `published` 외 모든 상태의 `/p/{slug}`는 404다.

### Step 10. 신청 및 자동 이메일

| 항목 | 내용 |
|---|---|
| 담당 | 고객 + 서버 라우트 |
| API | `POST /api/applications` (#14, **인증 불필요**) |
| AI 호출 | **0회** |
| 로그 | `application_received`, `email_sent` (`category = application`, **개인정보 마스킹**) |

#### 처리 순서 (순서가 규정이다)

```text
1. 서버 재검증 (필드 + 동의 여부)          위반 → 400
2. product.status = published 확인          아니면 → 409 {reason:"product_not_published"}
3. product_snapshot 구성                    ← 신청 시점 값을 고정한다
4. applications INSERT                      ← 단일 트랜잭션
5. execution_logs: application_received     ← 메일보다 먼저 · 이름·이메일·연락처 마스킹
6. 완료 응답 반환                            ← 메일을 기다리지 않는다
7. after() 안에서 Resend 발송
     성공 → email_status = sent,   로그 email_sent(pass)
     실패 → email_status = failed, 로그 email_sent(fail) — 신청은 성공 유지
```

**5번이 7번보다 앞인 이유**: 로그를 마지막에 쓰면 메일 단계에서 예외가 났을 때 신청 접수 기록 자체가 남지 않는다.

**5번을 마스킹하는 이유**: 신청 내역 화면에서 연락처를 가려도(spec §13.1) 로그 화면에서 원본이 노출되면 마스킹이 무의미하다(spec §5.4).

### Step 11. [다시 생성] · [처음부터 다시]

| 항목 | 내용 |
|---|---|
| 담당 | 기획자 + 서버 라우트 |
| API | `POST /api/products/{id}/regenerate` (#8) |
| AI 호출 | **0회** (재실행 자체는 클라이언트가 시작점부터 호출) |
| 제공 상태 | `brochure_ready` · `draft` ([다시 생성]) · `generating` ([처음부터 다시]) |
| 처리 | `attempt_no` +1, 카운터 4종 0, `status = generating`, **`current_step` 되돌림** |
| 보존 | `form_input`, `confirmed_data`, 업로드 이미지, **시작점 이전 축**, **`slug`** |
| 폐기 | 시작점 이후 산출물 + 시작점 이후 축(로그에는 남는다) |
| 로그 | `regenerate_requested` |

#### 되돌림 범위

**`validation_snapshot`을 통째로 비우면 시작 조건(`axis_0 = pass`·`axis_1 = pass`)을 충족할 수 없어 재실행이 거부된다.** 시작점 이전 축은 보존한다.

| 이전 상태 | 시작점 | `current_step` | 보존 축 | 폐기 축 |
|---|---|---|---|---|
| `brochure_ready` | Step 03 | `normalization_validated` | `axis_0` | `axis_1`~`axis_3` |
| `draft` | Step 05 | `validation_1_completed` | `axis_0`·`axis_1` | `axis_2`·`axis_3` |
| `generating` | 아래 규칙 | 시작점 직전 | 시작점 이전 | 시작점 이후 |

`generating`의 시작점은 축의 통과 여부로 정한다 — `axis_1 = pass`면 Step 05, `axis_0 = pass`만이면 Step 03, 그 외는 Step 02.

`human_edited = true`인 경우 "편집한 내용이 사라집니다" 확인 모달을 띄운다.

#### `generating` 복구 — [이어서 진행]

새 라우트를 만들지 않고 `GET /api/products/{id}`(#9)의 `current_step`으로 재개 지점을 판단한다.

| `current_step` | 다음 호출 | #14.4 # |
|---|---|---:|
| `pipeline_started` | `/decompose` | 2 |
| `normalization_validated` | `/brochure` | 3 |
| `brochure_generated` | `/validate-brochure` | 4 |
| `validation_1_completed` | `/page` | 5 |
| `page_generated` | `/validate-page` | 6 |
| `validation_2_completed` | `/validate-consistency` | 7 |

[이어서 진행]이 `409 {reason:"precondition"}`을 받으면 산출물이 저장되기 전에 요청이 끊긴 경우다. 그때 [처음부터 다시]를 쓴다. 상세는 spec §15.1.1.

### Step 12. [입력 수정 후 재제출]

| 항목 | 내용 |
|---|---|
| 담당 | 기획자 + 서버 라우트 |
| API | `PATCH /api/products/{id}/form-input` (#17) |
| AI 호출 | **0회** |
| 시작 조건 | `status = input_error`만 |
| 화면 | `/new?product_id={id}` — `form_input` 값을 채운 상태로 열고 `failure_reason` 표시 |
| 처리 | `form_input` 교체 + `attempt_no` +1 + 카운터 4종 0 + `status = generating` + `current_step = pipeline_started` |
| 폐기 | `confirmed_data`·`brochure_content`·`page_content`, 축 4개 전부, `failure_reason` |
| 보존 | `execution_id` · `slug`(있으면) · 업로드 이미지 |
| 재실행 | Step 02부터 |
| 로그 | `form_input_resubmitted` |

**이 라우트가 `form_input`을 교체할 수 있는 유일한 경로다.** 다른 어떤 라우트도 `form_input`을 수정하지 않는다(spec §14.4 #17).

### Step 13. 삭제

| 항목 | 내용 |
|---|---|
| 담당 | 기획자 + 서버 라우트 |
| API | `DELETE /api/products/{id}` (#18) / `DELETE /api/applications/{id}` (#19) |
| AI 호출 | **0회** |
| 시작 조건 | `status ≠ published` · 해당 상품의 `applications` **0건** |
| 처리 | 단일 트랜잭션으로 `products` 삭제 + `product_images`·`edit_history` CASCADE |
| 보존 | **`execution_logs`·`abnormality_flags`는 삭제하지 않는다.** `product_id`만 `NULL`로 설정 |
| Storage | 커밋 후 `{product_id}/` 접두사 일괄 삭제. 실패해도 요청은 성공 |
| 로그 | `product_deleted` (`lifecycle`) / `application_deleted` (`application`) |

신청이 1건이라도 있으면 먼저 신청을 삭제해야 한다. 개인정보 보유 기간(1년) 경과분도 이 경로로 처리한다. 상세는 spec §12.4.

---

## 10. 실패 처리 및 재시도

### 10.1 실패의 두 갈래

| 갈래 | 발생 지점 | 결과 상태 | 기획자가 할 일 |
|---|---|---|---|
| **입력 문제** | 폼 재검증(Step 01), 일차 초과·구분 불가(Step 02), 0차 소진 | `input_error` + `failure_reason` | 입력을 고쳐 재제출(Step 12) |
| **생성 문제** | 소개서 생성·1차 검증 소진(Step 03·04) | `brochure_ready` + `axis_1 = fail` | [다시 생성] 또는 [입력 수정] |
| | **페이지 생성 소진**(Step 05) | `brochure_ready` + `axis_2 = fail` | [상품 생성] 재시도 또는 [다시 생성] |
| | 2·3차 검증 소진(Step 06·07) | `draft` + `verdict = fail` | [편집] · [다시 생성] · [책임 게시] |

**기준은 하나다: 사용자가 고칠 게 있는가.** 입력 문제는 폼으로 돌려보내고, 생성 문제는 생성물을 남긴 채 앞으로 갈 길을 제공한다.

### 10.2 복귀 대상

| 실패 지점 | 복귀 대상 | 유지 항목 | 재작성 범위 | 카운터 |
|---|---|---|---|---|
| 폼 재검증 (Step 01) | 폼 화면 | 없음(행 미생성) | 사용자 재입력 | 없음 |
| 일차 분해 (Step 02) | `/new?product_id=` | `form_input` | 사용자 재입력 | 없음 |
| 0차 검증 | Step 02 재호출 | `form_input` | `confirmed_data` | **`normalization`** |
| **소개서 생성** (Step 03) | Step 03 재호출 | `form_input`, `confirmed_data` | `brochure_content` | `brochure` |
| 1차 검증 (Step 04) | Step 03부터 | `form_input`, `confirmed_data` | `brochure_content` | `brochure` |
| **페이지 생성** (Step 05) | Step 05 재호출 | `form_input`, 소개서 | `page_content` | `page` |
| 2차 검증 (Step 06) | Step 05부터 | `form_input`, 소개서 | `page_content` | `page` |
| 3차 검증 (Step 07) | Step 05부터 | `form_input`, 소개서 | `page_content` | `consistency` |

**생성 실패와 검증 실패는 같은 카운터를 공유한다.** 복귀 대상과 소진 시 상태가 동일하므로 나눌 이유가 없다.

### 10.3 재시도 규칙

- 재시도 카운터는 **4종**: `normalization` · `brochure` · `page` · `consistency`.
- **각 카운터의 상한은 2회**(총 3회 시도)이며 **예산을 서로 공유하지 않는다.**
- 재시도는 **클라이언트가 같은 API를 재호출**하는 방식이다. 서버가 내부에서 반복하지 않고, **SDK 자동 재시도를 쓰지 않는다**(spec §4.3).
- `form_input`은 항상 유지한다.
- **폼 재검증 실패와 일차 분해 실패에는 카운터를 적용하지 않는다.** 사용자 재입력이므로 재시도가 아니다.
- 재시도 소진 후에도 파이프라인을 "중단"하지 않는다 — §10.1의 갈래에 따라 상태를 확정하고 다음 조작 경로를 남긴다.

#### 카운터 초기화 시점

**사람이 조작한 시점에만 초기화한다.** 시스템의 자동 재호출은 초기화하지 않는다.

| 조작 | 초기화 대상 |
|---|---|
| 폼 제출 (Step 01) | 4종 전부 |
| [입력 수정 후 재제출] (Step 12) | 4종 전부 |
| [다시 생성]·[처음부터 다시] (Step 11) | 4종 전부 |
| **[상품 생성]** | `page` · `consistency` |

### 10.4 응답 코드 규약

**단일 출처는 spec §14.6이다.** 클라이언트가 반드시 지켜야 할 분기만 옮긴다.

| 코드 | 클라이언트 동작 |
|---:|---|
| 200 | 다음 단계 호출 또는 화면 전환 |
| 400 | 폼 화면에 필드별 오류 표시 |
| 403 | 게시 버튼 비활성 유지 |
| 409 | **`reason`으로 갈린다 — 아래 표** |
| 422 | `/new?product_id=`로 이동, `failure_reason` 표시 |

`202`는 사용하지 않는다.

#### `409`는 `reason` 없이 오지 않는다

| `reason` | 클라이언트 동작 |
|---|---|
| `retry` | `retry_from`이 지정한 라우트부터 재호출 |
| `precondition` | **재호출하지 않는다.** `GET /api/products/{id}`로 재조회 후 화면을 spec §15.1에 맞춰 갱신 |
| `stale` | 재조회 후 "다른 사람이 먼저 저장했습니다" 표시. 자동 재시도하지 않는다 |
| `slug_conflict` | 다른 slug로 재요청 |
| `product_not_published` | 신청 폼을 닫고 안내 표시 |

**`reason`을 확인하지 않고 `409`를 전부 "재호출하라"로 해석하면 무한 재호출에 빠진다.**

### 10.5 AI 호출 실패 (spec §4.3)

아래 6종은 모두 **생성 실패**로 취급하며, 해당 단계의 카운터를 올리고 `409 retry`를 반환한다.

| 상황 | 비고 |
|---|---|
| 25초 타임아웃 | SDK 기본 타임아웃(10분)을 요청 단위로 덮어쓴다 |
| 429 한도 초과 | 무료 티어에서 가장 흔하다. `rate_limited`로 분류 |
| 5xx·네트워크·인증 | SDK가 자동 재시도하지 않는다. 과부하 503 포함 |
| `finishReason = MAX_TOKENS` | 출력 절단 |
| `finishReason` 안전 계열 또는 `promptFeedback.blockReason` | `detail`에 종료 사유를 기록 |
| 스키마 검증·파싱 실패 | `responseSchema`로 강제해도 실패할 수 있다 |
| 서버 검사 실패 | 섹션 수·`source`·토큰·길이 계약 |

**`finishReason`과 `promptFeedback`을 먼저 확인한 뒤 본문을 읽는다.** 거부 시 본문이 비어 있다.

---

## 11. 로그와 이상 플래그

### 11.1 기록 시점

각 단계 종료 직후, **성공·실패 모두** `execution_logs`에 1행 append한다. 재시도는 `retry_index`를 올려 새 행으로 누적하고, [다시 생성]·재제출은 `attempt_no`를 올린다. 기존 행을 덮어쓰지 않는다.

| `category` | `step` | 기록 시점 |
|---|---|---|
| `pipeline` | `pipeline_started` | Step 01 완료 |
| | `itinerary_decomposed` · `normalization_validated` | Step 02 완료 |
| | `brochure_generated` | Step 03 완료 |
| | `validation_1_completed` | Step 04 완료 |
| | `page_generated` | Step 05 완료 |
| | `validation_2_completed` | Step 06 완료 |
| | `validation_3_completed` | Step 07 완료 |
| | `draft_registered` | **`draft` 전이 직후 — Step 07, 또는 2차 소진 시 Step 06** |
| | `regenerate_requested` | Step 11 |
| | `form_input_resubmitted` | Step 12 |
| `lifecycle` | `content_edited` · `slug_changed` | Step 08 |
| | `published` · `unpublished` · `publish_override` | Step 09 |
| | `product_deleted` | Step 13 |
| `application` | `application_received` · `email_sent` · `email_resent` | Step 10 |
| | `application_deleted` | Step 13 |

| 항목 | 규정 |
|---|---|
| `verdict` 저장값 | **`pass` / `fail` / `-` (영어).** 화면에만 `통과`/`반려`/`-`로 표시한다(spec §5.4·§14.3) |
| `input`·`output` | 가공·요약 없는 원본. **단 `category = application`은 이름·이메일·연락처를 마스킹**해 저장한다 |
| AI 호출 단계의 `output` | `{error_type, detail, finish_reason, usage, elapsed_ms, model}`을 포함한다(spec §4.3) |
| 로그 기록 실패 | **본 동작을 실패시키지 않는다.** 트랜잭션 밖에서 실행하고 서버 오류 로그에만 남긴다 |

### 11.2 이상 플래그 감지 조건

`execution-log-collection` **다음에** `abnormality-detection`을 실행한다(순서 역전 금지). 감지된 경우에만 기록한다.

| `type` | 감지 조건 |
|---|---|
| `retry_accumulated` | 한 카운터가 **2에 도달**(마지막 재시도 진입) |
| `pipeline_aborted` | 한 단계의 재시도가 **소진**되어 `input_error` 또는 해당 축 `fail` 확정 |
| `validation_repeated_failure` | **같은 검증 항목**이 같은 `attempt_no` 안에서 2회 이상 실패 |
| `processing_delayed` | 한 요청 소요 시간이 **20초 초과**(AI 타임아웃 25초의 80%) |
| `itinerary_partial` | 일정 원문의 일차 수가 여행기간보다 적어 `추후 추가 예정`으로 채움 |

**중복 기록 범위는 `(execution_id, attempt_no, step, type)` 조합당 1행이다.** `attempt_no`가 올라가면 같은 단계·같은 유형도 새로 기록한다 — 그래야 시도를 거듭할 때 문제가 반복되고 있다는 사실이 드러난다(spec §5.5).

플래그를 근거로 산출물을 수정하지 않으며, 로그 기록 외 알림을 발송하지 않는다.

### 11.3 로그 화면

`/admin/logs/{execution_id}` 단일 화면에서 전체 이력을 확인한다. `category` 탭(파이프라인 / 상태변경 / 신청·메일)으로 구분하며, 파이프라인 탭에 신청 로그가 섞이지 않는다.

표 컬럼: `타임스탬프 → 시도 → 재시도 → 단계명 → 판정 → 상태 → 입력 → 출력`. 판정 열은 저장값(영어)을 한글로 바꿔 표시하고, `application` 행의 개인정보는 저장 시점에 이미 마스킹되어 있으므로 화면에서 복원하지 않는다.

---

## 12. 동시성과 원자성

단일 공유 비밀번호이므로 **여러 사람이 같은 상품을 동시에 조작할 수 있다.** 단일 출처는 spec §16.1.1이다.

| 항목 | 규정 |
|---|---|
| 낙관적 잠금 | 모든 쓰기 라우트는 클라이언트가 읽은 `updated_at`을 조건으로 갱신한다. 영향 행 0이면 **409 `{reason:"stale"}`** |
| 적용 대상 | 상태·산출물을 바꾸는 전 라우트(#2~8·10~13·17~19) |
| 미적용 | `POST /api/products`(행 생성) · `POST /api/applications`(상품을 바꾸지 않음) · 조회 |
| 편집기 동시 편집 | 잠금 없음. 마지막 저장이 이기되 409 시 재조회하고 사용자에게 알린다 |
| slug 경쟁 | UNIQUE 충돌 시 접미사를 올려 최대 5회 재시도, 모두 실패하면 `409 slug_conflict` |

**트랜잭션 경계**

| Step | 한 트랜잭션 | 트랜잭션 밖 |
|---|---|---|
| 01 상품 등록 | `products` 행 + `product_images` | Storage 업로드, 로그 |
| 08 편집 저장 | `page_content` + `human_edited` + 상태 전이 + `edit_history` | 로그 |
| 09 게시 | `status` + `published_at` | 로그 |
| 10 신청 | `applications` INSERT | 로그, 이메일 |
| 13 삭제 | `products` + CASCADE 2개 + 로그 `product_id` NULL 처리 | Storage 삭제 |

---

## 13. 반응형 보증

헤드리스 브라우저 검사는 서버리스에서 비현실적이므로 **파이프라인 단계로 두지 않는다.**

| 계층 | 시점 | 담당 |
|---|---|---|
| 컴포넌트 사전 검증 | 개발 단계 1회 | 개발자 (페이지 9종 + 삽입 블록 3종, 375/768/1280px) |
| 콘텐츠 길이 계약 | Step 05 생성 시 **4종** · Step 08 편집 시 **6종** | 서버 (위반 시 실패/400) |
| 이미지 계약 | 렌더링 시 | 컴포넌트 (고정 종횡비 + `object-fit: cover`) |
| 육안 확인 | Step 08 | 기획자 (편집기 미리보기 375/768/1280 전환) |

`free_text`(500자)·`notice`(300자)는 편집기 블록이라 **생성 시점에 존재하지 않는다.** 생성 단계에서 이 2종을 검사하도록 요구하면 실행 불가능한 규정이 된다(spec §17.1).

**AI가 매 실행마다 "반응형 검사 통과"를 기록하는 방식은 채택하지 않는다.**

---

## 14. 결과 반환

### 14.1 Step 07 완료 시점 (draft 등록)

| 항목 | 내용 |
|---|---|
| 게시물 ID | `products.id` |
| 실행 ID · 시도 회차 | `products.execution_id` · `attempt_no` |
| 검토 경로 | `/admin/products/{id}/edit` (기획자 전용) |
| 공개 URL(예정) | `/p/{slug}` — `published` 전까지 404 |
| 상태값 | `draft` |
| 검증 결과 | `validation_snapshot` (4축 + 최상위 `verdict` + `items`) |
| 등록 시각 | UTC ISO 8601 |

### 14.2 Step 09 완료 시점 (게시)

| 항목 | 내용 |
|---|---|
| 상태값 | `published` |
| 공개 URL | `/p/{slug}` — 인증 없이 접근 가능 |
| 최초 게시 시각 | `published_at` |
| 책임 게시 여부 | `publish_override_at` (있는 경우) |

---

## 15. 문서 세트 현황

| 대상 | 개수 | 버전 |
|---|---:|---|
| `spec.md` · `workflow.md` | 2 | **2.4** |
| `checklist.md` | 1 | **2.4** |
| `CHANGELOG.md` | 1 | 개정 이력 (spec 부록 A~E) |
| `.claude/agents/` | 5 | **2.2 — 동기화 필요** |
| `.claude/skills/` | 15 | **2.2 — 동기화 필요** |

### 에이전트 5개

| 에이전트 | 담당 Step | AI 호출/요청 |
|---|---|---:|
| intake-agent | 02 | 1 |
| content-writer-agent | 03 | 1 |
| validator-agent | 04 · 06 · 07 | 각 1 |
| web-builder-agent | 05 | 1 |
| log-monitor-agent | 01~13 매 단계 종료 | 0 |

### 스킬 15개

| 계층 | 스킬 |
|---|---|
| 오케스트레이션 | `product-orchestrator` |
| 입력·데이터 (Step 02) | `input-guard` · `data-normalization` · `itinerary-decomposition` |
| 소개서 (Step 03) | `intro-template-writer` · `intro-content-fill` · `tonal-manner-apply` |
| 페이지 (Step 05) | `content-structuring` · `theme-design-token-match` · `web-content-structure-gen` |
| 검증 (Step 04·06·07) | `fact-check` · `consistency-check` |
| 등록 (Step 06·07) | `draft-registration` |
| 기록 (매 단계) | `execution-log-collection` · `abnormality-detection` |

`.claude/skills/`에는 파이프라인과 무관한 `grilling`·`grill-me`도 있다(총 17개 디렉터리). 위 15개가 파이프라인 스킬이다.

### 하위 문서 동기화 대상 (2.4 기준)

에이전트·스킬 문서는 아직 2.2 기준이다. spec 2.4를 따라 아래를 수정해야 한다.

| 항목 | 대상 문서 |
|---|---|
| 시작 조건을 재료 기준으로 | `product-orchestrator` · `web-builder-agent` · `content-structuring` · `intro-template-writer` |
| `409`에 `reason` 추가 | `product-orchestrator` · `intake-agent` · `validator-agent` · `fact-check` · `consistency-check` |
| AI 호출 계약(§4.3) 반영 | 5개 에이전트 전부 |
| 카운터 3종 → 4종 | `product-orchestrator` · `intake-agent` |
| `data` 키 스키마 참조로 교체 | `intro-template-writer` · `content-structuring` · `web-content-structure-gen` |
| `form_input` 구조(§7.4) | `input-guard` |
| 여행기간 결합·일수 | `data-normalization` |
| 조사 처리 금지 | `intro-content-fill` |
| `gallery` 삭제 · `image_slots` | `content-structuring` |
| `verdict` 영어 저장 · 마스킹 | `execution-log-collection` · `log-monitor-agent` |
| `abnormality_flags.attempt_no` | `abnormality-detection` · `log-monitor-agent` |
| draft 등록 주체(2차 소진 경로) | `draft-registration` · `web-builder-agent` |
| 테마 키·일차 구분 범위를 spec 참조로 | `theme-design-token-match` · `itinerary-decomposition` |
