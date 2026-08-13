/**
 * 상품 페이지 콘텐츠 모델 (§9.2·§9.3) — **순수 모듈**.
 *
 * ## 구현 결정 (소개서와 동일한 원칙)
 *
 * §9.3에서 `source`가 `"generated"`인 필드는 `apply.제목`·`apply.안내문구`뿐이고,
 * 확장 서술이 필요한 것은 `itinerary.days[].text` 하나다. 나머지는 전부
 * `confirmed_data`·소개서의 값을 승계하는 치환이다.
 *
 * 따라서 AI는 **일차별 확장 서술 + 신청 안내 문구**만 만들고, 값 필드는 서버가
 * 승계한다 — §16.1의 값 변형 금지를 구조적으로 보장하고 `source` 누락을 없앤다.
 *
 * AI는 HTML을 생성하지 않는다. 렌더링은 고정 React 컴포넌트가 담당한다(§9.1).
 */
import type { ConfirmedData } from './normalize'
import type { ThemeKey } from './theme'

export interface PageSection {
  id: string
  type: string
  order: number
  visible: boolean
  locked: boolean
  data: Record<string, unknown>
  source: Record<string, string>
}

export interface PageContent {
  schema_version: string
  theme: ThemeKey
  sections: PageSection[]
}

export const PAGE_SECTION_IDS = [
  'sec_hero', 'sec_summary', 'sec_itinerary', 'sec_accommodation',
  'sec_flight', 'sec_meal', 'sec_price', 'sec_shop', 'sec_apply',
] as const

/** 편집기에서 삭제할 수 없는 섹션 (§10.2). */
const LOCKED = new Set(['sec_hero', 'sec_apply'])

export interface PageInputs {
  cd: ConfirmedData
  theme: ThemeKey
  /** 업로드된 슬롯 이름 집합 — 없는 슬롯을 만들지 않는다(§16.1) */
  slots: Set<string>
  /** AI 산출 — 일차별 확장 서술 (day → text) */
  expanded: Map<string, string>
  /** AI 산출 — 신청 섹션 문구 */
  apply: { 제목: string; 안내문구: string }
}

export function buildPage(input: PageInputs): PageContent {
  const { cd, theme, slots, expanded, apply } = input
  const g = cd.행사정보

  /** 슬롯에 이미지가 없어도 **필드는 남긴다.** 렌더링 시 영역만 생략한다(§9.3). */
  const slotIf = (name: string) => (slots.has(name) ? name : '')

  const section = (
    id: string, type: string, order: number,
    data: Record<string, unknown>, source: Record<string, string>,
  ): PageSection => ({ id, type, order, visible: true, locked: LOCKED.has(id), data, source })

  return {
    schema_version: '1.0',
    theme,
    sections: [
      section('sec_hero', 'hero', 1,
        { headline: g.행사명, subcopy: g.여행기간, image_slot: slotIf('hero') },
        // image_slot에는 source를 붙이지 않는다 — 사실정보가 아니라 이미지 참조다(§9.3)
        { headline: '행사정보.행사명', subcopy: '행사정보.여행기간' }),

      section('sec_summary', 'summary', 2,
        {
          // 행사기간은 선택 — 미입력이면 빈 문자열, 렌더러가 표시하지 않는다
          행사기간: g.행사기간, 여행기간: g.여행기간, 여행지: g.여행지, 타겟층: g.타겟층,
          여행스타일: g.여행스타일, 여행주제: g.여행주제,
        },
        {
          행사기간: '행사정보.행사기간',
          여행기간: '행사정보.여행기간', 여행지: '행사정보.여행지',
          타겟층: '행사정보.타겟층', 여행스타일: '행사정보.여행스타일',
          여행주제: '행사정보.여행주제',
        }),

      section('sec_itinerary', 'itinerary', 3,
        {
          days: g.일정.map((d) => ({
            day: d.day,
            // 확장 서술이 없으면 소개서의 압축 서술을 그대로 쓴다 — 값이 사라지지 않는다.
            text: expanded.get(d.day)?.trim() || d.내용,
            image_slot: slotIf(`itinerary_day_${d.day}`),
          })),
        },
        { days: '행사정보.일정' }),

      section('sec_accommodation', 'accommodation', 4,
        {
          // 행 순서를 승계한다 — 순서가 값의 일부다(§7.4). 키 순서는 §9.3 표와 같다
          숙소들: cd.숙박.map((st) => ({
            숙소명: st.숙소명, 객실타입: st.객실타입, 위치: st.위치, 숙박일정: st.숙박일정,
          })),
          /*
           * 이미지 슬롯은 **행마다 갈라지지 않는다.** `accommodation` 슬롯 하나를
           * 숙소 전체가 공유한다(§7.3의 슬롯 4종은 그대로다). 행마다 슬롯을 주려면
           * 업로드 화면·슬롯 상한·`product_images.slot` 값이 함께 바뀌어야 하므로
           * 이번 개정 범위 밖이다 — 그렇게 하지 않아도 목록은 온전히 표시된다.
           */
          image_slots: slots.has('accommodation') ? ['accommodation'] : [],
        },
        { 숙소들: '숙박' }),

      section('sec_flight', 'flight', 5, { ...cd.항공편 }, {
        공항: '항공편.공항', 항공사: '항공편.항공사', 편명: '항공편.편명',
        출발시간: '항공편.출발시간', 도착시간: '항공편.도착시간',
      }),

      section('sec_meal', 'meal', 6,
        { 식사정보: cd.식사.식사정보 }, { 식사정보: '식사.식사정보' }),

      section('sec_price', 'price', 7,
        { 성인: cd.가격.성인, 아동: cd.가격.아동, 기타: cd.가격.기타 },
        { 성인: '가격.성인', 아동: '가격.아동', 기타: '가격.기타' }),

      section('sec_shop', 'shop', 8,
        {
          상점들: cd.상점.map((sh) => ({
            상점명: sh.상점명, 구분: sh.구분, 위치: sh.위치, 상점정보: sh.상점정보,
          })),
          image_slots: slots.has('shop') ? ['shop'] : [],
        },
        { 상점들: '상점' }),

      // 신청 폼의 **필드 구성(이름·이메일·연락처·인원수·동의)은 넣지 않는다** —
      // 고정 컴포넌트가 렌더링하며 편집 불가다(§9.3·§13.1).
      section('sec_apply', 'apply', 9,
        {
          제목: apply.제목, 안내문구: apply.안내문구,
          가격요약: { 성인: cd.가격.성인, 아동: cd.가격.아동 },
          행사정보요약: { 행사명: g.행사명, 여행기간: g.여행기간 },
        },
        {
          제목: 'generated', 안내문구: 'generated',
          '가격요약.성인': '가격.성인', '가격요약.아동': '가격.아동',
          '행사정보요약.행사명': '행사정보.행사명', '행사정보요약.여행기간': '행사정보.여행기간',
        }),
    ],
  }
}

/* ── 콘텐츠 길이 계약 (§17.1) ─────────────────────────────────────
 * **생성 시점에 강제하는 것은 4종이다.** `free_text`(500자)·`notice`(300자)는
 * 편집기에서 사람이 끼워 넣는 블록이라 생성 시점에 존재하지 않는다 —
 * 그 2종을 여기서 검사하도록 요구하면 실행 불가능한 규정이 된다.
 * ──────────────────────────────────────────────────────────────── */
export const LENGTH_LIMITS_GENERATE = {
  'hero.headline': 40,
  'hero.subcopy': 80,
  '일차별 서술': 200,
  '섹션 제목': 30,
} as const

/** 서버 검사 (§9.5 ①) — AI 호출 없음. */
export function checkPage(p: PageContent, slots: Set<string>): string[] {
  const errors: string[] = []

  const ids = p.sections.map((s) => s.id)
  if (ids.length !== 9 || ids.some((id, i) => id !== PAGE_SECTION_IDS[i])) {
    errors.push(`섹션 9개·순서가 §9.3과 다릅니다: ${ids.join(',')}`)
  }
  if (p.sections.some((s, i) => s.order !== i + 1)) {
    errors.push(`order가 1~9와 다릅니다: ${p.sections.map((s) => s.order).join(',')}`)
  }
  for (const id of ['sec_hero', 'sec_apply']) {
    if (!p.sections.find((s) => s.id === id)?.locked) errors.push(`${id}는 locked: true여야 합니다.`)
  }

  const hero = p.sections.find((s) => s.id === 'sec_hero')
  const headline = String(hero?.data.headline ?? '')
  const subcopy = String(hero?.data.subcopy ?? '')
  // 값을 잘라내는 것은 §16.1 위반이므로, 초과하면 자르지 않고 실패로 반환한다.
  if (headline.length > LENGTH_LIMITS_GENERATE['hero.headline']) {
    errors.push(`hero.headline이 40자를 넘습니다 (${headline.length}자). 값을 자르지 않습니다.`)
  }
  if (subcopy.length > LENGTH_LIMITS_GENERATE['hero.subcopy']) {
    errors.push(`hero.subcopy가 80자를 넘습니다 (${subcopy.length}자).`)
  }

  const days = p.sections.find((s) => s.id === 'sec_itinerary')?.data.days as
    { day: string; text: string; image_slot: string }[] | undefined
  for (const d of days ?? []) {
    if (d.text.length > LENGTH_LIMITS_GENERATE['일차별 서술']) {
      errors.push(`${d.day}일차 서술이 200자를 넘습니다 (${d.text.length}자).`)
    }
  }

  for (const s of p.sections) {
    // 「섹션 제목」 30자 — 생성 시점에 제목을 가진 것은 `sec_apply`뿐이지만,
    // 조건을 `sec_apply`로 좁히지 않는다. §9.3 표에 제목 필드가 늘면 검사도
    // 함께 늘어야 하는데, id로 걸어두면 그때 조용히 빠진다.
    const 제목 = s.data.제목
    if (typeof 제목 === 'string' && 제목.length > LENGTH_LIMITS_GENERATE['섹션 제목']) {
      errors.push(`${s.id}의 제목이 30자를 넘습니다 (${제목.length}자).`)
    }

    for (const [k, v] of Object.entries(s.data)) {
      // 이미지 참조에는 source를 **붙이지 않는다** — 사실정보가 아니다(§9.3)
      if (k === 'image_slot' || k === 'image_slots') {
        if (k in s.source) {
          errors.push(`${s.id}.${k}에 source가 붙어 있습니다. 이미지 참조는 사실정보가 아닙니다.`)
        }
        continue
      }
      if (k === '가격요약' || k === '행사정보요약') {
        for (const sub of Object.keys(v as object)) {
          if (!(`${k}.${sub}` in s.source)) errors.push(`${s.id}.${k}.${sub}에 source가 없습니다.`)
        }
        continue
      }

      if (!(k in s.source)) errors.push(`${s.id}.${k}에 source가 없습니다.`)

      // 배열 필드(`days`·`숙소들`·`상점들`)는 원소 안의 문자열을 본다.
      // `days`를 통째로 건너뛰던 이전 코드에서는 일차 서술의 미치환 토큰이
      // 이 검사를 그대로 통과했다.
      if (Array.isArray(v)) {
        for (const [i, row] of v.entries()) {
          if (row === null || typeof row !== 'object') continue
          for (const [sub, val] of Object.entries(row as Record<string, unknown>)) {
            if (typeof val === 'string' && /\{\{|\}\}/.test(val)) {
              errors.push(`${s.id}.${k}[${i}].${sub}에 미치환 토큰이 남았습니다.`)
            }
          }
        }
        continue
      }

      if (typeof v === 'string' && /\{\{|\}\}/.test(v)) {
        errors.push(`${s.id}.${k}에 미치환 토큰이 남았습니다.`)
      }
    }
  }

  // 이미지 참조는 업로드 시 지정된 슬롯만 가리킨다. 재배치·생성 금지(§16.1)
  for (const d of days ?? []) {
    if (d.image_slot && !slots.has(d.image_slot)) {
      errors.push(`${d.day}일차가 없는 슬롯을 참조합니다: ${d.image_slot}`)
    }
  }
  const heroSlot = String(hero?.data.image_slot ?? '')
  if (heroSlot && !slots.has(heroSlot)) errors.push(`hero가 없는 슬롯을 참조합니다: ${heroSlot}`)

  return errors
}
