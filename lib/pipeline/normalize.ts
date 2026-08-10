/**
 * §6.1·§6.2·§6.2.1 — `form_input` → `confirmed_data` 변환. **순수 모듈**.
 *
 * 허용 변환은 **정규화 3종 + 결합 1종**뿐이고, 그 외의 값 변형은 0차 검증에서
 * 실패다. 이 파일이 그 4종의 단일 구현이다.
 */
import type { FormInput } from '../types'

export const PLACEHOLDER = '추후 추가 예정'

/* ── 적용 대상 한정 (§6.2) ────────────────────────────────────────
 * 규칙마다 대상 필드가 다르다. 이 구분이 없으면 자유 서술 필드의 문장이
 * 정규화 대상이 되어 §16.1을 위반한다 — `일정원문`·`상점정보`·`식사정보`·
 * `가격.기타` 안에 날짜나 금액처럼 보이는 문자열이 있어도 손대지 않는다.
 * ──────────────────────────────────────────────────────────────── */
export const DATE_FIELDS = ['행사정보.여행기간_시작', '행사정보.여행기간_종료'] as const
export const MONEY_FIELDS = ['가격.성인', '가격.아동'] as const

/** 공백 규칙은 **모든 문자열 필드**에 적용한다. 앞뒤 제거 + 내부 연속 공백 1칸 축약. */
export function normalizeSpace(v: string): string {
  return v.trim().replace(/\s+/g, ' ')
}

/** 날짜 — `YYYY-MM-DD`로 통일. 이미 그 형식이면 그대로 둔다. */
export function normalizeDate(v: string): string {
  const m = normalizeSpace(v).match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)
  if (!m) return normalizeSpace(v)
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/**
 * 금액 — **천 단위 콤마를 제거**하고 숫자와 단위만 남긴다.
 * 단위는 `원` 하나로 고정이며 환산·계산하지 않는다(§6.2).
 * `해당 없음`은 단위 규칙의 대상이 아니다(§6.1).
 */
export function normalizeMoney(v: string): string {
  const s = normalizeSpace(v)
  if (s === PLACEHOLDER || s === '해당 없음') return s
  return s.replace(/,/g, '')
}

/** §6.2.1 — 유일한 구조 변환. 물결표 앞뒤 공백 1칸. */
export function combineTripPeriod(start: string, end: string): string {
  return `${start} ~ ${end}`
}

export interface DayEntry {
  day: string
  원문근거: string
  내용: string
}

export interface ConfirmedData {
  행사정보: {
    행사명: string; 여행지: string; 여행기간: string
    일정원문: string; 일정: DayEntry[]
    여행스타일: string; 타겟층: string
  }
  숙박: { 숙소명: string; 객실타입: string; 위치: string; 숙박일정: string }
  상점: { 상점명: string; 상점정보: string }
  가격: { 성인: string; 아동: string; 기타: string }
  식사: { 식사정보: string }
  항공편: { 공항: string; 항공사: string; 편명: string; 출발시간: string; 도착시간: string }
}

export interface NormalizeChange {
  경로: string
  원본값: string
  정규화값: string
  적용규칙: '날짜' | '금액' | '공백' | '결합' | '채움'
}

/** 선택 항목 미입력을 `추후 추가 예정`으로 채운다(§6.1). 값 생성이 아니라 표기다. */
function fill(v: string, changes: NormalizeChange[], path: string): string {
  const s = normalizeSpace(v)
  if (s !== '') return s
  changes.push({ 경로: path, 원본값: '', 정규화값: PLACEHOLDER, 적용규칙: '채움' })
  return PLACEHOLDER
}

function space(v: string, changes: NormalizeChange[], path: string): string {
  const out = normalizeSpace(v)
  if (out !== v) changes.push({ 경로: path, 원본값: v, 정규화값: out, 적용규칙: '공백' })
  return out
}

/**
 * `confirmed_data`를 만든다. 일정 배열은 AI 분해 결과를 나중에 넣으므로
 * 여기서는 빈 배열로 둔다.
 */
export function buildConfirmedData(
  fi: FormInput,
): { data: ConfirmedData; changes: NormalizeChange[] } {
  const changes: NormalizeChange[] = []

  const start = normalizeDate(fi.행사정보.여행기간_시작)
  const end = normalizeDate(fi.행사정보.여행기간_종료)
  if (start !== fi.행사정보.여행기간_시작) {
    changes.push({ 경로: DATE_FIELDS[0], 원본값: fi.행사정보.여행기간_시작, 정규화값: start, 적용규칙: '날짜' })
  }
  if (end !== fi.행사정보.여행기간_종료) {
    changes.push({ 경로: DATE_FIELDS[1], 원본값: fi.행사정보.여행기간_종료, 정규화값: end, 적용규칙: '날짜' })
  }

  const 여행기간 = combineTripPeriod(start, end)
  changes.push({
    경로: '행사정보.여행기간',
    원본값: `${fi.행사정보.여행기간_시작} + ${fi.행사정보.여행기간_종료}`,
    정규화값: 여행기간, 적용규칙: '결합',
  })

  const money = (v: string, path: string) => {
    const out = normalizeMoney(v)
    if (out !== v) changes.push({ 경로: path, 원본값: v, 정규화값: out, 적용규칙: '금액' })
    return out
  }

  return {
    changes,
    data: {
      행사정보: {
        행사명: space(fi.행사정보.행사명, changes, '행사정보.행사명'),
        여행지: space(fi.행사정보.여행지, changes, '행사정보.여행지'),
        여행기간,
        // 자유 서술 필드 — 공백 규칙만 적용한다(§6.2)
        일정원문: space(fi.행사정보.일정원문, changes, '행사정보.일정원문'),
        일정: [],
        여행스타일: fill(fi.행사정보.여행스타일, changes, '행사정보.여행스타일'),
        타겟층: fill(fi.행사정보.타겟층, changes, '행사정보.타겟층'),
      },
      숙박: {
        숙소명: space(fi.숙박.숙소명, changes, '숙박.숙소명'),
        객실타입: space(fi.숙박.객실타입, changes, '숙박.객실타입'),
        위치: space(fi.숙박.위치, changes, '숙박.위치'),
        숙박일정: fill(fi.숙박.숙박일정, changes, '숙박.숙박일정'),
      },
      상점: {
        상점명: space(fi.상점.상점명, changes, '상점.상점명'),
        상점정보: space(fi.상점.상점정보, changes, '상점.상점정보'),
      },
      가격: {
        성인: money(fi.가격.성인, MONEY_FIELDS[0]),
        아동: money(fi.가격.아동, MONEY_FIELDS[1]),
        // 자유 서술 필드 — 금액 규칙을 적용하지 않는다(§6.2)
        기타: space(fi.가격.기타, changes, '가격.기타'),
      },
      식사: { 식사정보: space(fi.식사.식사정보, changes, '식사.식사정보') },
      항공편: {
        공항: fill(fi.항공편.공항, changes, '항공편.공항'),
        항공사: fill(fi.항공편.항공사, changes, '항공편.항공사'),
        편명: fill(fi.항공편.편명, changes, '항공편.편명'),
        출발시간: fill(fi.항공편.출발시간, changes, '항공편.출발시간'),
        도착시간: fill(fi.항공편.도착시간, changes, '항공편.도착시간'),
      },
    },
  }
}
