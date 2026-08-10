---
name: content-structuring
description: 확정 데이터표와 소개서 내용을 상품 페이지 콘텐츠 구조로 변환한다. 소개서의 압축 서술을 페이지의 확장 서술로 늘리되 사실정보 값은 그대로 유지하고, source 맵을 승계한다.
---

## 목적
- 소개서 8개 섹션을 상품 페이지 9개 섹션 구조로 매핑한다.
- 소개서의 압축 서술을 페이지용 확장 서술로 늘린다.
- `source` 맵을 승계해 2차·3차 검증이 성립하게 한다.

## 실행 조건
- 호출 주체: web-builder-agent (workflow Step 05의 **첫 번째** 스킬)
- 선행 조건: `status = brochure_ready` **AND** `validation_snapshot.axes.axis_1.verdict = pass`
- 실행 시점: 페이지 생성 1회당 1회
- AI 호출: **1회.** Step 05가 쓸 수 있는 AI 호출 1회가 이 스킬과 `web-content-structure-gen`에 함께 배정된다(같은 프롬프트의 연속 단계)
- 실행하는 경우: 2차·3차 검증 실패로 재시도할 때 — **이 스킬부터** 다시 실행한다(확정 데이터표·소개서는 유지)

## 입력

| 항목 | 형식 | 필수 | 설명 |
|---|---|---|---|
| 확정 데이터표 | object(JSON) | 필수 | 값의 출처 |
| 소개서 | object(JSON) | 필수 | `brochure_content`. 확장의 기준이 되는 원문 |
| 이미지 슬롯 목록 | array of object | 필수 | `{slot, alt}` — `product_images`에서 조회 |

## 출력

| 항목 | 형식 | 설명 |
|---|---|---|
| 구조화 결과 | array of object | 9개 섹션의 `{id, type, order, data, source}` |
| 섹션 매핑표 | array of object | `{소개서_섹션, 페이지_섹션, 승계필드}` — 3차 검증 보조 |
| 확장 이력 | array of object | `{경로, 소개서_문장, 페이지_문장}` |

```json
{
  "구조화결과": [
    { "id": "sec_hero", "type": "hero", "order": 1,
      "data": { "headline": "제주 올레 바람 여행", "subcopy": "2026-03-14 ~ 2026-03-17", "image_slot": "hero" },
      "source": { "headline": "행사정보.행사명", "subcopy": "행사정보.여행기간" } },
    { "id": "sec_itinerary", "type": "itinerary", "order": 3,
      "data": { "days": [
        { "day": "1", "text": "여행 첫날은 김해공항에서 출발합니다. 제주에 도착한 뒤 올레 7코스를 걸으며 해안 풍경을 감상합니다. 중식과 석식이 제공됩니다.",
          "image_slot": "itinerary_day_1" }
      ] },
      "source": { "days": "행사정보.일정" } }
  ],
  "섹션매핑표": [
    { "소개서_섹션": "b_title", "페이지_섹션": "sec_hero", "승계필드": ["행사명"] },
    { "소개서_섹션": "b_itinerary", "페이지_섹션": "sec_itinerary", "승계필드": ["일차 수", "일차별 사실정보"] }
  ],
  "확장이력": [
    { "경로": "sec_itinerary.data.days[0].text",
      "소개서_문장": "김해공항에서 출발해 올레 7코스를 걷습니다. 중식과 석식이 제공됩니다.",
      "페이지_문장": "여행 첫날은 김해공항에서 출발합니다. 제주에 도착한 뒤 올레 7코스를 걸으며 해안 풍경을 감상합니다. 중식과 석식이 제공됩니다." }
  ]
}
```

## 산출물
- 파일 산출물 없음. 반환값만 web-builder-agent에 전달한다.
- 전달 대상: web-builder-agent → `theme-design-token-match`(다음 스킬)
- `섹션매핑표`는 3차 검증(`consistency-check`)의 대조 기준으로 함께 전달된다.

## 섹션 매핑 (소개서 8 → 페이지 9)

| 소개서 | 페이지 | 변화 |
|---|---|---|
| `b_title` | `sec_hero` | 행사명 + 여행기간 부제 + hero 이미지 추가 |
| `b_overview` | `sec_summary` | 동일 값, 카드형 배치 |
| `b_itinerary` | `sec_itinerary` | 확장 서술 + 일차별 이미지 슬롯 추가 |
| `b_accommodation` | `sec_accommodation` | 동일 값 + 숙박 이미지 슬롯 |
| `b_flight` | `sec_flight` | 동일 값 |
| `b_meal` | `sec_meal` | 동일 값 |
| `b_price` | `sec_price` | 동일 값 |
| `b_shop` | `sec_shop` | 동일 값 + 상점 이미지 슬롯 |
| — | `sec_apply` | **신규.** 신청 폼 + 가격 요약 + 행사 정보 |

`sec_apply`는 소개서에 대응 섹션이 없으므로 3차 검증에서 제외된다(`skipped`). 단 내부의 가격·행사 정보는 `sec_price`·`sec_hero`와 일치해야 한다.

## 이미지 슬롯 배치

| 섹션 | 참조 필드 | 슬롯 |
|---|---|---|
| `sec_hero` | `data.image_slot` | `hero` |
| `sec_itinerary` | `data.days[n].image_slot` | `itinerary_day_{n}` |
| `sec_accommodation` | `data.image_slots` (배열) | `accommodation` |
| `sec_shop` | `data.image_slots` (배열) | `shop` |
| 갤러리 블록 | `data.image_slots` (배열) | `gallery` |

**업로드 시 사용자가 지정한 슬롯을 그대로 참조한다.** 재배치·추론·교체 금지(spec §16.1). 해당 슬롯에 이미지가 없으면 필드는 두고 렌더링 시 영역만 생략한다.

## 확장 서술 규칙

소개서는 압축, 페이지는 확장이다. 이것은 설계된 차이이며 3차 검증에서 실패 사유가 아니다(spec §11.1).

| 허용 | 금지 |
|---|---|
| 문장을 나누거나 연결어를 넣어 늘리기 | 새 장소·활동·이동·시설 추가 |
| 이미 등장한 요소를 다른 표현으로 재언급 | 소요 시간·거리·인원 등 출처 없는 숫자 생성 |
| 안내 문구 추가(`자세한 일정은 문의해 주세요`) | 사실정보 값 자체의 재표기·요약·삭제 |
| 값을 감싸는 서술의 어순 조정 | 값 안의 어순·표기 변경 |

**일차별 서술 확장의 경계**: `행사정보.일정[n].원문근거`에 등장하는 요소만 사용한다. 소개서 문장에 없던 요소를 페이지에서 새로 넣으면 2차 검증 실패다.

## 판정 규칙

- 9개 섹션이 `order` 1~9로 빠짐없이 생성돼야 한다.
- 모든 사실정보 필드에 `source`가 승계돼야 한다. **`source`가 없는 필드는 그 자체로 실패다.**
- `sec_hero.data.headline`은 `행사정보.행사명` 값 그대로이며 40자 이내여야 한다. **값을 잘라내면 실패다**(spec §16.1).
- 일차 수가 소개서·확정 데이터표와 일치해야 한다.
- `추후 추가 예정`·`해당 없음`은 그대로 표기한다. 섹션을 삭제하지 않는다.
- HTML을 생성하지 않는다. 산출물은 JSON 콘텐츠 모델이다.
- 확정 데이터표를 변경하지 않는다.
- **재시도 여부를 판단하지 않는다.**
