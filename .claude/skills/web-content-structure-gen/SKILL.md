---
name: web-content-structure-gen
description: 상품 페이지의 page_content JSON 콘텐츠 모델을 완성한다. AI 블록 계획대로 조립하고 사실정보 값을 confirmed_data에서 치환하며, 타입별 길이 계약을 적용하고 HTML을 생성하지 않는다.
---

> **2.8**: 9섹션 하드코딩을 버렸다. **AI의 블록 계획대로 조립**하며 사실정보 값을 `confirmed_data`에서 치환한다(`buildPage`). hero는 처음·apply는 마지막을 기계가 보증하고 그 사이는 계획 순서다. 어휘·재료는 `vocabulary.ts`가 단일 출처다.


## 목적
- `page_content` 콘텐츠 모델을 최종 형태로 완성한다.
- 콘텐츠 길이 계약을 적용해 반응형 보증이 성립하게 한다.

> **1.0에서 바뀐 점**: 이 스킬은 웹페이지 **HTML을 생성**하고 반응형 렌더링 검사를 받는 대상이었다. 2.2에서는 **JSON 콘텐츠 모델만** 생성하며, 렌더링은 고정 React 컴포넌트가 담당하고 반응형은 컴포넌트 사전 검증으로 보증한다(spec §9.1·§17.1).

## 배선

`manifest.json`이 유일한 출처다. 요약: `web-builder-agent` · `page` 체인 **3번** ·
**AI 0회** · `impl: pipeline/page#buildPage`.

앞의 두 스킬이 만든 재료를 받아 조립한다 — `theme-design-token-match`(1번)의 테마 키와
`content-structuring`(2번)의 확장 서술이 있어야 한다. 체인의 마지막이 아니다:
뒤에 `page-contract-check`(4) · `memo-leak-check`(5) · `slug-issue`(6)가 온다.

**AI를 쓰지 않는다.** 이전 판본은 `content-structuring`과 "같은 AI 호출 1회 안의 마지막
단계"로 적혀 있었으나, 하네스에서는 **AI가 서술만 쓰고 조립은 기계가 한다.** §9.3에서
`source: "generated"`인 필드는 `itinerary.days[].text`와 `apply` 2종뿐이므로 값 필드를
AI에게 다시 쓰게 할 이유가 없다. 스킬 두 개가 AI 호출 하나를 나눠 쓰는 구조는 규약 R2·R3에서
성립하지 않는다 — `ai_budget`은 스킬 단위로 대조된다.

## 입력

| 항목 | 형식 | 필수 | 설명 |
|---|---|---|---|
| 확정 데이터표 | object(JSON) | 필수 | 값의 출처 |
| 구조화 결과 | array of object | 필수 | `content-structuring` 출력 (확장 서술 + `apply` 문구) |
| 테마 키 | string | 필수 | `theme-design-token-match` 출력 |
| 이미지 슬롯 목록 | array of string | 필수 | 업로드된 슬롯. 없는 슬롯을 만들지 않는다(§16.1) |

## 출력

| 항목 | 형식 | 설명 |
|---|---|---|
| `page_content` | object(JSON) | 최종 콘텐츠 모델. **이것 하나뿐이다** |

slug는 반환하지 않는다 — `slug-issue`(체인 6번)의 산출물이다.
길이 계약 판정도 반환하지 않는다 — `page-contract-check`(체인 4번)가 검사한다.

```json
{
  "page_content": {
    "schema_version": "1.0",
    "theme": "nature",
    "sections": [
      { "id": "sec_hero", "type": "hero", "order": 1, "visible": true, "locked": true,
        "data": { "headline": "제주 올레 바람 여행", "subcopy": "2026-03-14 ~ 2026-03-17", "image_slot": "hero" },
        "source": { "headline": "행사정보.행사명", "subcopy": "행사정보.여행기간" } },
      { "id": "sec_itinerary", "type": "itinerary", "order": 3, "visible": true, "locked": false,
        "data": { "days": [
          { "day": "1", "text": "여행 첫날은 김해공항에서 출발합니다. …", "image_slot": "itinerary_day_1" }
        ] },
        "source": { "days": "행사정보.일정" } },
      { "id": "sec_apply", "type": "apply", "order": 9, "visible": true, "locked": true,
        "data": { "제목": "여행 신청", "안내문구": "아래 정보를 남겨 주시면 담당자가 연락드립니다.",
                  "가격요약": { "성인": "120000원", "아동": "해당 없음" },
                  "행사정보요약": { "행사명": "제주 올레 바람 여행", "여행기간": "2026-03-14 ~ 2026-03-17" } },
        "source": { "가격요약.성인": "가격.성인", "가격요약.아동": "가격.아동",
                    "행사정보요약.행사명": "행사정보.행사명", "행사정보요약.여행기간": "행사정보.여행기간",
                    "제목": "generated", "안내문구": "generated" } }
    ]
  }
}
```

## 산출물
- 파일 산출물 없음. 반환값이 `products.page_content`에 저장된다(`products.slug`는 `slug-issue`의 몫이다).
- 전달 대상: web-builder-agent → 서버 라우트가 DB에 저장 → 로그 `page_generated`
- `draft-registration`은 2·3차 검증 통과 후 별도로 실행된다. **이 스킬이 draft 등록을 하지 않는다.**

## 섹션 구성 (9개 · 순서 고정)

| `order` | `type` | `locked` | 필수 내용 |
|---:|---|:---:|---|
| 1 | `hero` | **true** | 행사명, 여행기간 부제, hero 이미지 |
| 2 | `summary` | false | 여행기간, 여행지, 타겟층, 여행스타일 |
| 3 | `itinerary` | false | 일차별 일정·이동·식사, 일차 이미지 |
| 4 | `accommodation` | false | `숙소들[]` — 행마다 숙소명, 객실타입, 위치, 숙박일정 · 숙소 이미지 |
| 5 | `flight` | false | 공항, 항공사, 편명, 출발·도착 시간 |
| 6 | `meal` | false | 식사정보 |
| 7 | `price` | false | 성인, 아동, 기타 |
| 8 | `shop` | false | `상점들[]` — 행마다 상점명, 구분, 위치, 상점정보 · 상점 이미지 |
| 9 | `apply` | **true** | 신청 폼, 가격 요약, 행사 정보 |

- `hero`와 `apply`는 `locked: true`로 설정한다. 편집기에서 삭제할 수 없다(spec §10.2).
- 모든 섹션은 `visible: true`로 시작한다.
- `sec_apply`의 **신청 폼 필드 구성(이름·이메일·연락처·인원수·동의)은 콘텐츠 모델에 넣지 않는다.** 고정 컴포넌트가 렌더링하며 편집 불가다(spec §13.1).

## 콘텐츠 길이 계약 — 생성 시점은 4종이다 (§17.1)

이 스킬이 조립할 때 지켜야 하는 상한이다.

| 항목 | 상한 | 초과 시 |
|---|---:|---|
| `hero.headline` | 40자 | **실패.** 값을 자르지 않는다 |
| `hero.subcopy` | 80자 | 실패 |
| 일차별 서술 | 200자 | 실패 |
| 섹션 제목 | 30자 | 실패 |

**나머지 2종(`free_text` 500자·`notice` 300자)은 여기 없다.** 그 둘은 사람이 편집기에서
끼워 넣는 블록이라 **생성 시점에는 존재하지 않는다.** 6종을 생성 단계에서 요구하면
실행할 수 없는 규정이 된다. 6종은 **편집 저장 시점**의 계약이다.

| 시점 | 계약 | 검사 주체 |
|---|---|---|
| 생성 (라우트 ⑤) | **4종** | `page-contract-check` |
| 편집 저장 (`PATCH /content`) | **6종** | `lib/edit-contract.ts` |

검사는 이 스킬이 하지 않는다. **`page-contract-check`가 한다**(규약 R2 — 조립과 검사는 다른 일이다).
상한 값의 유일한 출처는 `.claude/skills/page-contract-check/SKILL.md`다.

`hero.headline`은 `행사정보.행사명` 값 그대로이며 폼에서 40자 상한이 이미 강제된다(spec §7.1). 그래도 초과가 발생하면 **자르지 않고 실패로 반환한다** — 값 부분 삭제는 spec §16.1 위반이다.

## slug — 이 스킬의 일이 아니다

**`slug-issue` 스킬이 발급한다**(규약 R2 — 스킬은 단일 기능). 이 스킬은 slug를 만들지도
읽지도 않는다. 발급 규칙·충돌 접미사·로마자 변환 금지의 유일한 출처는
`.claude/skills/slug-issue/SKILL.md`이며, 체인에서 이 스킬보다 **뒤**에 온다.

## 반응형 보증 (검사 단계가 아니다)

1.0의 Step 06(반응형 렌더링 검사)은 폐기됐다. 이 스킬은 **검사를 수행하지 않고**, 아래 계약을 지켜 컴포넌트가 보증할 수 있는 콘텐츠를 만든다.

| 계약 | 내용 |
|---|---|
| 길이 계약 | 위 **4종** 상한 준수 (생성 시점) |
| 이미지 참조 | 슬롯 이름만 담는다. 크기·비율·로딩 방식은 컴포넌트가 정한다 |
| 표·긴 텍스트 | 콘텐츠 모델에 레이아웃 지시를 넣지 않는다. 컴포넌트가 `overflow-x: auto`를 처리한다 |
| 금지 | **"반응형 검사 통과"를 기록하지 않는다.** 실제 검사 없는 형식적 기록이 된다(spec §17.1) |

## 금지 사항

- **HTML·CSS를 생성하지 않는다.** 산출물은 JSON뿐이다.
- 레이아웃·컴포넌트 구조·클래스명을 지정하지 않는다.
- 확정 데이터표·소개서를 변경하지 않는다.
- 이미지 슬롯을 재배치하지 않는다. 업로드 시 지정된 슬롯만 참조한다.
- 새 이미지를 참조하지 않는다. `product_images`에 없는 슬롯을 만들지 않는다.
- 값을 잘라내거나 요약하지 않는다.
- 출처 없는 아라비아 숫자를 생성하지 않는다.
- 섹션을 추가·삭제하지 않는다. 9개 고정이다.
- draft 등록·상태 전이를 하지 않는다.
- **재시도 여부를 판단하지 않는다.**
