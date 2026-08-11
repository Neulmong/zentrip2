/**
 * 기획 메모 유출 검사 — 순수 모듈.
 *
 * ## 왜 필요한가
 *
 * `행사정보.기획메모`는 **고객에게 표시되지 않는 내부 메모**다. 페르소나처럼
 * 「누가 읽을 글인가」를 AI에게 알려 어조를 잡게 하는 재료이고, 사실정보가 아니다.
 *
 * 그런데 AI에게 텍스트를 주면 **그대로 옮겨 쓸 위험**이 늘 있다. 프롬프트로
 * 「인용하지 마라」고 지시했지만, 지시는 보증이 아니다. 실제로 새면
 *
 *   "29세와 31세 여성 두 분을 위한 여행입니다"
 *
 * 같은 문장이 고객 페이지에 박힌다. 기획자가 의도한 상품 설명이 아니고,
 * 개인정보에 가까운 서술이 공개된다.
 *
 * ## 무엇을 검사하나 — **숫자만** 본다
 *
 * 메모에만 있고 확정 데이터 어디에도 없는 **숫자 토큰**이 서술 필드에
 * 나타나면 유출로 본다. 숫자로 좁히는 이유:
 *
 *   · 나이·인원·개수처럼 **가장 새기 쉽고 해로운 값**이 숫자다
 *   · 숫자는 대조가 명확하다 — 「29」가 있거나 없다
 *   · 일반 단어까지 검사하면 오탐이 쏟아진다 ("휴식"·"제주"는 메모에도 있고
 *     정상 서술에도 있다)
 *
 * 즉 **완전한 검사가 아니다.** 서술체 유출("동기생 두 분이")은 못 잡는다.
 * 다만 가장 해로운 유형을 확실히 막고, 오탐으로 파이프라인을 죽이지 않는다.
 */

/** `[0-9]+` 연속 숫자 + 붙어 있는 단위 문자까지 한 토큰으로 본다(§6.3.1과 같은 방식). */
const UNITS = '일박회원명시분코스인개층년월주차식끼세'
const TOKEN_RE = new RegExp(`[0-9][0-9,]*\\s*[${UNITS}]*`, 'g')

const norm = (s: string) => s.replace(/,/g, '').replace(/\s+/g, '')

function numberTokens(text: string): string[] {
  return [...new Set((text.match(TOKEN_RE) ?? []).map((t) => t.trim()).filter(Boolean))]
}

export interface MemoLeak {
  /** 유출된 토큰 */
  토큰: string
  /** 나타난 자리 */
  위치: string
}

/**
 * 서술 필드에서 메모 유출을 찾는다.
 *
 * @param memo     `confirmed_data.행사정보.기획메모`
 * @param 확정값   메모를 **제외한** 확정 데이터 전체를 직렬화한 문자열.
 *                 여기 있는 숫자는 정상 출처이므로 유출이 아니다.
 * @param 서술필드 `[자리이름, 텍스트]` 목록 — `source`가 `"generated"`인 필드만 넣는다.
 */
export function findMemoLeaks(
  memo: string,
  확정값: string,
  서술필드: [string, string][],
): MemoLeak[] {
  const m = memo.trim()
  if (!m) return []

  // 메모에만 있는 숫자 — 확정 데이터에 있으면 정상 출처다.
  const haystack = norm(확정값)
  const 메모전용 = numberTokens(m).filter((t) => {
    const n = norm(t)
    return !haystack.includes(n) && !haystack.includes(n.replace(/[^0-9]/g, ''))
  })
  if (메모전용.length === 0) return []

  const leaks: MemoLeak[] = []
  for (const [위치, text] of 서술필드) {
    const 본문 = norm(text ?? '')
    for (const 토큰 of 메모전용) {
      if (본문.includes(norm(토큰))) leaks.push({ 토큰, 위치 })
    }
  }
  return leaks
}
