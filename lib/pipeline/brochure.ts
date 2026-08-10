/**
 * 소개서 콘텐츠 모델 조립 (§8.7·§8.8) — **순수 모듈**.
 *
 * ## 구현 결정: 값 필드는 기계 치환, AI는 서술 1개만 만든다
 *
 * §8.7 표를 읽으면 소개서 8개 섹션에서 `source`가 `"generated"`인 필드는
 * `overview.핵심일정` **하나뿐**이다. 나머지는 전부 `confirmed_data`의 값을
 * 그대로 옮기는 치환이고, 일차별 서술(`days[].text`)은 Step 02가 이미 만든
 * `일정[n].내용`이다.
 *
 * 따라서 값 필드를 AI에게 다시 쓰게 하지 않는다 —
 *   · §16.1의 "값 변형 금지"를 구조적으로 보장한다 (1차 검증 실패의 최대 원인 제거)
 *   · `source` 맵은 §8.7이 단일 출처이므로 서버가 채운다. 누락이 발생할 수 없다
 *   · AI 호출은 여전히 요청당 1회다(§4.2)
 *
 * AI가 만드는 것은 `핵심일정` 2~3문장뿐이며, 그 근거도 `일정[n].내용`으로 한정된다.
 */
import type { ConfirmedData } from './normalize'

export interface BrochureSection {
  id: string
  type: string
  data: Record<string, unknown>
  source: Record<string, string>
}

export interface BrochureContent {
  schema_version: string
  sections: BrochureSection[]
}

/**
 * §8.7 표 그대로. `id` 접두사는 `b_`이며 순서는 고정이다.
 * `visible`·`locked`·`order`를 넣지 않는다 — 소개서는 편집 대상이 아니라
 * 읽기 전용 검토 문서다.
 */
export function buildBrochure(cd: ConfirmedData, 핵심일정: string): BrochureContent {
  const g = cd.행사정보
  return {
    schema_version: '1.0',
    sections: [
      {
        id: 'b_title', type: 'title',
        data: { text: g.행사명 },
        source: { text: '행사정보.행사명' },
      },
      {
        id: 'b_overview', type: 'overview',
        data: {
          여행지: g.여행지, 여행기간: g.여행기간,
          타겟층: g.타겟층, 여행스타일: g.여행스타일,
          핵심일정,
        },
        source: {
          여행지: '행사정보.여행지', 여행기간: '행사정보.여행기간',
          타겟층: '행사정보.타겟층', 여행스타일: '행사정보.여행스타일',
          // `source`가 "generated"인 유일한 필드다(§8.7)
          핵심일정: 'generated',
        },
      },
      {
        id: 'b_itinerary', type: 'itinerary',
        // `원문근거`는 확정 데이터표에만 남는다 — 0차가 이미 판정했고
        // 3차는 대조하지 않는다(§11.1)
        data: { days: g.일정.map((d) => ({ day: d.day, text: d.내용 })) },
        source: { days: '행사정보.일정' },
      },
      {
        id: 'b_accommodation', type: 'accommodation',
        data: {
          숙소명: cd.숙박.숙소명, 객실타입: cd.숙박.객실타입,
          위치: cd.숙박.위치, 숙박일정: cd.숙박.숙박일정,
        },
        source: {
          숙소명: '숙박.숙소명', 객실타입: '숙박.객실타입',
          위치: '숙박.위치', 숙박일정: '숙박.숙박일정',
        },
      },
      {
        id: 'b_flight', type: 'flight',
        data: { ...cd.항공편 },
        source: {
          공항: '항공편.공항', 항공사: '항공편.항공사', 편명: '항공편.편명',
          출발시간: '항공편.출발시간', 도착시간: '항공편.도착시간',
        },
      },
      {
        id: 'b_meal', type: 'meal',
        data: { 식사정보: cd.식사.식사정보 },
        source: { 식사정보: '식사.식사정보' },
      },
      {
        id: 'b_price', type: 'price',
        data: { 성인: cd.가격.성인, 아동: cd.가격.아동, 기타: cd.가격.기타 },
        source: { 성인: '가격.성인', 아동: '가격.아동', 기타: '가격.기타' },
      },
      {
        id: 'b_shop', type: 'shop',
        data: { 상점명: cd.상점.상점명, 상점정보: cd.상점.상점정보 },
        source: { 상점명: '상점.상점명', 상점정보: '상점.상점정보' },
      },
    ],
  }
}

export const BROCHURE_SECTION_IDS = [
  'b_title', 'b_overview', 'b_itinerary', 'b_accommodation',
  'b_flight', 'b_meal', 'b_price', 'b_shop',
] as const

/**
 * 서버 검사 (§8.3) — AI 호출 없음.
 * 섹션 8개·순서 일치, `source` 누락 0건, 미치환 토큰 0건, 길이 계약.
 */
export function checkBrochure(b: BrochureContent): string[] {
  const errors: string[] = []

  const ids = b.sections.map((s) => s.id)
  if (ids.length !== 8 || ids.some((id, i) => id !== BROCHURE_SECTION_IDS[i])) {
    errors.push(`섹션 8개·순서가 §8.7과 다릅니다: ${ids.join(',')}`)
  }

  for (const s of b.sections) {
    for (const [k, v] of Object.entries(s.data)) {
      if (k === 'days') continue
      if (!(k in s.source)) errors.push(`${s.id}.${k}에 source가 없습니다.`)
      if (typeof v === 'string') {
        // 미치환 토큰·조사 파이프 기호 0건 (§11.2)
        if (/\{\{|\}\}/.test(v)) errors.push(`${s.id}.${k}에 미치환 토큰이 남았습니다: ${v.slice(0, 40)}`)
        if (/\|[가-힣]{1,2}\}\}/.test(v)) errors.push(`${s.id}.${k}에 조사 파이프 기호가 남았습니다.`)
      }
    }
  }

  // 길이 계약 — 생성 시점에 존재하는 것만 검사한다(§17.1의 4종 중 소개서 해당분)
  const overview = b.sections.find((s) => s.id === 'b_overview')
  const 핵심일정 = overview?.data.핵심일정
  if (typeof 핵심일정 !== 'string' || 핵심일정.trim() === '') {
    errors.push('overview.핵심일정이 비어 있습니다.')
  }

  return errors
}
