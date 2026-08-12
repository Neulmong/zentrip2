---
name: abnormality-detection
description: 재시도 누적·중단 확정·검증 반복 실패·처리 지연·일정 부분 채움 5종을 정의된 조건대로 감지해 abnormality_flags 테이블에 기록한다. 감지된 경우에만 기록하며 알림은 발송하지 않는다.
---

## 목적
- 파이프라인의 이상 징후를 로그 화면에 플래그로 드러낸다.
- 감지 조건을 명문화해 "이상 없음" 류 잡음 없이 실제 문제만 남긴다.

> **2.2에서 복원된 것**: 2.0 → 2.1 개정 과정에서 감지 조건 정의가 문서에서 소실돼, 플래그 5종 중 1종만 조건이 남아 있었다(spec 부록 C #7). 아래 표가 5종 전부의 단일 기준이다.

## 실행 조건
- 호출 주체: log-monitor-agent (각 서버 라우트가 단계 종료 직후 호출)
- AI 호출: **0회.** 전부 기계 판정이다
- 실행 시점: `execution-log-collection` **다음**. log-monitor-agent 체인의 2번
- 실행 순서 역전 금지: 플래그는 **기록된 이력을 대상으로** 판단하므로, 로그가 먼저 쌓여야 한다
- 실행하지 않는 경우: 없음. 단 **감지되지 않으면 아무 것도 기록하지 않는다**

## 입력

| 항목 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `execution_id` | string | 필수 | 판단 범위 |
| 방금 기록한 로그 | object | 필수 | `execution-log-collection` 출력 + 입력값 |
| `retry_counts` | object | 필수 | `{normalization, brochure, page, consistency}` **4종**(§11.6). 0차는 `normalization`을 쓰며 `brochure`와 예산을 공유하지 않는다 |
| `attempt_no` | number | 필수 | 현재 시도 회차 |
| 요청 소요 시간 | number | 필수 | 밀리초. 지연 감지용 |
| 누적 로그 | array of object | 필수 | 같은 `attempt_no`의 이전 행들. 반복 실패 판정용 |

## 출력

| 항목 | 형식 | 설명 |
|---|---|---|
| 감지 결과 | array of object | `{type, step, detail}`. 감지 없으면 **빈 배열** |
| 기록 건수 | number | 이번 실행에서 추가한 플래그 수 |

```json
{
  "감지결과": [
    { "type": "retry_accumulated", "step": "validation_1_completed",
      "detail": "brochure 카운터가 2에 도달했습니다. 다음 실패 시 axis_1이 fail로 확정됩니다." },
    { "type": "processing_delayed", "step": "validation_1_completed",
      "detail": "요청 소요 22.4초. 임계값 20초를 초과했습니다." }
  ],
  "기록건수": 2
}
```

감지 없음:

```json
{ "감지결과": [], "기록건수": 0 }
```

## 산출물
- `abnormality_flags` 테이블에 감지된 만큼의 행. **파일 산출물 없음.**
- 로그 화면(`/admin/logs/{execution_id}`) 하단에 감지된 것만 나열된다.
- **알림 발송은 하지 않는다.**
- **플래그를 근거로 산출물을 수정하지 않는다.**

## 감지 조건 (5종 · 단일 기준)

| `type` | 감지 조건 | 감지 시점 |
|---|---|---|
| `retry_accumulated` | 한 단계의 `retry_counts` 값이 **2에 도달**(= 마지막 재시도 진입) | 카운터 증가 직후 |
| `pipeline_aborted` | 한 단계의 재시도가 **소진**되어 `status = input_error` 또는 해당 축 `verdict = fail`로 확정 | 확정 직후 |
| `validation_repeated_failure` | **같은 검증 항목**(`검증영역` 값 기준)이 같은 `attempt_no` 안에서 **2회 이상** 실패 | 검증 실패 기록 직후 |
| `processing_delayed` | 한 요청의 소요 시간이 **20초 초과** | 모든 단계 종료 시 |
| `itinerary_partial` | 일정 원문의 일차 수가 여행기간보다 적어 `추후 추가 예정`으로 채운 경우 | Step 02 완료 시 |

### 조건별 세부 규칙

| `type` | 세부 |
|---|---|
| `retry_accumulated` | 카운터가 3 이상이 되는 일은 없다(2가 상한). 2에 **도달한 순간 1회만** 기록한다 |
| `pipeline_aborted` | "중단"이 아니라 **확정**이다. 2.2에서는 재시도 소진 후에도 파이프라인이 끝나지 않고 `brochure_ready`/`draft`로 남아 다음 조작 경로가 열린다(spec §15.1). `detail`에 어느 경로가 열렸는지 적는다 |
| `validation_repeated_failure` | `attempt_no`가 올라가면 카운트를 초기화한다. [다시 생성]은 새 시도이므로 이전 실패를 누적하지 않는다 |
| `processing_delayed` | AI 호출이 없는 단계(Step 01·08·09·10·11)에도 적용한다. 그 단계에서 20초가 넘으면 DB·Storage 쪽 문제 신호다 |
| `itinerary_partial` | `itinerary-decomposition`의 `부분채움` 배열이 비어 있지 않으면 기록한다. `detail`에 채운 일차 번호를 적는다 |

## 기록 규칙

- **감지된 경우에만** 기록한다. "이상 없음", "정상" 류 항목을 남기지 않는다.
- 한 단계에서 여러 이상이 감지되면 **유형별로 각각 1행**을 기록한다. 하나로 묶지 않는다.
- 중복 기록 범위는 **`(execution_id, attempt_no, step, type)` 조합당 1행**이다(§5.5).
  `attempt_no`가 빠지면 [다시 생성] 후 같은 문제가 되풀이돼도 기록되지 않는다 —
  사람이 다시 시킨 회차는 별개의 관측이다.
- `detail`은 사람이 읽고 바로 판단할 수 있게 쓴다. 숫자·임계값·다음에 일어날 일을 포함한다.
- `execution_id` 단위로 누적한다. `attempt_no`가 올라가도 이전 플래그를 삭제하지 않는다.

## 금지 사항

- **알림을 발송하지 않는다.** 이메일·웹훅·푸시 모두 금지다.
- 플래그를 근거로 산출물(`brochure_content`·`page_content`·`confirmed_data`)을 수정하지 않는다.
- 상태를 전이시키지 않는다. 상태 전이는 서버 라우트의 몫이다.
- 재시도 여부를 판단하지 않는다.
- `execution-log-collection`보다 먼저 실행하지 않는다.
- 위 5종 외의 `type` 값을 만들지 않는다.
- 파일을 생성하지 않는다.

## 판정 규칙

- 감지 결과가 빈 배열이어도 정상이다. 그것이 대부분의 경우다.
- 플래그 존재가 파이프라인 실패를 의미하지 않는다. `itinerary_partial`은 정상 진행 중에도 발생한다.
- 감지 조건에 없는 상황을 임의 판단해 플래그로 만들지 않는다.
