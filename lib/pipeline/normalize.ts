/**
 * §6.1·§6.2·§6.2.1 — `form_input` → `confirmed_data` 변환. **순수 모듈**.
 *
 * 허용 변환은 **정규화 3종 + 결합 1종**뿐이고, 그 외의 값 변형은 0차 검증에서
 * 실패다. 이 파일이 그 4종의 단일 구현이다.
 */
import type { FormInput, Shop, Stay } from '../types'

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
  /**
   * AI가 `내용`에 쓴 **장소·시설·활동·고유명사** (spec §6.3 판정 3단계).
   *
   * AI가 스스로 신고하고 **기계가 근거를 대조한다.** 신고한 표현이 `원문근거`
   * 에도 다른 확정 값에도 없으면 창작이므로 0차 실패다. 판정 주체가 AI가 아니라
   * 기계이므로 「AI가 자기 생성물을 자기가 검사하는」 구조가 아니다.
   *
   * 옛 산출물에는 없을 수 있어 optional이다 — 없으면 검사를 건너뛴다.
   */
  핵심표현?: string[]
}

export interface ConfirmedData {
  행사정보: {
    행사명: string; 여행지: string; 여행기간: string
    일정원문: string; 일정: DayEntry[]
    여행스타일: string; 타겟층: string
    /** 값 필드 — 화면에 표시되므로 미입력 시 `추후 추가 예정`으로 채운다 */
    여행주제: string
    /**
     * 참고 필드 — 고객에게 표시되지 않는다. **채우지 않는다.**
     * 미입력이면 빈 문자열로 남고, 그때는 AI 프롬프트에도 싣지 않는다.
     */
    기획메모: string
  }
  /** 객체 배열 · 1건 이상. `form_input`의 순서를 그대로 승계한다(§7.4) */
  숙박: Stay[]
  /** 객체 배열 · 1건 이상 */
  상점: Shop[]
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

function space(v: string, changes: NormalizeChange[], path: string): string {
  const out = normalizeSpace(v)
  if (out !== v) changes.push({ 경로: path, 원본값: v, 정규화값: out, 적용규칙: '공백' })
  return out
}

/* ════════════════════════════════════════════════════════════════
 * 스킬 경계 (하네스 규약 R2 — 스킬은 단일 기능)
 *
 *   optional-field-fill  →  fillOptional      선택 항목 채움만
 *   data-normalization   →  normalizeFields   정규화 3종 + 결합 1종만
 *
 * `buildConfirmedData`는 둘을 이어 붙인 것으로 남긴다 — 기존 호출부와
 * `test:policy`가 그대로 동작해야 하고, 두 스킬을 한 번에 쓰는 자리도 있다.
 * ════════════════════════════════════════════════════════════════ */

/**
 * 채움 대상 — **화면에 표시되는 선택 필드 9개**.
 *
 * `행사정보.기획메모`가 여기 없는 것이 핵심이다. 그 필드는 고객에게 표시되지 않는
 * 참고 자료이므로 미입력이면 빈 문자열로 남고, 그때는 AI 프롬프트에도 싣지 않는다.
 * `추후 추가 예정`으로 채우면 AI가 그 문자열을 어조 참고 자료로 읽는다.
 */
export const FILL_FIELDS = [
  '행사정보.여행스타일', '행사정보.타겟층', '행사정보.여행주제',
  '항공편.공항', '항공편.항공사', '항공편.편명', '항공편.출발시간', '항공편.도착시간',
] as const

/**
 * 배열 행의 채움 대상 (§7.2).
 *
 * 행 수가 가변이라 정적 경로 목록으로 적을 수 없다 — 행마다 순회해 경로를
 * `숙박[0].객실타입`으로 만든다. `상점.구분`은 여기 없다: select 기본값이
 * `추천`이라 미입력 상태가 존재하지 않으므로 채울 것이 없다(§6.1).
 */
export const FILL_ROW_FIELDS = {
  숙박: ['객실타입', '숙박일정'],
  상점: ['위치', '상점정보'],
} as const

type Bag = Record<string, Record<string, string>>

/**
 * 스킬 `optional-field-fill` — 선택 항목 미입력을 `추후 추가 예정`으로 채운다.
 *
 * 이것만 한다. 정규화하지 않고(그건 `normalizeFields`), 관문 검사도 하지 않는다
 * (그건 `input-guard`, 라우트 ①). 값이 있으면 손대지 않으므로 반환값의 키 집합은
 * 입력과 항상 같다.
 *
 * 공백만 있는 문자열도 미입력으로 본다 — `"  "`가 화면에 빈칸으로 보이기 때문이다.
 * 단 **채울 때만** 공백을 판정에 쓰고, 값이 있으면 원본을 그대로 넘긴다.
 */
export function fillOptional(
  fi: FormInput,
): { filled: FormInput; changes: NormalizeChange[]; 채운경로: string[] } {
  const filled = structuredClone(fi)
  const changes: NormalizeChange[] = []
  const 채운경로: string[] = []

  for (const path of FILL_FIELDS) {
    const [key, sub] = path.split('.')
    const bag = (filled as unknown as Bag)[key]
    if (normalizeSpace(bag[sub] ?? '') !== '') continue
    bag[sub] = PLACEHOLDER
    changes.push({ 경로: path, 원본값: '', 정규화값: PLACEHOLDER, 적용규칙: '채움' })
    채운경로.push(path)
  }

  // 배열 행 — 경로에 인덱스를 붙인다(§7.4). 행 수가 가변이므로 순회한다
  for (const [key, fields] of Object.entries(FILL_ROW_FIELDS)) {
    const rows = (filled as unknown as Record<string, Record<string, string>[]>)[key] ?? []
    for (const [i, row] of rows.entries()) {
      for (const sub of fields) {
        if (normalizeSpace(row[sub] ?? '') !== '') continue
        row[sub] = PLACEHOLDER
        const path = `${key}[${i}].${sub}`
        changes.push({ 경로: path, 원본값: '', 정규화값: PLACEHOLDER, 적용규칙: '채움' })
        채운경로.push(path)
      }
    }
  }

  return { filled, changes, 채운경로 }
}

/**
 * 스킬 `data-normalization` — 정규화 3종(날짜·금액 콤마·공백) + 결합 1종.
 *
 * 채움은 이미 끝났다고 가정한다. 일정 배열은 AI 분해 결과를 나중에 넣으므로
 * 여기서는 빈 배열로 둔다.
 */
export function normalizeFields(
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
        여행스타일: space(fi.행사정보.여행스타일, changes, '행사정보.여행스타일'),
        타겟층: space(fi.행사정보.타겟층, changes, '행사정보.타겟층'),
        여행주제: space(fi.행사정보.여행주제, changes, '행사정보.여행주제'),
        // 채우지 않는다 — 고객에게 보이지 않는 필드다(§6.1의 채움 목적 밖).
        기획메모: space(fi.행사정보.기획메모, changes, '행사정보.기획메모'),
      },
      /*
       * 배열 원소의 문자열 필드도 공백 규칙의 대상이다(§6.2). 배열이라고
       * 건너뛰면 원소 안의 표기만 정규화되지 않아 0차가 「정규화 누락」을 잡는다.
       * 행 순서는 그대로 승계한다 — 순서가 값의 일부다(§7.4).
       */
      숙박: fi.숙박.map((st, i) => ({
        숙소명: space(st.숙소명, changes, `숙박[${i}].숙소명`),
        위치: space(st.위치, changes, `숙박[${i}].위치`),
        객실타입: space(st.객실타입, changes, `숙박[${i}].객실타입`),
        숙박일정: space(st.숙박일정, changes, `숙박[${i}].숙박일정`),
      })),
      상점: fi.상점.map((sh, i) => ({
        상점명: space(sh.상점명, changes, `상점[${i}].상점명`),
        구분: space(sh.구분, changes, `상점[${i}].구분`),
        위치: space(sh.위치, changes, `상점[${i}].위치`),
        // 자유 서술 필드 — 공백 규칙만 적용한다(§6.2)
        상점정보: space(sh.상점정보, changes, `상점[${i}].상점정보`),
      })),
      가격: {
        성인: money(fi.가격.성인, MONEY_FIELDS[0]),
        아동: money(fi.가격.아동, MONEY_FIELDS[1]),
        // 자유 서술 필드 — 금액 규칙을 적용하지 않는다(§6.2)
        기타: space(fi.가격.기타, changes, '가격.기타'),
      },
      식사: { 식사정보: space(fi.식사.식사정보, changes, '식사.식사정보') },
      항공편: {
        공항: space(fi.항공편.공항, changes, '항공편.공항'),
        항공사: space(fi.항공편.항공사, changes, '항공편.항공사'),
        편명: space(fi.항공편.편명, changes, '항공편.편명'),
        출발시간: space(fi.항공편.출발시간, changes, '항공편.출발시간'),
        도착시간: space(fi.항공편.도착시간, changes, '항공편.도착시간'),
      },
    },
  }
}

/**
 * 두 스킬을 이어 붙인 것. **채움 → 정규화** 순서다.
 *
 * 순서를 뒤집으면 안 된다 — 정규화를 먼저 하면 `"  "`가 `""`가 되어 채움 대상
 * 판정이 달라지고, 채움으로 넣은 `추후 추가 예정`이 금액·날짜 규칙을 타게 된다.
 *
 * 하네스에서는 `decompose` 체인의 1·2번 스킬이 이 순서를 그대로 밟는다.
 * 이 함수는 두 스킬을 한 번에 쓰는 자리(테스트·기존 호출부)를 위해 남긴다.
 */
export function buildConfirmedData(
  fi: FormInput,
): { data: ConfirmedData; changes: NormalizeChange[]; 채운경로: string[] } {
  const a = fillOptional(fi)
  const b = normalizeFields(a.filled)
  return { data: b.data, changes: [...a.changes, ...b.changes], 채운경로: a.채운경로 }
}
