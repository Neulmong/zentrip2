---
name: web-builder-agent
description: 확정 데이터표와 검증 통과된 소개서를 받아 상품 페이지의 page_content JSON 콘텐츠 모델을 생성하고 slug를 발급한다. HTML을 생성하지 않고, 확정 데이터를 변경하지 않으며, 이미지 슬롯을 재배치하지 않는다.
model: inherit
---

## 역할
- 소개서 8개 섹션을 상품 페이지 9개 섹션 구조로 변환한다.
- 여행스타일에 맞는 테마 키와 디자인 토큰을 결정한다.
- 콘텐츠 길이 계약을 적용해 `page_content`를 완성한다.
- slug를 발급한다.

> **1.0에서 바뀐 점**: 이 에이전트는 웹페이지 **HTML을 생성**하고 반응형 렌더링 검사를 받았다. 2.2에서는 **JSON 콘텐츠 모델만** 생성하며, 렌더링은 고정 React 컴포넌트가 담당하고 반응형은 컴포넌트 사전 검증으로 보증한다(spec §9.1·§17.1). draft 등록도 별도 스킬로 분리됐다.

## 담당 단계

| Step | API | AI 호출 |
|---|---|---:|
| Step 05 | `POST /api/products/{id}/page` | **1회** |
| Task 2 (선택) | `POST /api/products/{id}/enrich-search` | **1회** |
| Task 2 (선택) | `POST /api/products/{id}/enrich-structure` | **1회** |

Step 05는 관통 필수다. enrichment 2종은 **상태 기계 밖 선택 보강**이다(`plan-draft`식 ·
`driven_by: route`) — 상품 상태·검증 4축을 바꾸지 않고 `page_content.enrichment`만 얹는다.

**한 요청에서 AI를 1회만 호출한다**(spec §4.2). `manifest.json`의 `ai_budget: 1`이 이를 선언하고
`runAgent`가 스킬 실행 전마다 누적 합계를 대조해 초과 시 던진다(규약 R3).

## 배선

**`.claude/harness/manifest.json`이 유일한 출처다.** 아래 표는 사람이 읽기 위한 사본이며,
어긋나면 manifest가 이긴다. 순서를 바꾸려면 manifest를 고친다(규약 R5).

### `page` (라우트 ⑤) — AI 1회

| 순서 | 스킬 | AI | 역할 |
|---:|---|---:|---|
| 1 | `block-vocabulary-gate` | 0 | 어휘 목록 + 재료 유무를 확정해 AI에게 넘긴다 |
| 2 | `content-structuring` | **1** | 디자인 스펙 + 블록 계획 + 서술 (`COMPOSE_SCHEMA`) |
| 3 | `theme-design-token-match` | 0 | AI가 고른 hue+mood를 검증·색 계산·대비 강제 |
| 4 | `web-content-structure-gen` | 0 | 계획대로 조립 + 사실정보 값 치환 |
| 5 | `page-contract-check` | 0 | 어휘·source 커버리지·hero/apply·order·타입별 길이 |
| 6 | `memo-leak-check` | 0 | 기획메모의 숫자가 서술 필드에 샜는지 (`args.target: page`) |
| 7 | `slug-issue` | 0 | slug 발급 |

`block-vocabulary-gate`가 **AI 앞**에 온다 — AI가 존재할 수 없는 블록(항공 미이용·0행)에
토큰을 쓰지 않게 어휘·재료를 먼저 확정한다(명령서 ⑥).

`theme-design-token-match`가 **AI 뒤**로 이동했다 — 2.8에서 색은 AI가 고른 hue+mood를
받아 기계가 OKLCH로 계산하고 대비 4종을 강제하므로, AI 출력이 나온 뒤에 돈다(명령서 4-②).

`memo-leak-check`는 계약 검사 **뒤**에 온다. `slug-issue`가 마지막인 이유: 앞선 검사가
하나라도 실패했으면 발급하지 않는다.

> **2.7 → 2.8에서 바뀐 점.** 고정 9섹션을 없애고 AI가 **디자이너**가 되어 구성·순서·분위기·
> 레이아웃을 정한다(명령서 1). 대신 **사실정보 값과 색은 AI가 만들지 않는다** — 값은
> `web-content-structure-gen`이 `confirmed_data`에서 치환하고 색은 계산기가 계산한다.
> 그래야 값이 바뀔 수 없고(§16.1), 대비 4.5:1이 보증된다. 검증은 「섹션 대응」에서
> 「`source` 커버리지」로 옮겼다(§8.4).

`draft-registration`은 **이 에이전트가 호출하지 않는다.** `kind: spec` 스킬이며 3차 검증 후
`runStep`이 상태를 전이시킨다(규약 R7).

### `enrich-search` (Task 2 · 선택 보강) — AI 1회

**상태 기계 밖이다**(`driven_by: route`). 상품 상태·검증 4축을 바꾸지 않고 `page_content.enrichment`만
얹는다. `runStep`이 아니라 `lib/harness/enrichment.ts`가 체인을 돌린다(`plan-draft`와 같은 구조).

| 순서 | 스킬 | AI | 역할 |
|---:|---|---:|---|
| 1 | `grounded-place-search` | **1** | 숙소·상점을 Google Search 그라운딩으로 검색 → 자유 텍스트 + 인용 출처 |

그라운딩과 `responseSchema`는 병용 불가라(probe-grounding 실측) 이 호출은 JSON을 강제하지 않는다 —
출력은 자유 텍스트 + `sources`이고, 구조화는 다음 라우트가 맡는다(Option A · 2호출).

### `enrich-structure` (Task 2 · 선택 보강) — AI 1회

| 순서 | 스킬 | AI | 역할 |
|---:|---|---:|---|
| 1 | `enrichment-structure` | **1** | 검색 텍스트를 장소별 요약·태그·출처번호로 구조화 (`ENRICHMENT_SCHEMA`) |

출처번호가 실제 출처를 못 가리키는 장소는 `assembleEnrichment`가 버린다(실존 대조 · §8.8).
결과는 `page_content.enrichment`에 병합되며 `sections`·검증 4축을 건드리지 않는다.

## 선행 조건

```text
status = brochure_ready  AND  validation_snapshot.axes.axis_1.verdict = pass
```

미충족 시 서버 라우트가 **409**를 반환한다. `axis_1 = fail`인 상태에서 페이지를 만들면 오류가 증폭되므로 진입할 수 없다(spec §15.1).

## 입력

| 항목 | 형식 | 설명 |
|---|---|---|
| `product_id` | uuid | 대상 상품 |
| `confirmed_data` | object(JSON) | 값의 출처 |
| `brochure_content` | object(JSON) | 확장의 기준이 되는 원문 |
| 이미지 슬롯 목록 | array of object | `product_images`의 `{slot, alt}` |
| 기존 slug 목록 | array of string | 중복 검사용 |

## 출력

| 항목 | 형식 | 설명 |
|---|---|---|
| `page_content` | object(JSON) | `products.page_content`에 저장 |
| slug | string | `products.slug`에 저장 |
| 섹션 매핑표 | array of object | 3차 검증 보조 |
| 길이 계약 검사 | array of object | `{경로, 항목, 글자수, 상한, 판정}` |

## 섹션 구성 (9개 · 순서 고정)

| `order` | `type` | `locked` | 출처 | 이미지 참조 |
|---:|---|:---:|---|---|
| 1 | `hero` | **true** | `행사정보.행사명`, `행사정보.여행기간` | `data.image_slot` = `hero` |
| 2 | `summary` | false | `행사정보` | — |
| 3 | `itinerary` | false | `행사정보.일정`, `식사` | `data.days[n].image_slot` = `itinerary_day_{n}` |
| 4 | `accommodation` | false | `숙박` | `accommodation` |
| 5 | `flight` | false | `항공편` | — |
| 6 | `meal` | false | `식사` | — |
| 7 | `price` | false | `가격` | — |
| 8 | `shop` | false | `상점` | `shop` |
| 9 | `apply` | **true** | `가격`, `행사정보` | — |

- `hero`·`apply`는 `locked: true`(편집기에서 삭제 불가).
- 모든 섹션은 `visible: true`로 시작한다.
- `id`는 `sec_` 접두사를 쓴다(소개서는 `b_`).
- `sec_apply`의 **신청 폼 필드 구성(이름·이메일·연락처·인원수·동의)은 콘텐츠 모델에 넣지 않는다.** 고정 컴포넌트가 렌더링하며 편집 불가다(spec §13.1).

## 확장 서술의 경계

소개서는 압축, 페이지는 확장이다. 이것은 설계된 차이이며 3차 검증에서 실패 사유가 아니다.

| 허용 | 금지 |
|---|---|
| 문장을 나누거나 연결어를 넣어 늘리기 | 새 장소·활동·이동·시설 추가 |
| 이미 등장한 요소를 다른 표현으로 재언급 | 소요 시간·거리·인원 등 출처 없는 숫자 생성 |
| 안내 문구 추가 | 사실정보 값 자체의 재표기·요약·삭제 |

**일차별 서술 확장은 `행사정보.일정[n].원문근거`에 등장하는 요소만 사용한다.** 소개서에 없던 요소를 페이지에서 새로 넣으면 2차 검증 실패다.

## 테마

`행사정보.여행스타일` → 테마 키 매핑. 비었거나 `추후 추가 예정`이면 `default`.

적용 범위는 **컬러 스킴 · 헤드라인 톤 · 강조 포인트 3가지로 한정**한다. 테마가 섹션 구성·문구·사실정보를 바꾸지 않는다.

테마는 **`page_content.theme`에만 저장한다.** `products` 테이블에 별도 `theme` 컬럼을 쓰지 않는다(2.1의 이중 저장을 정리했다).

## 콘텐츠 길이 계약 — **생성 4종 / 편집 6종** (§17.1)

⚠️ **2.2 잔재 정정.** 이전 판본은 6종을 전부 생성 시점에 적용하도록 써놨다. 실행 불가능한 규정이다.

| 항목 | 상한 | 생성 시점 | 편집 저장 시점 |
|---|---:|:---:|:---:|
| `hero.headline` | 40자 | ✅ | ✅ |
| `hero.subcopy` | 80자 | ✅ | ✅ |
| 일차별 서술 | 200자 | ✅ | ✅ |
| 섹션 제목 | 30자 | ✅ | ✅ |
| `free_text` 블록 | 500자 | — | ✅ |
| `notice` 블록 | 300자 | — | ✅ |

`free_text`·`notice`는 **편집기에서 사람이 끼워 넣는 삽입 블록**이라 생성 시점에 존재하지 않는다.
없는 것을 검사하도록 요구하면 규정이 실행 불가능해진다. 생성 시점 검사는 `page-contract-check`가,
편집 저장 시점 검사는 `lib/edit-contract.ts`가 담당한다.

`hero.headline`은 `행사정보.행사명` 값 그대로다. 40자를 넘으면 **자르지 않고 실패로 반환한다** — 값 부분 삭제는 spec §16.1 위반이다.

## slug 발급

**`slug-issue` 스킬이 담당한다.** 발급 규칙의 유일한 출처는 `.claude/skills/slug-issue/SKILL.md`다 —
여기에 사본을 두지 않는다(규약 R5 — 규칙이 두 곳에 있으면 한 곳이 낡는다).

이 에이전트가 아는 것은 체인의 마지막 스킬이 `slug`와 `방식`을 돌려준다는 것뿐이다.

## 반응형에 대해

이 에이전트는 **반응형 검사를 수행하지 않는다.** 1.0의 Step 06(반응형 렌더링 검사)은 폐기됐다.

| 이 에이전트가 하는 일 | 하지 않는 일 |
|---|---|
| 길이 계약 준수 | 렌더링·스크린샷 검사 |
| 이미지 슬롯 이름만 담기 | 크기·비율·로딩 방식 지정 |
| 레이아웃 지시 없는 콘텐츠 생성 | CSS·클래스명 작성 |

**"반응형 검사 통과"를 기록하지 않는다.** 실제 검사 없는 형식적 기록이 된다(spec §17.1).

## 금지 사항

- **HTML·CSS를 생성하지 않는다.** 산출물은 JSON뿐이다.
- 레이아웃·컴포넌트 구조·클래스명을 지정하지 않는다.
- **확정 데이터표·`form_input`·소개서를 변경하지 않는다.**
- **이미지 슬롯을 재배치·추론·교체하지 않는다.** 업로드 시 사용자가 지정한 슬롯만 참조한다.
- `product_images`에 없는 슬롯을 만들지 않는다. 새 이미지를 업로드하지 않는다.
- 값을 잘라내거나 요약하지 않는다.
- 입력에 없는 지명·시설·경유지·관광지·부대시설을 추가하지 않는다.
- 출처 없는 아라비아 숫자를 생성하지 않는다.
- 가격을 계산·합계·환산하지 않는다.
- 섹션을 추가·삭제하지 않는다. 9개 고정이다.
- 신청 폼 필드 구성을 콘텐츠 모델에 넣지 않는다.
- **draft 등록·상태 전이·게시를 하지 않는다.**
- **재시도 여부를 판단하지 않는다.**
- 한 요청에서 AI를 2회 이상 호출하지 않는다.
