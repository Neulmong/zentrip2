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
import { resolvePath } from './paths'

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
          여행주제: g.여행주제,
          핵심일정,
        },
        source: {
          여행지: '행사정보.여행지', 여행기간: '행사정보.여행기간',
          타겟층: '행사정보.타겟층', 여행스타일: '행사정보.여행스타일',
          여행주제: '행사정보.여행주제',
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
        /*
         * 행 순서를 그대로 승계한다 — 순서가 값의 일부다(§7.4). 키 순서는
         * §8.7 표와 같게 명시한다. `{...st}`로 펼치지 않는 이유는 `Stay`의
         * 필드 순서가 바뀌어도 산출물 구조가 흔들리지 않게 하기 위해서다.
         */
        data: {
          숙소들: cd.숙박.map((st) => ({
            숙소명: st.숙소명, 객실타입: st.객실타입, 위치: st.위치, 숙박일정: st.숙박일정,
          })),
        },
        // 배열 필드에는 **배열의 경로 하나**를 적는다. 원소 단위 대조는 검증기가
        // 인덱스를 붙여(`숙박[0].숙소명`) 수행한다 — `days`와 같은 규약이다(§8.7)
        source: { 숙소들: '숙박' },
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
        data: {
          상점들: cd.상점.map((sh) => ({
            상점명: sh.상점명, 구분: sh.구분, 위치: sh.위치, 상점정보: sh.상점정보,
          })),
        },
        source: { 상점들: '상점' },
      },
    ],
  }
}

export const BROCHURE_SECTION_IDS = [
  'b_title', 'b_overview', 'b_itinerary', 'b_accommodation',
  'b_flight', 'b_meal', 'b_price', 'b_shop',
] as const

/**
 * 값 배열(`숙소들`·`상점들`)을 원소 단위로 대조한다 (§8.7).
 *
 * **행 수부터 본다.** 행이 줄어든 것은 §16.1의 부분 삭제이고, 그 상태에서
 * 원소를 맞대면 「2번째 숙소의 값이 다르다」처럼 사람을 엉뚱한 칸으로 보내는
 * 항목이 쏟아진다. 행 수가 다르면 그 사실 하나만 보고한다.
 */
function 행대조(
  secId: string, field: string, path: string, expected: readonly unknown[], got: unknown,
): string[] {
  if (!Array.isArray(got)) {
    return [`${secId}.${field}: «${path}»는 배열인데 소개서 쪽이 배열이 아닙니다.`]
  }
  if (got.length !== expected.length) {
    return [`${secId}.${field}: 확정 데이터표는 ${expected.length}건인데 `
      + `소개서는 ${got.length}건입니다. 행을 요약·병합·생략할 수 없습니다.`]
  }

  const reasons: string[] = []
  for (const [i, row] of expected.entries()) {
    if (row === null || typeof row !== 'object') continue
    for (const [sub, want] of Object.entries(row as Record<string, unknown>)) {
      const g = (got[i] as Record<string, unknown> | undefined)?.[sub]
      if (g === undefined || g === null) {
        reasons.push(`${secId}.${field}[${i}].${sub}: 조립 과정에서 필드가 누락됐습니다.`)
        continue
      }
      if (String(g) !== String(want)) {
        reasons.push(`${secId}.${field}[${i}].${sub}: 확정 데이터표는 «${String(want)}»인데 `
          + `소개서는 «${String(g)}»입니다.`)
      }
    }
  }
  return reasons
}

/** 미치환 토큰·조사 파이프 기호 0건 (§11.2). 문자열 1개를 본다 */
function 토큰검사(위치: string, v: string, errors: string[]): void {
  if (/\{\{|\}\}/.test(v)) errors.push(`${위치}에 미치환 토큰이 남았습니다: ${v.slice(0, 40)}`)
  if (/\|[가-힣]{1,2}\}\}/.test(v)) errors.push(`${위치}에 조사 파이프 기호가 남았습니다.`)
}

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
    /*
     * **양방향으로 본다.** 아래 루프는 `data`에 있는 키에 `source`가 있는지만
     * 보므로, 반대 방향(`source`에 선언됐는데 `data`에 없는 필드)이 두 검사
     * 모두를 빠져나갔다. `assertFactsUnchanged`도 없는 값은 건너뛰었다.
     */
    for (const k of Object.keys(s.source ?? {})) {
      if (!(k in s.data)) errors.push(`${s.id}.${k}: source에 선언됐는데 data에 없습니다.`)
    }

    for (const [k, v] of Object.entries(s.data)) {
      if (!(k in s.source)) errors.push(`${s.id}.${k}에 source가 없습니다.`)

      /*
       * 배열 필드(`days`·`숙소들`·`상점들`)는 원소 **안**을 본다.
       *
       * 이전에는 `days`를 통째로 건너뛰었다. 그래서 일차 서술에 미치환 토큰이
       * 남아도 이 검사가 통과했다 — 소개서 8섹션 중 서술이 가장 긴 섹션이
       * 정확히 검사 밖에 있었다. 배열이 3개로 늘어난 지금 그 구멍을 그대로
       * 물려받을 이유가 없다.
       */
      if (Array.isArray(v)) {
        for (const [i, row] of v.entries()) {
          if (row === null || typeof row !== 'object') continue
          for (const [sub, val] of Object.entries(row as Record<string, unknown>)) {
            if (typeof val === 'string') 토큰검사(`${s.id}.${k}[${i}].${sub}`, val, errors)
          }
        }
        continue
      }

      if (typeof v === 'string') 토큰검사(`${s.id}.${k}`, v, errors)
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

/**
 * 스킬 `tonal-manner-apply` — 보호값 검증. **변경 0건을 스스로 확인한다.**
 *
 * `source` 맵이 가리키는 `confirmed_data` 경로의 값과 소개서에 담긴 값이 같은지
 * 본다. `source`가 `"generated"`인 필드는 대조 대상이 아니다 — AI가 쓴 서술이다.
 *
 * ## 이 검사의 성격을 정직하게 적어 둔다
 *
 * `buildBrochure`가 값을 기계로 치환하므로 **지금은 구조적으로 같을 수밖에 없다.**
 * 즉 이것은 현재 동작을 의심하는 검사가 아니라, 누군가 조립부에 값 변형을
 * 끼워 넣었을 때 **1차 검증(AI 호출)까지 가기 전에** 잡는 회귀 가드다.
 *
 * 1차 검증이 `form_input` 기준으로 더 엄격하게 같은 것을 보므로 이 스킬의 값은
 * 낮다. 남긴 이유는 AI 호출 없이 즉시 잡히기 때문이다 — 실패 원인을
 * 「조립부가 값을 바꿨다」로 좁혀 준다.
 */
export function assertFactsUnchanged(cd: ConfirmedData, b: BrochureContent): string[] {
  const reasons: string[] = []

  for (const sec of b.sections) {
    for (const [field, path] of Object.entries(sec.source ?? {})) {
      if (path === 'generated') continue

      const expected = resolvePath(cd, path)
      if (expected === undefined) {
        reasons.push(`${sec.id}.${field}: source가 가리키는 «${path}»가 확정 데이터표에 없습니다.`)
        continue
      }

      if (Array.isArray(expected)) {
        /*
         * `행사정보.일정`은 값 배열이 아니다 — 일차별 서술은 `일정[n].내용`이고
         * 0차가 이미 원문근거 범위를 확인했다. 여기서 문자열 대조를 걸면
         * 압축·확장이 정상인 필드를 위반으로 잡는다.
         */
        if (path === '행사정보.일정') continue
        reasons.push(...행대조(sec.id, field, path, expected, sec.data[field]))
        continue
      }

      const got = sec.data[field]

      /*
       * **없는 값을 통과시키지 않는다.**
       *
       * 전에는 `typeof got !== 'string' && typeof got !== 'number'`면 조용히
       * 넘어갔다. 그래서 `source`에 선언된 필드가 조립 과정에서 통째로 빠져도
       * 이 검사가 「이상 없음」을 냈다 — 이 검사의 존재 이유가 「조립부에 값
       * 변형이 끼어들었을 때 잡는 회귀 가드」인데, 회귀가 가장 흔히 나타나는
       * 형태(필드 누락)에 정확히 구멍이 있었다.
       */
      if (got === undefined || got === null) {
        reasons.push(
          `${sec.id}.${field}: source에 «${path}»로 선언됐는데 소개서에 값이 없습니다. `
          + '조립 과정에서 필드가 누락됐습니다.',
        )
        continue
      }
      if (typeof got !== 'string' && typeof got !== 'number') {
        reasons.push(
          `${sec.id}.${field}: 사실정보 필드인데 값이 «${typeof got}»입니다. `
          + '문자열 또는 숫자여야 대조할 수 있습니다.',
        )
        continue
      }

      if (String(got) !== String(expected)) {
        reasons.push(
          `${sec.id}.${field}: 확정 데이터표는 «${String(expected)}»인데 `
          + `소개서는 «${String(got)}»입니다. 조립 과정에서 값이 바뀌었습니다.`,
        )
      }
    }
  }

  return reasons
}
