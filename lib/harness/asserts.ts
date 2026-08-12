import 'server-only'
import type { HarnessContext } from './context'

/**
 * 스킬 계약(`manifest.json`의 `asserts`) — **선언과 강제를 잇는 곳.**
 *
 * ## 왜 필요했나
 *
 * `asserts`는 매니페스트에 선언되고 `registry.ts`에 구워지기까지 했지만
 * **아무도 읽지 않았다.** 유일한 선언(`data-normalization.변경이력_존재`)은
 * `impls.ts`에 손으로 베낀 검사가 있었는데, 그 검사가
 * `Array.isArray(r.changes)`였고 `normalizeFields`는 **항상** 배열을 반환하므로
 * 영원히 참이었다 — 선언도 구현도 있는데 검사되는 것은 없었다.
 *
 * 이 표가 그 간극을 없앤다. 매니페스트가 선언하면 `runChain`이 실행한다.
 *
 * ## 무엇을 assert로 쓰고 무엇을 쓰지 않는가
 *
 * **assert 위반은 던진다 → 500이다.** 그러므로 여기 넣을 것은
 * 「일어나서는 안 되는 프로그래밍 오류」뿐이다.
 *
 * spec이 규정한 **판정**은 assert가 아니다. 예를 들어 「정규화 3종 외 변형 0건」은
 * `ValidationItem`이 되어 409 `retry`로 가야 하는 판정이고(§6.2·§11.6),
 * assert로 걸면 500이 되어 재시도 경로를 통째로 건너뛴다. 그 검사는
 * `axis0-verification`의 검사 1이다. 근거는 `manifest.json`의 `asserts_note`.
 */

export type AssertFn = (c: HarnessContext) => string | null

/** `행사정보.행사명` → 해당 값. 없으면 `undefined` */
function at(bag: unknown, path: string): unknown {
  const [key, sub] = path.split('.')
  const outer = (bag as Record<string, unknown> | null)?.[key]
  return (outer as Record<string, unknown> | undefined)?.[sub]
}

/**
 * `form_input`과 `confirmed_data`가 **1:1로 대응하는** 스칼라 필드.
 *
 * 제외한 둘:
 *   · `행사정보.여행기간` — `_시작`+`_종료`를 결합한 값이라 대응이 1:1이 아니다(§6.2.1)
 *   · `행사정보.일정`     — 배열이고 AI 분해 결과다. 0차 검증의 몫이다
 */
const COMPARABLE = [
  '행사정보.행사명', '행사정보.여행지', '행사정보.일정원문',
  '행사정보.여행스타일', '행사정보.타겟층', '행사정보.여행주제', '행사정보.기획메모',
  '숙박.숙소명', '숙박.객실타입', '숙박.위치', '숙박.숙박일정',
  '항공편.공항', '항공편.항공사', '항공편.편명', '항공편.출발시간', '항공편.도착시간',
  '식사.식사정보',
  '가격.성인', '가격.아동', '가격.기타',
  '상점.상점명', '상점.상점정보',
] as const

export const ASSERTS: Record<string, AssertFn> = {
  /**
   * §6.2 추적 가능성 — **값이 바뀌었으면 이력이 있어야 한다.**
   *
   * 채움(`optional-field-fill`)과 정규화(`data-normalization`)가 같은 `changes`
   * 배열에 쌓으므로, 이 시점에 `form_input`과 달라진 필드는 전부 이력에
   * 경로가 남아 있어야 한다. 이력 없이 바뀐 값은 **어느 규칙으로 바뀌었는지
   * 설명할 수 없는 값**이고, 0차 검증이 그것을 허용 차이로 볼지 판단할 근거가 없다.
   */
  변경이력_존재: (c) => {
    if (!Array.isArray(c.changes)) return '변경 이력이 배열이 아니다'
    if (!c.cd) return 'confirmed_data가 없다 — 정규화가 산출물을 남기지 않았다'

    const 기록된경로 = new Set(c.changes.map((ch) => ch.경로))
    const 누락 = COMPARABLE.filter((path) => {
      const before = at(c.fi, path)
      const after = at(c.cd, path)
      if (typeof before !== 'string' || typeof after !== 'string') return false
      return before !== after && !기록된경로.has(path)
    })

    if (누락.length > 0) {
      return `이력 없이 값이 바뀐 필드 ${누락.length}건: ${누락.join(', ')}`
    }
    return null
  },
}
