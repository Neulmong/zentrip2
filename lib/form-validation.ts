/**
 * 웹 폼 입력 검증 (§7.1·§7.2·§6.2.1) — **순수 모듈**.
 *
 * 프론트엔드와 서버가 **같은 규칙**을 쓴다. 서버는 프론트엔드 validation을
 * 신뢰하지 않고 동일 규칙으로 재검증하며, 위반 시 400을 반환하고
 * 파이프라인을 시작하지 않는다(§16.2).
 */
import { TRIP_DAYS_MAX, TRIP_DAYS_MIN, type FormInput } from './types'

/* ── 일차 구분 인식 범위 (§6.3 · 확정 6종) ────────────────────────
 * 이 목록이 실패 판정의 기준이므로 구현에서 임의로 넓히거나 좁히지 않는다.
 *   n일   n일차   n일 차   첫째 날/둘째 날…   Day n   DAY n
 * ──────────────────────────────────────────────────────────────── */
const ORDINAL_KO = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째',
  '여덟째', '아홉째', '열째', '열한째', '열두째', '열셋째', '열넷째', '열다섯째']

export const DAY_MARKERS: RegExp[] = [
  /\d+\s*일\s*차/,                              // n일차 · n일 차
  /\d+\s*일(?![\s]*차)/,                        // n일
  new RegExp(`(${ORDINAL_KO.join('|')})\\s*날`), // 첫째 날 …
  /\bDay\s*\d+/i,                               // Day n · DAY n
]

/** 일차 구분 표기가 하나라도 있는가. 하나도 없으면 임의 배분하지 않는다(§6.3). */
export function hasDayMarker(text: string): boolean {
  return DAY_MARKERS.some((re) => re.test(text))
}

/* ── 여행기간 (§6.2.1) ────────────────────────────────────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * `일수 = 종료일 − 시작일 + 1` (**양끝 포함**).
 * 달력 날짜 차이만 쓴다 — 시각·시간대를 개입시키지 않으므로
 * 서머타임·윤년에 영향받지 않는다. 저장하지 않고 필요할 때마다 계산한다.
 */
export function tripDays(start: string, end: string): number | null {
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return null
  const s = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10))
  const e = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10))
  if (Number.isNaN(s) || Number.isNaN(e)) return null
  return Math.round((e - s) / 86_400_000) + 1
}

/** `{시작일} ~ {종료일}` 한 문자열로 결합한다(§6.2.1). 물결표 앞뒤 공백 1칸. */
export function combineTripPeriod(start: string, end: string): string {
  return `${start} ~ ${end}`
}

/* ── 필드 규칙 (§7.1 표) ──────────────────────────────────────── */

interface Rule {
  path: string
  label: string
  min: number
  max: number
}

const REQUIRED_RULES: Rule[] = [
  { path: '행사정보.행사명', label: '행사정보 > 행사명', min: 2, max: 40 },
  { path: '행사정보.여행지', label: '행사정보 > 여행지', min: 2, max: 60 },
  { path: '행사정보.일정원문', label: '일정 > 일정 원문', min: 20, max: 2000 },
  { path: '숙박.숙소명', label: '숙박 > 숙소명', min: 2, max: 60 },
  { path: '숙박.객실타입', label: '숙박 > 객실타입', min: 1, max: 40 },
  { path: '숙박.위치', label: '숙박 > 위치', min: 1, max: 60 },
  { path: '상점.상점명', label: '상점 > 상점명', min: 1, max: 80 },
  { path: '상점.상점정보', label: '상점 > 상점정보', min: 1, max: 500 },
  { path: '식사.식사정보', label: '식사 > 식사정보', min: 1, max: 500 },
  // `가격.기타`는 필수 그룹이지만 0자를 허용한다(§7.1).
  { path: '가격.기타', label: '가격 > 기타', min: 0, max: 300 },
]

/** 아동 요금 미운영. `0`을 넣어 "0원"으로 표시되는 것을 방지한다(§6.1). */
export const CHILD_NOT_OFFERED = '해당 없음'

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  )
}

export type FieldErrors = Record<string, string>

/**
 * §7.1·§7.2 규칙으로 검증한다. 반환이 비어 있으면 통과다.
 *
 * 값 타입은 전부 문자열이다 — 숫자·불리언·`null`을 쓰지 않는다(§7.4).
 */
export function validateFormInput(input: unknown): FieldErrors {
  const errors: FieldErrors = {}
  if (!input || typeof input !== 'object') {
    return { _: '입력 형식이 올바르지 않습니다.' }
  }

  for (const r of REQUIRED_RULES) {
    const v = get(input, r.path)
    if (typeof v !== 'string') { errors[r.path] = `${r.label}이(가) 필요합니다.`; continue }
    const len = v.trim().length
    if (len < r.min) {
      errors[r.path] = r.min === 0
        ? `${r.label} 형식이 올바르지 않습니다.`
        : `${r.label}을(를) ${r.min}자 이상 입력해 주세요.`
    } else if (len > r.max) {
      errors[r.path] = `${r.label}은(는) ${r.max}자를 넘을 수 없습니다.`
    }
  }

  // 여행기간 — 시작일 ≤ 종료일, 1~15일 (§7.1·§6.2.1)
  const start = get(input, '행사정보.여행기간_시작')
  const end = get(input, '행사정보.여행기간_종료')
  if (typeof start !== 'string' || !DATE_RE.test(start)) {
    errors['행사정보.여행기간_시작'] = '여행 시작일을 선택해 주세요.'
  }
  if (typeof end !== 'string' || !DATE_RE.test(end)) {
    errors['행사정보.여행기간_종료'] = '여행 종료일을 선택해 주세요.'
  }
  if (typeof start === 'string' && typeof end === 'string'
      && DATE_RE.test(start) && DATE_RE.test(end)) {
    const days = tripDays(start, end)
    if (days === null || days < TRIP_DAYS_MIN) {
      errors['행사정보.여행기간_종료'] = '종료일은 시작일과 같거나 이후여야 합니다.'
    } else if (days > TRIP_DAYS_MAX) {
      errors['행사정보.여행기간_종료'] =
        `여행기간은 최대 ${TRIP_DAYS_MAX}일입니다. 현재 ${days}일입니다.`
    }
  }

  // 일정 원문 — 일차 구분 표기 필수 (§7.1). 없으면 임의 배분할 수 없다(§6.3).
  const itinerary = get(input, '행사정보.일정원문')
  if (typeof itinerary === 'string' && itinerary.trim().length >= 20
      && !hasDayMarker(itinerary)) {
    errors['행사정보.일정원문'] =
      "일차 구분을 넣어 주세요. '1일:', '2일차', 'Day 1', '첫째 날' 형식을 인식합니다."
  }

  // 가격 — 0 이상 정수를 `{숫자}원`으로 저장한다(§6.2). 단위는 `원` 하나로 고정이며
  // 콤마는 정규화 대상이므로 여기서 이미 제거된 형태여야 한다.
  // 검증기는 **저장될 형태**를 본다 — 서버는 자기가 쓰려는 값을 검사한다.
  const PRICE_RE = /^\d+원$/
  const adult = get(input, '가격.성인')
  if (typeof adult !== 'string' || !PRICE_RE.test(adult.trim())) {
    errors['가격.성인'] = '성인 요금을 숫자로 입력해 주세요.'
  }
  // 아동 요금 미운영은 `해당 없음`. `0`을 넣어 "0원"으로 표시되는 것을 막는다(§6.1).
  const child = get(input, '가격.아동')
  if (typeof child !== 'string'
      || (child.trim() !== CHILD_NOT_OFFERED && !PRICE_RE.test(child.trim()))) {
    errors['가격.아동'] = '아동 요금을 숫자로 입력하거나 미운영을 선택해 주세요.'
  }

  return errors
}

/**
 * 폼 값을 §7.4의 `form_input` 구조로 만든다.
 *
 * - 최상위 키 6개, 점 표기 중첩. 평면 키·밑줄 표기를 쓰지 않는다
 * - 값은 전부 문자열
 * - **미입력 선택 항목은 빈 문자열 `""`** — `추후 추가 예정` 채움은
 *   `confirmed_data`에서만 일어난다(§6.1·§7.4)
 * - 여행기간은 2필드로 저장. 결합은 `confirmed_data`에서만(§6.2.1)
 * - 금액은 `{숫자}원` 문자열로 저장한다(§6.2)
 */
export function buildFormInput(raw: Record<string, string>): FormInput {
  const s = (k: string) => (raw[k] ?? '').trim()
  const price = (k: string) => {
    const v = s(k)
    if (v === '' || v === CHILD_NOT_OFFERED) return v
    return `${v}원`
  }
  return {
    행사정보: {
      행사명: s('행사명'),
      여행지: s('여행지'),
      여행기간_시작: s('여행기간_시작'),
      여행기간_종료: s('여행기간_종료'),
      일정원문: s('일정원문'),
      타겟층: s('타겟층'),
      여행스타일: s('여행스타일'),
    },
    숙박: {
      숙소명: s('숙소명'), 객실타입: s('객실타입'),
      위치: s('위치'), 숙박일정: s('숙박일정'),
    },
    상점: { 상점명: s('상점명'), 상점정보: s('상점정보') },
    가격: { 성인: price('가격_성인'), 아동: price('가격_아동'), 기타: s('가격_기타') },
    식사: { 식사정보: s('식사정보') },
    항공편: {
      공항: s('항공편_공항'), 항공사: s('항공편_항공사'), 편명: s('항공편_편명'),
      출발시간: s('항공편_출발시간'), 도착시간: s('항공편_도착시간'),
    },
  }
}

/** 여행스타일 select 옵션 — 테마 키와 1:1 대응(§9.4). 표시 문자열이 그대로 저장된다. */
export const TRAVEL_STYLES = ['자연', '휴양', '도심', '미식', '액티비티', '문화·역사'] as const
