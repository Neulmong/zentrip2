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

/**
 * 근거로 인정하는 「다른 확정 값」 (§6.3).
 *
 * 후보가 `원문근거`에 없더라도 여기 있으면 정상이다 — 숙소명·상점명·식사정보는
 * 일정 원문에 안 적혀 있어도 일정 서술에 등장하는 것이 자연스럽다.
 */
export function otherValues(cd: ConfirmedData): string {
  return [
    cd.행사정보.행사명, cd.행사정보.여행지, cd.행사정보.일정원문,
    cd.숙박.숙소명, cd.숙박.객실타입, cd.숙박.위치,
    cd.상점.상점명, cd.상점.상점정보, cd.식사.식사정보, cd.가격.기타,
  ].join(' ')
}

export function checkNouns(cd: ConfirmedData): NounCandidate[] {
  const others = otherValues(cd)

  const out: NounCandidate[] = []
  for (const d of cd.행사정보.일정) {
    if (d.내용 === PLACEHOLDER) continue
    const haystack = `${d.원문근거} ${others}`
    for (const 후보 of extractNouns(d.내용)) {
      out.push({ day: d.day, 후보, 근거존재: hasEvidence(후보, haystack) })
    }
  }
  return out
}

/**
 * 후보에 근거가 있는가. **haystack은 `원문근거 + others`여야 한다** —
 * 검사 대상인 `일정[].내용`을 넣으면 후보가 거기서 왔으므로 항상 참이 되어
 * 검사가 죽는다(이전 결함).
 *
 * `NOUN_PREFIX_LEN`자 접두 일치까지 근거로 인정한다. 복합어 분해 때문에 필요하다 —
 * 원문근거가 «올레 7코스»인데 AI가 «올레길»이라 쓰면 완전 일치로는 창작으로 잡힌다.
 * 접두 2자(«올레»)가 근거에 있으면 통과시킨다.
 *
 * 값을 키우면 창작이 통과하고, 줄이면 정상 서술이 반려된다. **실측으로 정한다.**
 */
export const NOUN_PREFIX_LEN = 2

function hasEvidence(후보: string, haystack: string): boolean {
  if (haystack.includes(후보)) return true
  return 후보.length > NOUN_PREFIX_LEN && haystack.includes(후보.slice(0, NOUN_PREFIX_LEN))
}

/**
 * 3단계 (§6.3) — **AI가 신고한 핵심표현에 근거가 있는가.**
 *
 * spec §6.3은 3단계를 「2에서 표시된 후보가 실제 위반인지 AI가
 * (`itinerary-decomposition`의 호출 1회 안에서) 판정」으로 규정한다. 그런데 2단계는
 * AI 출력(`내용`)에 대해 도는 검사라 **호출 전에는 후보가 존재하지 않는다.**
 * 한 호출 안에서 성립시키는 방법은 하나뿐이다: AI가 **미리 신고**하게 한다.
 *
 * 그래서 역할을 이렇게 나눴다.
 *
 * | 주체 | 하는 일 |
 * |---|---|
 * | AI | `내용`에 쓴 장소·시설·활동·고유명사를 `핵심표현`으로 신고 |
 * | **기계** | 신고된 표현이 `원문근거` 또는 다른 확정 값에 있는지 대조 → **판정** |
 *
 * **판정 주체가 기계다.** AI는 근거를 제시할 뿐이고 통과 여부를 정하지 않으므로
 * 「AI가 자기 생성물을 자기가 검사하는」 구조가 아니다(§6.3 마지막 문단).
 *
 * 2단계의 `위반후보`는 계속 **표시만** 한다 — `extractNouns`가 동사 활용형을
 * 명사구로 오인하므로 하드 실패로 쓰면 정상 산출물이 반려된다. 신고 목록은
 * AI가 고른 것이라 그 오인이 없다. **그것이 3단계를 실패로 쓸 수 있는 이유다.**
 */
export function checkDeclaredTerms(cd: ConfirmedData): ValidationItem[] {
  const out: ValidationItem[] = []
  const others = otherValues(cd)

  for (const [i, d] of cd.행사정보.일정.entries()) {
    if (d.내용 === PLACEHOLDER) continue
    // 옛 산출물 호환 — 신고가 없으면 검사할 것이 없다
    if (!Array.isArray(d.핵심표현)) continue

    const haystack = `${d.원문근거} ${others}`
    for (const 표현 of d.핵심표현) {
      const t = normalizeSpace(표현)
      if (!t) continue
      if (hasEvidence(t, haystack)) continue
      out.push(item('일정 근거', '행사정보.일정', '(원문근거 또는 확정 값)', t,
        `${d.day}일차의 «${t}»이(가) 원문에도 확정 데이터에도 없습니다. `
        + '입력에 없는 장소·시설·활동을 만들 수 없습니다.',
        `confirmed_data.행사정보.일정[${i}].내용`))
    }
  }
  return out
}

/**
 * `day`는 **숫자만 담은 문자열**이고 순서대로 1부터다 (§6.1).
 *
 * ## 왜 검사가 필요한가 — 실측으로 드러난 결함
 *
 * SKILL.md 산문은 「`day`는 문자열로 저장한다(`"1"`)」로 규정했지만 **실행되는
 * 프롬프트 펜스에는 그 규칙이 없었다.** 그래서 AI가 `"1일"`을 반환했고 아무도
 * 잡지 못했다.
 *
 * 조용히 넘어가지 않는다. `buildPage`가 일차별 이미지 슬롯을
 * `itinerary_day_${day}`로 만드는데, 업로드된 슬롯 이름은 `itinerary_day_1`이다.
 * `day`가 `"1일"`이면 `itinerary_day_1일`을 찾게 되어 **일차별 사진이 페이지에
 * 붙지 않는다.** 값이 비는 것이 아니라 화면에서 사진이 사라진다.
 *
 * ## 왜 고쳐 쓰지 않고 실패로 두는가
 *
 * `day`는 위치로 완전히 결정되므로 기계가 덮어쓸 수도 있다. 그러나 덮어쓰면
 * **AI가 규칙을 어긴 사실이 사라진다** — 같은 어긋남이 `내용`·`원문근거`에서
 * 일어나고 있어도 알 수 없게 된다. §11.6 재시도 경로가 이런 상황을 위해 있다.
 */
export function checkDayNumbers(cd: ConfirmedData): ValidationItem[] {
  const out: ValidationItem[] = []
  for (const [i, d] of cd.행사정보.일정.entries()) {
    const want = String(i + 1)
    if (d.day === want) continue
    out.push(item('일차 번호', '행사정보.일정', want, d.day,
      `${i + 1}번째 일차의 day가 «${d.day}»입니다. `
      + '숫자만 담은 문자열이어야 하며 단위를 붙일 수 없습니다(§6.1). '
      + '이미지 슬롯 이름이 어긋나 일차별 사진이 표시되지 않습니다.',
      `confirmed_data.행사정보.일정[${i}].day`))
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
export interface Axis0Result {
  /** 기계가 **확정한** 위반. 0차 실패 판정의 근거다 */
  items: ValidationItem[]
  /**
   * §6.3 판정 2단계의 「위반 후보로 **표시**」.
   *
   * **실패로 세지 않는다.** 3단계(AI가 조사·어미 변화 등 정상 변형을 제외하고
   * 실제 위반인지 판정)가 아직 구현되지 않았다. 로그에 남겨 추적만 한다.
   */
  위반후보: NounCandidate[]
}

export function verifyAxis0(
  fi: FormInput, cd: ConfirmedData, tripDays: number,
): Axis0Result {
  const items: ValidationItem[] = [
    ...checkNormalization(fi, cd),
    ...checkDayCount(cd, tripDays),
    // `day`가 «1일» 같은 값이면 이미지 슬롯 이름이 어긋난다 (§6.1)
    ...checkDayNumbers(cd),
    ...checkEvidence(cd),
    // 3단계 — AI가 신고한 핵심표현을 **기계가** 대조한다 (§6.3)
    ...checkDeclaredTerms(cd),
  ]

  /*
   * 명사구 후보 (§6.3 판정 2단계) — **표시만 한다. 실패로 만들지 않는다.**
   *
   * spec §6.3의 3단계 표가 주체를 이렇게 나눈다:
   *   2단계 기계 — 후보 추출 + 포함 검사. 미존재 후보는 「위반 후보로 표시」
   *   3단계 AI   — 표시된 후보가 실제 위반인지, **조사·어미 변화 등 정상 변형을 제외하고** 판정
   *
   * 어미 변화를 걸러내는 일이 3단계(AI)에 배정되어 있다는 것이 핵심이다.
   * 2단계를 하드 실패로 쓰면 그 판정을 기계가 대신하게 되는데, `extractNouns`는
   * `[가-힣]{2,}`로 모든 한국어 토큰을 잡고 `PARTICLES`는 조사만 벗기므로
   * **동사 활용형을 명사구로 오인한다.**
   *
   * 실측(정상 서술 4일차분): 후보 25개 중 8개가 무근거로 표시되고, 그 8개가
   * «걷습니다» «숙박하십니다» «보내시며» «이용하실» «있습니다» «마치고» 같은
   * 활용형과 «지역» «일정» 같은 일반명사였다. 하드 실패로 쓰면 정상 산출물이
   * 매번 반려된다.
   *
   * 이전 라우트 코드는 `JSON.stringify(cd)`를 haystack으로 써서 후보가 항상
   * 발견되게 만들어 놓았고(검사 대상인 `일정[].내용`이 그 문자열에 포함된다),
   * 결과적으로 하드 실패가 나지 않았다 — **틀린 방법으로 맞는 결과**를 내고 있었다.
   * 그 우연을 spec대로 된 구조로 바꾼다.
   *
   * 창작이 여기서 안 잡혀도 1·2차 검증(`fact-check`)이 「입력에 없는 지명·시설·
   * 경유지·관광지 등장」을 실패로 잡는다. 0차의 이 항목은 유일한 방어선이 아니다.
   */
  return { items, 위반후보: checkNouns(cd).filter((n) => !n.근거존재) }
}
