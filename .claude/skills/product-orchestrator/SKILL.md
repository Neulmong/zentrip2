---
name: product-orchestrator
description: 서버 라우트 안에서 에이전트 1개를 호출하고, 재시도 카운터·상태 전이·로그 기록·응답 코드를 결정한다. 파이프라인 전체를 끝까지 실행하지 않으며, 단계 순서는 클라이언트가 담당한다. 자체 산출물을 생성하지 않는다.
---

## 목적
- 서버 라우트 1건이 받은 요청을 처리한다: **에이전트 1개 호출 → 카운터·상태 갱신 → 로그 기록 → 응답 코드 반환.**
- 파이프라인 상태의 단일 관리 지점이 된다.

> **1.0에서 근본적으로 바뀐 점**: 1.0의 오케스트레이터는 에이전트 하나로서 Step 01~07을 **끝까지 실행**했다. 2.2에서 파이프라인이 API로 분할되면서 그 구조는 성립하지 않는다 — 여러 AI 호출을 한 요청에 담으면 서버리스 실행 시간 한도(60초)를 넘긴다(spec §4.2). 오케스트레이션은 **2계층으로 분리**됐고, 이 스킬은 그중 **하위 계층**이다.

## 오케스트레이션 2계층

```text
┌─ 상위: 클라이언트 (브라우저) ──────────────────────────────┐
│  · 단계 순서 결정 및 순차 호출                              │
│  · 진행 표시 ("일정 정리 중…" / "소개서 작성 중…")          │
│  · 응답 코드에 따른 재호출 판단                              │
│  · 조건 분기 (2차 fail → 3차 호출 생략)                     │
└───────────────────────────┬────────────────────────────────┘
                            │ 요청 1건
┌───────────────────────────▼────────────────────────────────┐
│─ 하위: 이 스킬 (서버 라우트) ───────────────────────────────│
│  · 선행 조건 확인                                            │
│  · 에이전트 1개 호출 (= AI 호출 최대 1회)                    │
│  · retry_counts / status / current_step 갱신                │
│  · log-monitor-agent 호출 (로그 → 이상 플래그)              │
│  · 응답 코드 결정                                            │
└────────────────────────────────────────────────────────────┘
```

| 담당 | 담당하지 않음 |
|---|---|
| 에이전트 1개 호출 | **여러 에이전트 연쇄 호출** |
| 카운터·상태·로그 관리 | 단계 순서 결정, 진행 표시 |
| 응답 코드 결정 | 재호출 실행 |
| 선행 조건 확인 | 문장 작성, 검증 판단, 데이터 조사 |

## 실행 조건
- 호출 주체: Next.js 서버 라우트 (spec §14.4의 16개 엔드포인트)
- AI 호출: 라우트당 **최대 1회**. 이 스킬 자체는 AI를 쓰지 않는다
- 실행하지 않는 경우: 없음. 모든 라우트가 이 규약을 따른다

## 라우트별 호출 대상

| # | 엔드포인트 | 호출 에이전트 | AI |
|---:|---|---|---:|
| 1 | `POST /api/products` | (없음. 서버 validation) | 0 |
| 2 | `POST /api/products/{id}/decompose` | intake-agent | 1 |
| 3 | `POST /api/products/{id}/brochure` | content-writer-agent | 1 |
| 4 | `POST /api/products/{id}/validate-brochure` | validator-agent | 1 |
| 5 | `POST /api/products/{id}/page` | web-builder-agent | 1 |
| 6 | `POST /api/products/{id}/validate-page` | validator-agent | 1 |
| 7 | `POST /api/products/{id}/validate-consistency` | validator-agent | 1 |
| 8 | `POST /api/products/{id}/regenerate` | (없음) | 0 |
| 9~16 | 조회·편집·게시·신청 계열 | (없음) | 0 |

**AI 열이 2 이상인 라우트를 만들면 원칙 위반이다.** AI를 쓰지 않는 스킬(`input-guard`·`data-normalization`·`draft-registration`·`execution-log-collection`·`abnormality-detection`)은 같은 라우트에서 함께 실행해도 된다.

## 처리 순서 (모든 라우트 공통)

```text
1. 인증 확인            (POST /api/applications 제외)
2. 선행 조건 확인        미충족 → 409 또는 403
3. 에이전트 1개 호출     AI 최대 1회, 타임아웃 25초
4. 결과 판정 반영
     ├─ 성공        → status·current_step 갱신
     ├─ 검증 실패    → retry_counts +1 (여력 있으면)
     └─ 재시도 소진  → 축 fail 확정 또는 input_error
5. log-monitor-agent 호출
     ├─ execution-log-collection  (성공·실패 모두)
     └─ abnormality-detection     (감지 시에만)
6. 응답 코드 결정 후 반환
```

## 실행 컨텍스트

1.0에서는 오케스트레이터가 메모리에 들고 있었으나, 요청이 분리되면서 **DB가 단일 출처**가 됐다.

| 필드 | 위치 | 용도 |
|---|---|---|
| `execution_id` | `products` | 로그 추적 단위. 재시도·재제출에도 유지 |
| `attempt_no` | `products` | 사람이 다시 시킨 회차 |
| `retry_counts` | `products` (jsonb) | `{brochure, page, consistency}` 3종 |
| `status` | `products` | 7종(spec §15.1) |
| `current_step` | `products` | 클라이언트가 다음 호출 대상을 판단하는 근거 |
| `validation_snapshot` | `products` (jsonb) | 4축 결과 |

매 요청 시작에 DB에서 읽고, 갱신 후 DB에 쓴다. 요청 간에 메모리 상태를 유지하지 않는다.

## 상태 전이 판단

**단일 출처는 spec §15.1(상태 × 화면 × 버튼)과 §15.2(전이표)다.** 이 스킬은 그 표를 실행할 뿐 새 전이를 만들지 않는다.

| 라우트 결과 | 전이 |
|---|---|
| Step 01 성공 | → `generating` |
| Step 02 분해 실패 / 0차 소진 | → `input_error` |
| Step 04 통과 또는 소진 | → `brochure_ready` |
| Step 06·07 통과 또는 소진 | → `draft` |
| Step 08 최초 저장 | `draft` → `reviewing` |
| Step 09 게시 / 중단 | → `published` / `unpublished` |
| Step 11 [다시 생성] | → `generating` |

**§15.1 표에 없는 상태·버튼 조합을 만들지 않는다.** 2.0~2.1에서 "도달할 수 없는 상태를 전제한 기능"이 3회 발생한 원인이 이 규칙의 부재였다.

## 재시도 카운터 관리

| 항목 | 규정 |
|---|---|
| 카운터 | **3종**: `brochure` · `page` · `consistency` |
| 상한 | 각 **2회**(총 3회 시도) |
| 0차 실패 | `brochure` 카운터를 공유한다 |
| 폼 검증·일차 분해 실패 | **카운터 미적용.** 사용자 재입력이므로 재시도가 아니다 |
| 초기화 | Step 01, [다시 생성], `input_error` 재제출 시 전부 0 |
| 재시도 실행 | **하지 않는다.** 카운터만 올리고 409를 반환한다. 재호출은 클라이언트가 한다 |

## 응답 코드 규약

| 코드 | 의미 | 클라이언트 동작 |
|---:|---|---|
| 200 | 단계 완료 (검증 fail 확정 포함) | 다음 단계 호출 또는 화면 전환 |
| 202 | (사용하지 않음) | — |
| 400 | 입력 규칙 위반 | 폼 화면에 필드별 오류 표시 |
| 403 | 게시 게이트 미통과 | 게시 버튼 비활성 유지 |
| 409 | 검증 실패 + 재시도 여력 있음 / 선행 조건 미충족 / slug 중복 | 지정 단계부터 재호출 |
| 422 | 입력 문제로 중단(`input_error`) | 폼 화면으로 이동, 사유 표시 |

**`202` + 폴링 방식은 사용하지 않는다.** 서버리스에서 응답 후 실행이 종료될 수 있고, `after()`를 써도 `maxDuration`이 늘어나지 않아 긴 작업을 백그라운드로 넘기는 효과가 없다(spec §4.2).

## 선행 조건 표

| 라우트 | 선행 조건 | 미충족 시 |
|---|---|---|
| `/decompose` | `status = generating`, `form_input` 존재 | 409 |
| `/brochure` | `current_step = normalization_validated` | 409 |
| `/validate-brochure` | `brochure_content` 존재 | 409 |
| `/page` | `status = brochure_ready` **AND** `axis_1 = pass` | 409 |
| `/validate-page` | `page_content` 존재 | 409 |
| `/validate-consistency` | **`axis_2 = pass`** | 409 |
| `/content` (편집) | `status ∈ {draft, reviewing, published, unpublished}` | 409 |
| `/slug` | `status ∈ {draft, reviewing}` | 409 |
| `/publish` | 게시 게이트 통과(spec §11.5) | 403 |
| `/regenerate` | `status ∈ {brochure_ready, draft}` | 409 |
| `/applications` | 대상 상품 `status = published` | 409 |

## 금지 사항

- **한 라우트에서 AI를 2회 이상 호출하지 않는다.**
- **여러 에이전트를 연쇄 호출하지 않는다.**
- 서버 내부에서 재시도 루프를 돌리지 않는다.
- **자체 산출물을 생성하지 않는다.** 소개서 문장·페이지 콘텐츠·검증 판정을 직접 만들지 않는다.
- 데이터를 조사·보완·추정하지 않는다.
- 검증 결과를 재해석하지 않는다. validator가 반환한 판정을 그대로 반영한다.
- `form_input`·`confirmed_data`를 수정하지 않는다.
- 편집 후 재검증을 실행하지 않는다.
- **자동으로 게시하지 않는다.** `published` 전이는 기획자의 명시적 [게시] 조작만으로 일어난다.
- 요청 간에 메모리 상태를 유지하지 않는다. DB가 단일 출처다.
- spec §15.1 표에 없는 상태·버튼 조합을 만들지 않는다.
- 단계 순서를 결정하지 않는다. 그것은 클라이언트의 몫이다.
