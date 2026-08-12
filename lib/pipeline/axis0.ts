/**
 * 0차 검증 (§11.1·§11.2) — `form_input` vs `confirmed_data`. **순수 모듈**.
 *
 * 기준값은 `form_input`이다. `confirmed_data`는 AI가 만든 파생물이므로 그것을
 * 기준으로 삼으면 정규화·분해 단계의 값 변형을 어느 축도 잡아내지 못한다.
 *
 * 기계 검사가 1차 필터다 — AI가 자기 생성물을 자기가 검사하는 구조에만
 * 의존하지 않는다(§6.3).
 */
import type { FormInput, ValidationItem } from '../types'
import {
  PLACEHOLDER, combineTripPeriod, normalizeDate, normalizeMoney, normalizeSpace,
  type ConfirmedData,
} from './normalize'

function item(
  검증영역: string, source경로: string | null,
  기준값: string, 발견값: string, 사유: string, 위치: string,
): ValidationItem {
  return { 검증영역, source경로, 기준값, 발견값, 사유, 위치 }
}

/**
 * 정규화 범위 검사 — 허용 3종(§6.2) + 결합 1종(§6.2.1) 외의 변형 0건.
 *
 * 각 필드에 대해 "허용된 변환을 `form_input`에 적용한 결과"와 실제
 * `confirmed_data` 값을 비교한다. 다르면 규칙 밖의 변형이 일어난 것이다.
 */
export function checkNormalization(fi: FormInput, cd: ConfirmedData): ValidationItem[] {
  const out: ValidationItem[] = []

  const expectSpace = (path: string, raw: string, got: string) => {
    const want = normalizeSpace(raw)
    if (got !== want) {
      out.push(item('정규화 범위', path, want, got,
        '공백 규칙 외의 변형이 적용됐습니다. 값을 다듬거나 요약할 수 없습니다.', `confirmed_data.${path}`))
    }
  }
  const expectFill = (path: string, raw: string, got: string) => {
    const want = normalizeSpace(raw) === '' ? PLACEHOLDER : normalizeSpace(raw)
    if (got !== want) {
      out.push(item('선택 항목', path, want, got,
        `미입력 선택 항목은 «${PLACEHOLDER}»으로만 채울 수 있습니다.`, `confirmed_data.${path}`))
    }
  }

  expectSpace('행사정보.행사명', fi.행사정보.행사명, cd.행사정보.행사명)
  expectSpace('행사정보.여행지', fi.행사정보.여행지, cd.행사정보.여행지)
  expectSpace('행사정보.일정원문', fi.행사정보.일정원문, cd.행사정보.일정원문)
  expectSpace('숙박.숙소명', fi.숙박.숙소명, cd.숙박.숙소명)
  expectSpace('숙박.객실타입', fi.숙박.객실타입, cd.숙박.객실타입)
  expectSpace('숙박.위치', fi.숙박.위치, cd.숙박.위치)
  expectSpace('상점.상점명', fi.상점.상점명, cd.상점.상점명)
  expectSpace('상점.상점정보', fi.상점.상점정보, cd.상점.상점정보)
  expectSpace('식사.식사정보', fi.식사.식사정보, cd.식사.식사정보)
  // `가격.기타`는 자유 서술 필드다 — 금액 규칙을 적용하지 않는다(§6.2)
  expectSpace('가격.기타', fi.가격.기타, cd.가격.기타)

  expectFill('행사정보.여행스타일', fi.행사정보.여행스타일, cd.행사정보.여행스타일)
  expectFill('행사정보.타겟층', fi.행사정보.타겟층, cd.행사정보.타겟층)
  expectFill('숙박.숙박일정', fi.숙박.숙박일정, cd.숙박.숙박일정)
  for (const k of ['공항', '항공사', '편명', '출발시간', '도착시간'] as const) {
    expectFill(`항공편.${k}`, fi.항공편[k], cd.항공편[k])
  }

  // 금액 — 콤마 제거만 허용. 계산·환산·단위 변경은 금지(§16.1)
  for (const k of ['성인', '아동'] as const) {
    const want = normalizeMoney(fi.가격[k])
    if (cd.가격[k] !== want) {
      out.push(item('정규화 범위', `가격.${k}`, want, cd.가격[k],
        '금액은 천 단위 콤마 제거만 허용됩니다. 계산·환산·단위 변경은 금지입니다.',
        `confirmed_data.가격.${k}`))
    }
  }

  // 여행기간 — form_input과 1:1로 대응하지 않는 **유일한** 지점(§6.2.1).
  // 0차는 이것을 위반으로 판정하지 않고, 결합 규칙대로 됐는지만 본다.
  const want = combineTripPeriod(
    normalizeDate(fi.행사정보.여행기간_시작), normalizeDate(fi.행사정보.여행기간_종료),
  )
  if (cd.행사정보.여행기간 !== want) {
    out.push(item('결합 규칙', '행사정보.여행기간', want, cd.행사정보.여행기간,
      '여행기간은 «{시작} ~ {종료}» 형식으로만 결합합니다(§6.2.1).',
      'confirmed_data.행사정보.여행기간'))
  }

  return out
}

/* ── 일차 분해 판정 3단계 (§6.3) ──────────────────────────────── */

/** 1단계 — `원문근거`가 `일정원문`의 부분 문자열인가. **기계**. */
export function checkEvidence(cd: ConfirmedData): ValidationItem[] {
  const out: ValidationItem[] = []
  const source = normalizeSpace(cd.행사정보.일정원문)

  for (const [i, d] of cd.행사정보.일정.entries()) {
    // 부족분 채움은 원문근거가 빈 문자열이다(§6.3). 위반이 아니다.
    if (d.원문근거 === '' && d.내용 === PLACEHOLDER) continue
    if (d.원문근거 === '') {
      out.push(item('일정 근거', '행사정보.일정', '(원문 발췌)', '(빈 값)',
        `${d.day}일차에 원문근거가 없습니다. 요약·재작성은 허용되지 않습니다.`,
        `confirmed_data.행사정보.일정[${i}].원문근거`))
      continue
    }
    if (!source.includes(normalizeSpace(d.원문근거))) {
      out.push(item('일정 근거', '행사정보.일정원문', '(일정원문의 부분 문자열)', d.원문근거,
        `${d.day}일차의 원문근거가 일정원문에 없습니다. 발췌가 아니라 재작성입니다.`,
        `confirmed_data.행사정보.일정[${i}].원문근거`))
    }
  }
  return out
}

/**
 * 2단계 — `내용`의 명사구 후보가 `원문근거` 또는 `confirmed_data`의 다른 값
 * 안에 존재하는가. **기계**. 미존재 후보를 위반 **후보**로 표시할 뿐,
 * 실제 위반 여부는 3단계에서 AI가 판정한다.
 */
export interface NounCandidate {
  day: string
  후보: string
  근거존재: boolean
}

/** 2자 이상 한글 명사구 · 영문 고유명사 · 숫자+단위 (§6.3). 조사·어미는 제외. */
const PARTICLES = /(은|는|이|가|을|를|에서|으로|로|와|과|의|에|도|만|부터|까지|께서)$/

export function extractNouns(text: string): string[] {
  const raw = text.match(/[가-힣]{2,}|[A-Za-z][A-Za-z0-9]{1,}|\d+[가-힣A-Za-z]+/g) ?? []
  return [...new Set(raw.map((t) => t.replace(PARTICLES, '')).filter((t) => t.length >= 2))]
}

export function checkNouns(cd: ConfirmedData): NounCandidate[] {
  // 후보가 원문근거에 없더라도 confirmed_data의 다른 값(숙소명·상점명·식사정보 등)에
  // 있으면 정상으로 본다(§6.3).
  const others = [
    cd.행사정보.행사명, cd.행사정보.여행지, cd.행사정보.일정원문,
    cd.숙박.숙소명, cd.숙박.객실타입, cd.숙박.위치,
    cd.상점.상점명, cd.상점.상점정보, cd.식사.식사정보, cd.가격.기타,
  ].join(' ')

  const out: NounCandidate[] = []
  for (const d of cd.행사정보.일정) {
    if (d.내용 === PLACEHOLDER) continue
    const haystack = `${d.원문근거} ${others}`
    for (const 후보 of extractNouns(d.내용)) {
      out.push({ day: d.day, 후보, 근거존재: haystack.includes(후보) })
    }
  }
  return out
}

/** 일차 수는 여행기간 일수와 **정확히 일치**해야 한다(§6.3·§11.2). */
export function checkDayCount(cd: ConfirmedData, tripDays: number): ValidationItem[] {
  const got = cd.행사정보.일정.length
  if (got === tripDays) return []
  return [item('일정 일치', '행사정보.일정', `${tripDays}일`, `${got}일`,
    `일차 수가 여행기간과 다릅니다. 초과·미달은 허용되지 않습니다.`,
    'confirmed_data.행사정보.일정')]
}

/**
 * 스킬 `axis0-verification` — 0차 기계 검증 **4종 집계**.
 *
 * 이전에는 이 조립이 `decompose` 라우트 안에 흩어져 있었다. 스킬로 올리면서
 * 명사구 판정의 허용 폭(2자 접두 일치)도 여기로 들어왔다 — 라우트에 두면
 * 그 폭이 규정 문서 어디에도 안 남는다.
 *
 * **AI를 쓰지 않는다.** 0차는 전부 기계 판정이다(§11.1) — AI가 자기 생성물을
 * 자기가 검사하는 구조에만 의존하지 않는다.
 *
 * 항목을 모아서 반환한다. 첫 위반에서 멈추지 않는다 — 기획자가 한 번에 다 보고
 * 고쳐야 한다. 0건이면 통과다. **재시도 여부는 판단하지 않는다**(규약 R7).
 */
export function verifyAxis0(
  fi: FormInput, cd: ConfirmedData, tripDays: number,
): ValidationItem[] {
  const items: ValidationItem[] = [
    ...checkNormalization(fi, cd),
    ...checkDayCount(cd, tripDays),
    ...checkEvidence(cd),
  ]

  /*
   * 명사구 후보 — 원문근거에도 다른 확정 값에도 없는 것은 창작이다(§6.3).
   *
   * ⚠️ **알려진 결함 — 이 검사는 현재 발동하지 않는다.**
   *
   * 두 번째 조건의 `haystack`이 `JSON.stringify(cd)`이고, 여기에는 검사 대상인
   * `일정[].내용`이 **포함된다.** 후보는 그 `내용`에서 뽑았으므로 후보의 앞 2자는
   * 항상 haystack에 있다 → 조건이 언제나 참 → 검사가 절대 실패를 내지 않는다.
   * 실측 확인: 「성산일출봉과 우도를 방문합니다」(«우도»는 입력에 없다) → 위반 0건.
   *
   * `checkNouns` 자체는 올바르다. 그쪽 haystack은 `원문근거 + others`이고
   * `others`에 `일정[].내용`이 없으므로 `근거존재`가 정확히 `false`로 나온다.
   * 2자 접두 허용은 복합어 분해를 감안한 것이므로 **`checkNouns`와 같은 출처**
   * (원문근거 + others)에 대해 적용해야 했다.
   *
   * **지금 고치지 않는 이유:** 검사를 살리면 0차가 실제 반려를 내기 시작한다.
   * 오탐률을 모르는 상태에서 데모(2026-08-14) 직전에 켜면 재시도 폭주나
   * `input_error`로 대본이 죽을 수 있다. 하네스 전환은 동작을 바꾸지 않는 작업이므로
   * 라우트에 있던 동작을 **그대로** 옮긴다. 고치기 전에 `probe:deepseek`으로
   * 실제 AI 출력에 대한 오탐률을 재야 한다.
   */
  const haystack = JSON.stringify(cd)
  for (const n of checkNouns(cd)) {
    if (n.근거존재 || haystack.includes(n.후보.slice(0, 2))) continue
    items.push(item(
      '입력 외 고유명사', '행사정보.일정',
      '(원문근거 또는 확정 데이터표의 값)', n.후보,
      `${n.day}일차 서술의 «${n.후보}»가 입력 어디에도 없습니다.`,
      `confirmed_data.행사정보.일정[${n.day}].내용`,
    ))
  }

  return items
}
