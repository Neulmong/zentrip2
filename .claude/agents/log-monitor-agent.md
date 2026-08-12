---
name: log-monitor-agent
description: 각 서버 라우트가 단계 종료 직후 호출해 execution_logs 테이블에 실행 이력을 append하고, 이상 5종을 정의된 조건대로 감지해 abnormality_flags에 기록한다. 산출물을 수정하지 않고 알림도 발송하지 않는다.
model: inherit
---

## 역할
- 실행 ID 기준으로 단계별 입력·출력·판정·상태를 기록한다.
- 시도 회차(`attempt_no`)와 재시도 회차(`retry_index`)를 구분해 남긴다.
- 이상 5종을 정의된 조건대로 감지해 플래그로 표시한다.
- **알림은 발송하지 않는다.**

> **1.0에서 바뀐 점**: `outputs/run-{execution_id}/log.html` 단일 파일에 HTML 표로 기록하던 방식은 폐기됐다. 서버리스 환경에서는 파일시스템 쓰기가 불가능하다(spec §14.3). 이제 **Supabase 테이블에 행을 append**한다.

## 배선 — 이 에이전트는 하네스 **바깥**이다 (규약 R7)

`manifest.json`에서 이 에이전트의 `routes`는 **빈 배열**이다. 스킬 체인으로 실행되지 않는다.

| Step | 호출 시점 | AI 호출 | 실행 주체 |
|---|---|---:|---|
| Step 01~11 전부 | 각 단계 종료 직후 | **0회** | `lib/orchestrator.ts#runStep` → `lib/logging.ts` |

**체인에 넣으면 안 되는 이유:** `runStep`이 이미 모든 라우트에서 로그와 플래그를 기록한다.
같은 일을 스킬 체인에서 또 하면 **로그가 두 번 쌓인다.** 그래서 이 에이전트가 소유한 두 스킬은
`kind: spec`이며, 하네스는 이들을 실행하지 않고 **`implemented_by`가 가리키는 코드가 계속 존재하는지만
검사한다**(`npm run test:harness`).

## 소유 스킬 (`kind: spec` · 실행되지 않음 · 순서 역전 금지)

| 순서 | 스킬 | 역할 | `implemented_by` |
|---:|---|---|---|
| 1 | `execution-log-collection` | `execution_logs`에 1행 append | `lib/logging.ts` |
| 2 | `abnormality-detection` | 기록된 이력을 근거로 이상 5종 감지 | `lib/logging.ts` |

**순서를 바꾸지 않는다.** 플래그는 기록된 이력을 대상으로 판단하므로 로그가 먼저 쌓여야 한다.
`runStep`의 고정 처리 순서가 이를 보장한다: 시작 조건 → 작업 → **로그 → 이상 플래그** → 조건부 갱신 → 응답.

이 에이전트는 AI를 쓰지 않는다. 따라서 어느 라우트에서 함께 실행해도 `ai_budget`을 잠식하지 않는다(spec §4.2).

## 입력

| 항목 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `execution_id` | string | 필수 | 추적 단위 |
| `product_id` | uuid \| null | 필수 | Step 01 실패 시 null 가능 |
| `category` | `"pipeline"` \| `"lifecycle"` \| `"application"` | 필수 | 로그 화면 탭 기준 |
| `step` | string | 필수 | 아래 단계명 표 |
| `attempt_no` | number | 필수 | 시도 회차 |
| `retry_index` | number | 필수 | 재시도 회차 |
| `verdict` | `"pass"` \| `"fail"` \| `"-"` | 필수 | **저장은 영어다**(§5.4). 한글 「통과/반려」는 화면 표시뿐이고 변환은 `VERDICT_LABEL`이 한다 |
| `status` | string | 필수 | 기록 시점 상품 상태(7종) |
| `input` / `output` | any | 필수 | **가공하지 않은 원본** |
| `retry_counts` | object | 필수 | 플래그 판정용 |
| 요청 소요 시간 | number | 필수 | 밀리초. 지연 감지용 |

## 출력

| 항목 | 형식 | 설명 |
|---|---|---|
| 기록 결과 | `"appended"` | 항상 append |
| 로그 ID | number | `execution_logs.id` |
| 누적 항목 수 | number | 해당 `execution_id`의 전체 행 수 |
| 감지 결과 | array of object | `{type, step, detail}`. 감지 없으면 빈 배열 |
| 화면 경로 | string | `/admin/logs/{execution_id}` |

## 단계명 (`step`)

| `category` | `step` |
|---|---|
| `pipeline` | `pipeline_started` · `itinerary_decomposed` · `normalization_validated` · `brochure_generated` · `validation_1_completed` · `page_generated` · `validation_2_completed` · `validation_3_completed` · `draft_registered` · `regenerate_requested` |
| `lifecycle` | `content_edited` · `slug_changed` · `published` · `unpublished` · `publish_override` |
| `application` | `application_received` · `email_sent` · `email_resent` |

이 목록에 없는 값을 쓰지 않는다.

## `attempt_no`와 `retry_index`의 차이

2.1까지는 `retry_index`만 있어 재제출 회차를 구분할 수 없었다. 같은 `retry_index = 0` 행이 여러 벌 쌓여 어느 것이 몇 번째 제출인지 알 수 없었다.

| 필드 | 올라가는 시점 | 의미 |
|---|---|---|
| `attempt_no` | [다시 생성], `input_error` 재제출 | **사람이 다시 시킨** 회차 |
| `retry_index` | 검증 실패 후 클라이언트 자동 재호출 | **시스템이 다시 시도한** 회차 |

## 이상 플래그 감지 조건 (5종)

| `type` | 감지 조건 |
|---|---|
| `retry_accumulated` | 한 단계의 `retry_counts` 값이 **2에 도달**(마지막 재시도 진입) |
| `pipeline_aborted` | 한 단계의 재시도가 **소진**되어 `input_error` 또는 해당 축 `verdict = fail` 확정 |
| `validation_repeated_failure` | **같은 검증 항목**이 같은 `attempt_no` 안에서 2회 이상 실패 |
| `processing_delayed` | 한 요청의 소요 시간이 **20초 초과**(AI 타임아웃 25초의 80%) |
| `itinerary_partial` | 일정 원문의 일차 수가 여행기간보다 적어 `추후 추가 예정`으로 채운 경우 |

**감지된 경우에만 기록한다.** "이상 없음" 류 항목을 남기지 않는다. 한 단계에서 여러 이상이 감지되면 유형별로 각각 1행을 기록한다.

## 기록 규칙

| 규칙 | 내용 |
|---|---|
| append 전용 | 기존 행을 **수정·삭제하지 않는다** |
| 성공·실패 | **둘 다 기록한다.** 실패 행 누락은 성공 기준 위반이다 |
| 원본 보존 | `input`·`output`을 가공·요약·재구성하지 않는다 |
| 타임스탬프 | UTC, 화면 표시는 ISO 8601 |
| 빈 값 | 화면에서 `-`로 표기 |
| 일치성 | 기록값과 실제 산출물 반영값이 일치해야 한다 |

## 로그 화면

`/admin/logs/{execution_id}` **단일 화면**에서 전체 이력을 열람한다. 단계별로 화면이 나뉘지 않는다.

`category` 탭으로 구분한다: **파이프라인**(기본) / 상태변경 / 신청·메일. **파이프라인 탭에 신청 로그가 섞이지 않는다** — 신청이 100건 누적되면 파이프라인 이력이 묻히기 때문이다.

표 컬럼 순서(고정):

```text
타임스탬프 → 시도 → 재시도 → 단계명 → 판정 → 상태 → 입력 → 출력
```

이상 플래그는 같은 화면 하단에 감지된 것만 나열한다.

## 금지 사항

- **파일을 생성하지 않는다.** `outputs/`·`log.html` 등 경로를 만들지 않는다.
- 기존 로그 행을 덮어쓰지 않는다.
- `input`·`output`을 요약·잘라내기하지 않는다.
- 단계별로 별도 화면·별도 테이블을 만들지 않는다.
- **산출물 내용을 수정하지 않는다.** 플래그를 근거로 `brochure_content`·`page_content`·`confirmed_data`를 고치지 않는다.
- **알림을 발송하지 않는다.** 이메일·웹훅·푸시 모두 금지다.
- 상태를 전이시키지 않는다. 서버 라우트의 몫이다.
- 재시도 여부를 판단하지 않는다.
- `abnormality-detection`을 `execution-log-collection`보다 먼저 실행하지 않는다.
- 감지 조건 5종 외의 `type` 값을 만들지 않는다.
