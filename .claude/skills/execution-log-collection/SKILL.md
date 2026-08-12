---
name: execution-log-collection
description: 실행 ID 기준으로 단계별 입력·출력·판정·상태를 execution_logs 테이블에 append한다. 시도 회차와 재시도 회차를 구분해 기록하며, 기존 행을 덮어쓰지 않는다.
---

## 목적
- 어떤 입력으로 어떤 결과가 나왔는지 추적 가능하게 기록한다.
- 관리 화면(`/admin/logs/{execution_id}`)의 근거가 되게 한다.

> **1.0에서 바뀐 점**: `outputs/run-{execution_id}/log.html` 단일 파일에 HTML 표로 기록하던 방식은 폐기됐다. 서버리스 환경에서는 파일시스템 쓰기가 불가능하다(spec §14.3). 이제 **Supabase `execution_logs` 테이블에 행을 append**한다.

## 실행 조건
- 호출 주체: log-monitor-agent (각 서버 라우트가 단계 종료 직후 호출)
- AI 호출: **0회.** 전부 기계 기록이다
- 실행 시점: workflow Step 01~11의 각 단계가 끝날 때마다 1회. **성공·실패 모두 기록한다**
- 실행 순서: log-monitor-agent 체인의 **1번**. `abnormality-detection`보다 먼저 실행한다(플래그는 기록된 이력을 대상으로 판단하므로)
- 실행하지 않는 경우: 없음. **로그 누락은 성공 기준 위반이다**

## 입력

| 항목 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `execution_id` | string | 필수 | 실행 추적 단위 |
| `product_id` | uuid \| null | 필수 | Step 01 실패 시 null 가능 |
| `category` | `"pipeline"` \| `"lifecycle"` \| `"application"` | 필수 | 로그 화면 탭 기준 |
| `step` | string | 필수 | 아래 단계명 표 참조 |
| `attempt_no` | number | 필수 | 시도 회차. 최초 1 |
| `retry_index` | number | 필수 | 해당 시도 안의 재시도 회차. 0 = 최초 |
| `verdict` | `"pass"` \| `"fail"` \| `"-"` | 필수 | 판정 결과. 판정이 없는 단계는 `-` |
| `status` | string | 필수 | 기록 시점 상품 상태(7종) |
| `input` | any | 필수 | 해당 단계가 받은 값. **가공하지 않은 원본** |
| `output` | any | 필수 | 해당 단계가 반환한 값. **가공하지 않은 원본** |

```json
{
  "execution_id": "run-20260810-001",
  "product_id": "8f1c2e5a-3b74-4d19-9a2f-6c0e7d51b8a3",
  "category": "pipeline",
  "step": "brochure_generated",
  "attempt_no": 1,
  "retry_index": 0,
  "verdict": "pass",
  "status": "generating",
  "input": { "confirmed_data": "…", "소개서_템플릿": "…" },
  "output": { "brochure_content": "…", "보호값검증": { "검사한값수": 21, "변경된값수": 0 } }
}
```

## 출력

| 항목 | 형식 | 설명 |
|---|---|---|
| 기록 결과 | `"appended"` | 항상 append다. `created`·`updated`는 없다 |
| 로그 ID | number | `execution_logs.id` |
| 누적 항목 수 | number | 해당 `execution_id`의 전체 행 수 |
| 화면 경로 | string | `/admin/logs/{execution_id}` |

```json
{
  "기록결과": "appended",
  "로그_ID": 47,
  "누적_항목수": 6,
  "화면_경로": "/admin/logs/run-20260810-001"
}
```

## 산출물
- `execution_logs` 테이블에 1행. **파일 산출물 없음.**
- 전달 대상: `abnormality-detection`(다음 스킬)이 기록된 이력을 근거로 플래그를 판단한다.
- 관리 화면은 `/admin/logs/{execution_id}` 단일 화면에서 전체 이력을 열람한다.
- **알림 발송은 하지 않는다.**

## 단계명 (`step`)

| `category` | `step` | 기록 시점 |
|---|---|---|
| `pipeline` | `pipeline_started` | Step 01 완료 |
| | `itinerary_decomposed` | Step 02 일차 분해 완료 |
| | `normalization_validated` | Step 02 0차 검증 완료 |
| | `brochure_generated` | Step 03 완료 |
| | `validation_1_completed` | Step 04 완료 |
| | `page_generated` | Step 05 완료 |
| | `validation_2_completed` | Step 06 완료 |
| | `validation_3_completed` | Step 07 3차 검증 완료 |
| | `draft_registered` | Step 07 draft 등록 완료 |
| | `regenerate_requested` | Step 11 |
| `lifecycle` | `content_edited` · `slug_changed` | Step 08 |
| | `published` · `unpublished` · `publish_override` | Step 09 |
| `application` | `application_received` · `email_sent` · `email_resent` | Step 10 |

이 목록에 없는 `step` 값을 쓰지 않는다.

## 기록 규칙

| 규칙 | 내용 |
|---|---|
| append 전용 | 기존 행을 **수정·삭제하지 않는다** |
| 재시도 | `retry_index`를 올려 새 행으로 누적한다 |
| 재시도·재제출 | `attempt_no`를 올린다. `retry_index`는 0으로 돌아간다 |
| 성공·실패 | **둘 다 기록한다.** 실패 행 누락은 성공 기준 위반이다 |
| 원본 보존 | `input`·`output`을 가공·요약·재구성하지 않고 원본 JSON으로 저장한다 |
| 타임스탬프 | `created_at`은 UTC. 화면 표시는 ISO 8601 |
| 빈 값 | 화면에서 `-`로 표기한다. `null`을 그대로 노출하지 않는다 |
| 일치성 | 기록값과 실제 산출물 반영값이 일치해야 한다 |

### `attempt_no`와 `retry_index`의 차이

2.1까지는 `retry_index`만 있어 재제출 회차를 구분할 수 없었다. 같은 `retry_index = 0` 행이 여러 벌 쌓여 어느 것이 몇 번째 제출인지 알 수 없었다(spec 부록 C #10).

| 필드 | 올라가는 시점 | 의미 |
|---|---|---|
| `attempt_no` | [다시 생성], `input_error` 재제출 | **사람이 다시 시킨** 회차 |
| `retry_index` | 검증 실패 후 클라이언트 자동 재호출 | **시스템이 다시 시도한** 회차 |

## 화면 표시 형식

`/admin/logs/{execution_id}`는 `category` 탭으로 구분한다.

| 탭 | 표시 대상 | 기본 |
|---|---|:---:|
| 파이프라인 | `category = pipeline` | ● |
| 상태변경 | `category = lifecycle` | |
| 신청·메일 | `category = application` | |

**파이프라인 탭에 신청 로그가 섞이지 않는다.** 신청이 100건 누적되면 파이프라인 이력이 묻히기 때문이다.

표 컬럼 순서(고정, 추가·누락 금지):

```text
타임스탬프 → 시도 → 재시도 → 단계명 → 판정 → 상태 → 입력 → 출력
```

`입력`·`출력`은 원본 JSON을 접기/펼치기 가능한 형태로 표시한다. "최종 산출물" 컬럼은 두지 않는다 — 마지막 `pipeline` 행의 `출력`이 곧 최종 산출물이다.

## 금지 사항

- 파일을 생성하지 않는다. `outputs/`·`log.html` 등 경로를 만들지 않는다.
- 기존 행을 덮어쓰지 않는다.
- `input`·`output`을 요약·잘라내기하지 않는다.
- 단계별로 별도 화면·별도 테이블을 만들지 않는다.
- 산출물 내용을 수정하지 않는다.
- **알림을 발송하지 않는다.**
- `abnormality-detection`보다 나중에 실행하지 않는다.
