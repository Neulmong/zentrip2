---
name: draft-registration
description: 검증이 끝난 상품을 고객 미노출 상태(draft)로 등록한다. 새 산출물을 만들지 않고 기존 page_content와 slug를 그대로 등록하며, 공개 라우트에는 노출되지 않는다.
---

## 목적
- 2·3차 검증이 끝난 상품을 임시저장 상태로 확정한다.
- 기획자 전용 검토 경로를 발급하고, 공개 URL은 아직 열지 않는다.

## 실행 조건
- 호출 주체: 서버 라우트 (workflow Step 07의 마지막, `consistency-check` 다음)
- AI 호출: **0회.** 상태 전이와 경로 조립뿐이다
- 실행 시점: 3차 검증 판정이 확정된 직후 1회. **통과·실패 모두 실행한다**
- 실행하지 않는 경우
  - 2차 검증이 실패해 3차를 건너뛴 경우 — 2차 실패 확정 시 서버 라우트가 직접 `status = draft`로 전이한다
  - `status = input_error`인 경우 — 등록 대상이 아니다
  - 재게시·게시 중단 — Step 09가 담당한다

## 입력

| 항목 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `product_id` | uuid | 필수 | 대상 상품 |
| `slug` | string | 필수 | Step 05에서 발급된 값 |
| `validation_snapshot` | object(JSON) | 필수 | 4축 결과. `verdict` 확정용 |
| `attempt_no` | number | 필수 | 현재 시도 회차 |

## 출력

| 항목 | 형식 | 설명 |
|---|---|---|
| 게시물 ID | uuid | `products.id` |
| 상태값 | `"draft"` | 항상 `draft` |
| 검토 경로 | string | `/admin/products/{id}/edit` (기획자 전용) |
| 공개 URL(예정) | string | `/p/{slug}` — `published` 전까지 404 |
| `verdict` | `"pass"` \| `"fail"` | 4축 종합 판정 |
| 등록 시각 | string | UTC ISO 8601 |

```json
{
  "게시물_ID": "8f1c2e5a-3b74-4d19-9a2f-6c0e7d51b8a3",
  "상태값": "draft",
  "검토_경로": "/admin/products/8f1c2e5a-3b74-4d19-9a2f-6c0e7d51b8a3/edit",
  "공개_URL_예정": "/p/p-k3m9x2",
  "verdict": "pass",
  "등록_시각": "2026-08-10T04:12:33Z"
}
```

## 산출물
- **새 파일·새 레코드를 만들지 않는다.** `products` 행의 `status`·`current_step`·`updated_at`만 갱신한다.
- `page_content`와 `slug`는 Step 05가 만든 값을 **그대로 등록**한다. 재작성·재발급하지 않는다.
- 로그: `draft_registered` (`category = pipeline`)

## 등록 규칙

| 항목 | 규정 |
|---|---|
| 상태 | `status = draft` |
| 노출 | **고객 미노출.** `/p/{slug}`는 404를 반환한다(spec §4.1) |
| 미리보기 | 편집기(`/admin/products/{id}/edit`) 내부에서만 렌더링된다 |
| slug | Step 05 발급값 유지. **재발급하지 않는다** |
| `published_at` | **기록하지 않는다.** 게시(Step 09) 시점에만 기록한다 |
| 게시물 ID | `products.id` 유지. 재시도·재생성에도 새 ID를 발급하지 않는다 |

### `verdict` 확정

| 조건 | `verdict` | 결과 |
|---|---|---|
| 0·1·2·3차 전 축 `pass` | `pass` | 게시 버튼 활성(spec §11.5) |
| 한 축이라도 `fail` | `fail` | 게시 버튼 기본 비활성. 편집·[다시 생성]·책임 게시 경로 유지 |

**`verdict = fail`이어도 등록한다.** 검증 실패로 상품을 사라지게 하면 기획자가 직접 고쳐 쓸 편집기의 의미가 없어진다(spec §11.5).

### 재시도·재생성 시

| 상황 | 처리 |
|---|---|
| 2·3차 재시도 후 재등록 | **같은 `product_id`·`slug`를 덮어쓴다.** 새 게시물 ID를 발급하지 않는다 |
| [다시 생성](Step 11) 후 재등록 | 같은 ID·slug 유지. `attempt_no`만 올라간 상태로 등록한다 |
| `published` 상태에서 [다시 생성] | **해당 없음.** `published`에서는 [다시 생성]을 제공하지 않는다(spec §15.1) |

## 금지 사항

- 새 파일·새 상품 행·새 slug를 만들지 않는다.
- `page_content`·`brochure_content`·`confirmed_data`·`form_input`을 수정하지 않는다.
- `validation_snapshot`을 수정하지 않는다. `verdict` 계산 결과만 기록한다.
- **자동으로 게시하지 않는다.** `published`로의 전이는 기획자의 명시적 [게시] 조작만으로 일어난다.
- `published_at`을 기록하지 않는다.
- 공개 라우트에 노출하지 않는다.
- 상태 표시를 콘텐츠 모델 안에 넣지 않는다. `status`는 DB가 단일 출처다.

## 판정 규칙

- 등록 자체는 실패하지 않는다. `verdict`가 `fail`이어도 `draft`로 등록한다.
- 등록 후 반환값의 `공개_URL_예정` 경로가 실제 `slug`와 일치해야 한다.
- 등록 후 `/p/{slug}` 접근이 404여야 한다. 200이면 spec §16.2 위반이다.
