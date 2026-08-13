/**
 * 웹 폼 입력 검증 (§7.1·§7.2·§6.2.1) — **순수 모듈**.
 *
 * 프론트엔드와 서버가 **같은 규칙**을 쓴다. 서버는 프론트엔드 validation을
 * 신뢰하지 않고 동일 규칙으로 재검증하며, 위반 시 400을 반환하고
 * 파이프라인을 시작하지 않는다(§16.2).
 */
import {
  SHOP_KINDS, TRIP_DAYS_MAX, TRIP_DAYS_MIN,
  type FormInput, type Shop, type Stay,
} from './types'

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
  { path: '식사.식사정보', label: '식사 > 식사정보', min: 1, max: 500 },
  // `가격.기타`는 필수 그룹이지만 0자를 허용한다(§7.1).
  { path: '가격.기타', label: '가격 > 기타', min: 0, max: 300 },
]

/* ── 배열 행의 필드 규칙 (§7.1·§7.2) ─────────────────────────────
 * `숙박`·`상점`은 객체 배열이고 **1건 이상**이다(§7.4).
 *
 * 행마다 필수인 것은 **행을 식별하는 값**뿐이다. 객실타입·상점정보를 행마다
 * 요구하면 객실이 미확정인 숙소나 설명 없는 가게를 목록에서 빼야 하는데,
 * 목록에서 빠지는 것이 빈칸으로 남는 것보다 나쁘다 — 미입력 표기(§6.1)가
 * 이미 그 빈칸을 `추후 추가 예정`으로 처리하고 섹션도 삭제되지 않는다.
 * ──────────────────────────────────────────────────────────────── */

interface RowRule {
  field: string
  label: string
  min: number
  max: number
  /** 값 집합이 정해진 필드 — `상점.구분` 하나다(§6.1) */
  oneOf?: readonly string[]
}

export const STAY_RULES: readonly RowRule[] = [
  { field: '숙소명', label: '숙소명', min: 2, max: 60 },
  { field: '위치', label: '위치', min: 1, max: 60 },
  { field: '객실타입', label: '객실타입', min: 0, max: 40 },
  { field: '숙박일정', label: '숙박일정', min: 0, max: 40 },
]

export const SHOP_RULES: readonly RowRule[] = [
  { field: '상점명', label: '상점명', min: 1, max: 80 },
  { field: '구분', label: '구분', min: 1, max: 4, oneOf: SHOP_KINDS },
  { field: '위치', label: '위치', min: 0, max: 60 },
  { field: '상점정보', label: '상점정보', min: 0, max: 500 },
]

/**
 * 배열 그룹 1개를 검증한다. 오류 키는 **`source` 경로와 같은 표기**
 * (`숙박[0].숙소명`)이므로 폼이 그 키로 칸을 찾아 오류를 붙일 수 있다.
 */
function validateRows(
  input: unknown, key: '숙박' | '상점', groupLabel: string,
  rules: readonly RowRule[], errors: FieldErrors,
): void {
  const rows = get(input, key)
  if (!Array.isArray(rows) || rows.length === 0) {
    errors[key] = `${groupLabel}을(를) 최소 1건 입력해 주세요.`
    return
  }

  for (const [i, row] of rows.entries()) {
    const 앞 = `${groupLabel} ${i + 1}번째`
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors[`${key}[${i}]`] = `${앞} 행의 형식이 올바르지 않습니다.`
      continue
    }

    for (const r of rules) {
      const path = `${key}[${i}].${r.field}`
      const v = (row as Record<string, unknown>)[r.field]
      if (typeof v !== 'string') {
        errors[path] = `${앞} ${r.label}이(가) 필요합니다.`
        continue
      }
      const t = v.trim()
      if (r.oneOf && !r.oneOf.includes(t)) {
        errors[path] = `${앞} ${r.label}은(는) ${r.oneOf.join('·')} 중 하나여야 합니다.`
        continue
      }
      if (t.length < r.min) {
        errors[path] = r.min === 0
          ? `${앞} ${r.label} 형식이 올바르지 않습니다.`
          : `${앞} ${r.label}을(를) ${r.min}자 이상 입력해 주세요.`
      } else if (t.length > r.max) {
        errors[path] = `${앞} ${r.label}은(는) ${r.max}자를 넘을 수 없습니다.`
      }
    }
  }
}

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

  // 배열 그룹 — 1건 이상 + 행별 규칙 (§7.4)
  validateRows(input, '숙박', '숙박', STAY_RULES, errors)
  validateRows(input, '상점', '제휴상점', SHOP_RULES, errors)

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

  // 행사 기간 (선택 · 2026-08-13) — 둘 다 비면 통과, 한쪽만 채우면 짝을 요구,
  // 둘 다면 날짜 형식·순서를 검사한다. 여행기간과 같은 규칙이되 상한은 두지 않는다
  // (행사 자체 기간이며 여행 일수를 정하지 않는다).
  const es = get(input, '행사정보.행사기간_시작')
  const ee = get(input, '행사정보.행사기간_종료')
  const esStr = typeof es === 'string' ? es.trim() : ''
  const eeStr = typeof ee === 'string' ? ee.trim() : ''
  if (esStr !== '' || eeStr !== '') {
    if (!DATE_RE.test(esStr)) {
      errors['행사정보.행사기간_시작'] = '행사 시작일을 선택하거나 두 칸을 모두 비워 주세요.'
    }
    if (!DATE_RE.test(eeStr)) {
      errors['행사정보.행사기간_종료'] = '행사 종료일을 선택하거나 두 칸을 모두 비워 주세요.'
    }
    if (DATE_RE.test(esStr) && DATE_RE.test(eeStr)) {
      const d = tripDays(esStr, eeStr)
      if (d === null || d < TRIP_DAYS_MIN) {
        errors['행사정보.행사기간_종료'] = '행사 종료일은 시작일과 같거나 이후여야 합니다.'
      }
    }
  }

  // 일정 원문 — 일차 구분 표기 필수 (§7.1). 없으면 임의 배분할 수 없다(§6.3).
  const itinerary = get(input, '행사정보.일정원문')
  if (typeof itinerary === 'string' && itinerary.trim().length >= 20
      && !hasDayMarker(itinerary)) {
    errors['행사정보.일정원문'] =
      "일차 구분을 넣어 주세요. '1일:', '2일차', 'Day 1', '첫째 날' 형식을 인식합니다."
  }

  /*
   * 선택 항목의 상한 (§7.1).
   *
   * 미입력은 허용하므로 하한이 없다. 상한만 둔다 — 요약 섹션에 들어가는
   * `여행주제`가 길어지면 화면이 무너지고, `기획메모`는 AI 프롬프트에
   * 실리므로 요청 예산을 밀어낸다.
   */
  const OPTIONAL_MAX: [string, string, number][] = [
    ['행사정보.타겟층', '행사정보 > 타겟층', 100],
    ['행사정보.여행주제', '행사정보 > 여행주제', 200],
    ['행사정보.기획메모', '행사정보 > 기획 메모', 1000],
  ]
  for (const [path, label, max] of OPTIONAL_MAX) {
    const v = get(input, path)
    if (typeof v === 'string' && v.trim().length > max) {
      errors[path] = `${label}은(는) ${max}자를 넘을 수 없습니다.`
    }
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

/* ════════════════════════════════════════════════════════════════
 * 2.6 → 2.7 읽기 시점 이행 (§7.4)
 *
 * 2.6까지 저장된 `form_input`은 `숙박`·`상점`이 **단일 객체**다. 2.7의 코드는
 * 배열을 전제하므로 그 행을 그대로 파이프라인에 넣으면 `TypeError`가 나고
 * **500이 된다** — `normalizeFields`의 `fi.숙박.map(...)`에서 죽는다.
 *
 * DB를 일괄 변환하지 않고 **읽는 시점에 올린다.** 이유 두 가지:
 *   · 마이그레이션 스크립트는 한 번 돌리고 끝나지만, 그 시점 이후에 복원된
 *     백업·다른 환경의 행은 다시 옛 형태다. 읽기 시점 변환은 그 경우도 덮는다
 *   · 변환이 **무손실**이다 — 객체 하나를 1행 배열로 감싸는 것뿐이고,
 *     그 행이 다음 쓰기에서 새 형태로 저장되며 자연히 이행이 끝난다
 * ════════════════════════════════════════════════════════════════ */

/** 옛 형태(단일 객체)를 1행 배열로 감싼다. 이미 배열이면 그대로 둔다 */
function asRows(v: unknown, fields: readonly string[], 기본값: Record<string, string> = {}):
Record<string, string>[] {
  if (Array.isArray(v)) return v as Record<string, string>[]
  if (!v || typeof v !== 'object') return []
  const src = v as Record<string, unknown>
  const row: Record<string, string> = { ...기본값 }
  for (const f of fields) {
    const x = src[f]
    if (typeof x === 'string') row[f] = x
    else if (!(f in row)) row[f] = ''
  }
  return [row]
}

/**
 * 저장된 `form_input`을 2.7 구조로 맞춘다. **값을 고치지 않는다.**
 *
 * 이미 2.7 형태면 같은 객체를 그대로 반환한다 — 새 행에서는 비용이 0이다.
 */
export function coerceFormInput<T>(fi: T): T {
  if (!fi || typeof fi !== 'object') return fi
  const bag = fi as unknown as Record<string, unknown>
  if (Array.isArray(bag.숙박) && Array.isArray(bag.상점)) return fi

  return {
    ...bag,
    숙박: asRows(bag.숙박, ['숙소명', '위치', '객실타입', '숙박일정']),
    // 옛 형태에는 `구분`이 없다. 사람이 고르지 않은 값이므로 기본값을 넣는다(§6.1)
    상점: asRows(bag.상점, ['상점명', '위치', '상점정보'], { 구분: SHOP_KINDS[0] }),
  } as unknown as T
}

/**
 * 배열 그룹의 행을 폼 필드에서 모은다.
 *
 * 폼 필드 이름이 **`source` 경로와 같은 표기**(`숙박[0].숙소명`)다. 벌을 하나로
 * 두면 검증 오류 키·폼 필드 이름·`source` 경로가 자동으로 일치하고, 화면이
 * 오류를 붙일 칸을 찾는 변환 표가 필요 없어진다.
 *
 * **인덱스를 0부터 다시 채운다.** 화면에서 가운데 행을 지우면 `숙박[0]`·`숙박[2]`가
 * 올 수 있는데, 그대로 두면 배열에 구멍이 생기거나 순서가 흔들린다 — §7.4가
 * 순서 보존을 요구하므로 **번호순으로 정렬해 다시 채운다.**
 *
 * 전부 빈 행은 버린다. 사람이 [행 추가]를 누르고 채우지 않은 경우이며, 남기면
 * 필수 검사가 그 행에서 실패해 「지우지도 않은 칸」을 지적하게 된다.
 */
function collectRows<T>(
  raw: Record<string, string>, key: '숙박' | '상점', fields: readonly (keyof T)[],
): T[] {
  const re = new RegExp(`^${key}\\[(\\d+)\\]\\.(.+)$`)
  const 번호 = new Set<number>()
  for (const k of Object.keys(raw)) {
    const m = re.exec(k)
    if (m) 번호.add(Number(m[1]))
  }

  const rows: T[] = []
  for (const i of [...번호].sort((a, b) => a - b)) {
    const row = {} as Record<string, string>
    for (const f of fields) row[String(f)] = (raw[`${key}[${i}].${String(f)}`] ?? '').trim()
    if (Object.values(row).every((v) => v === '')) continue
    rows.push(row as T)
  }
  return rows
}

const STAY_FIELDS = ['숙소명', '위치', '객실타입', '숙박일정'] as const
const SHOP_FIELDS = ['상점명', '구분', '위치', '상점정보'] as const

/** `상점.구분`의 기본값. 폼 select가 이 값으로 시작하므로 빈 값이 없다(§6.1) */
export const SHOP_KIND_DEFAULT: string = SHOP_KINDS[0]

/**
 * 폼 값을 §7.4의 `form_input` 구조로 만든다.
 *
 * - 최상위 키 6개, 점 표기 중첩. 평면 키·밑줄 표기를 쓰지 않는다
 * - 값은 전부 문자열. `숙박`·`상점`은 객체 배열이며 원소 값도 전부 문자열
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
      행사기간_시작: s('행사기간_시작'),
      행사기간_종료: s('행사기간_종료'),
      여행기간_시작: s('여행기간_시작'),
      여행기간_종료: s('여행기간_종료'),
      일정원문: s('일정원문'),
      타겟층: s('타겟층'),
      여행스타일: s('여행스타일'),
      여행주제: s('여행주제'),
      기획메모: s('기획메모'),
    },
    숙박: collectRows<Stay>(raw, '숙박', STAY_FIELDS),
    상점: collectRows<Shop>(raw, '상점', SHOP_FIELDS).map((sh) => ({
      // select가 항상 값을 보내지만, 우회 호출로 비어 오면 기본값을 쓴다.
      // `제휴`로 올리는 일은 하지 않는다 — 없는 제휴 관계를 만드는 것이다(§6.1).
      ...sh, 구분: sh.구분 || SHOP_KIND_DEFAULT,
    })),
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
