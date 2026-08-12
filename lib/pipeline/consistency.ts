/**
 * 3차 검증 — 소개서 ↔ 페이지 교차 대조 (§11.4). **순수 모듈 · AI 0회.**
 *
 * ## 왜 기계로 할 수 있나
 *
 * 두 콘텐츠 모델은 **같은 `source` 경로 문자열**을 쓴다. 소개서의 `b_price.성인`과
 * 페이지의 `sec_price.성인`은 둘 다 `source`가 `"가격.성인"`이다. 그래서 필드
 * 이름을 하드코딩하지 않고 **`source`를 조인 키로** 값을 맞대볼 수 있다.
 *
 * 이 방식이 이 축의 목적과 정확히 맞는다 — §11.1이 3차의 목적을 「사실정보
 * 재확인이 아니라 **교차 검증·회귀 감지**」로 규정한다. `source` 맵 누락과 두
 * 생성 경로의 스키마 드리프트는 `source`를 기준으로 봐야 드러난다.
 *
 * ## AI보다 강하다
 *
 * 이전에는 AI가 의미 대조를 했다. 기계 대조로 내리면서 **약해진 것이 아니라
 * 강해졌다** — AI는 「대충 같아 보이면」 통과시키지만 여기서는 공백 정리 외의
 * 어떤 차이도 통과하지 못한다. 대신 아래 한 가지를 포기했다.
 *
 * ## 포기한 것 — 서술 문장의 의미 대조
 *
 * 일차별 `text`는 소개서가 압축, 페이지가 확장이라 **문자열이 당연히 다르다.**
 * 「페이지에 소개서에 없던 관광지가 새로 등장했는가」는 의미 판정이라 기계로
 * 환원되지 않는다. 그래서 여기서는 **소개서의 명사구가 페이지에 살아남았는지**만
 * 본다(압축 → 확장이므로 이 방향은 성립한다). 반대 방향(페이지에만 있는 요소)은
 * **1·2차 `fact-check`가 `form_input` 기준으로 잡는다** — 그쪽이 기준값을 쥔
 * 검사이므로 원래 그 일의 주인이다.
 */
import type { ValidationItem } from '../types'
import { normalizeSpace } from './normalize'
import { extractNouns, NOUN_PREFIX_LEN } from './axis0'
import { expandRows, ROW_FIELDS } from './paths'
import { BROCHURE_SECTION_IDS, type BrochureContent } from './brochure'
import { PAGE_SECTION_IDS, type PageContent } from './page'

/** §11.4 섹션 대응표. `sec_apply`는 소개서에 짝이 없어 제외한다 */
export const SECTION_PAIRS: readonly (readonly [string, string])[] = [
  ['b_title', 'sec_hero'],
  ['b_overview', 'sec_summary'],
  ['b_itinerary', 'sec_itinerary'],
  ['b_accommodation', 'sec_accommodation'],
  ['b_flight', 'sec_flight'],
  ['b_meal', 'sec_meal'],
  ['b_price', 'sec_price'],
  ['b_shop', 'sec_shop'],
]

/** `validation_snapshot.axes.axis_3.skipped`. **항상 이 값이다**(§11.4) */
export const SKIPPED = ['apply'] as const

function item(
  검증영역: string, source경로: string | null,
  기준값: string, 발견값: string, 사유: string, 위치: string,
): ValidationItem {
  return { 검증영역, source경로, 기준값, 발견값, 사유, 위치 }
}

interface Occurrence { 값: string; 위치: string }

/**
 * `source` 경로 → 그 경로를 가리키는 값들.
 *
 * 한 경로가 여러 자리에 나타날 수 있다 — `행사정보.여행기간`은 페이지에서
 * `sec_hero.subcopy`와 `sec_summary.여행기간` 두 곳에 있다.
 *
 * 제외하는 것 둘:
 *   · `source`가 `"generated"`인 필드 — AI가 쓴 서술이라 대조 대상이 아니다
 *   · `days` 배열 — 일차 서술은 압축 vs 확장이라 아래에서 따로 본다
 *
 * **`숙소들`·`상점들`은 펼친다.** 값 배열이므로 원소 단위로 문자열이 같아야
 * 하고, 경로에 인덱스를 붙이면(`숙박[0].숙소명`) 조인 키가 그대로 성립한다.
 * 행 수가 다르면 **한쪽에만 있는 경로가 생겨** 「대응 필드 없음」으로 잡힌다 —
 * 행 누락을 잡기 위해 따로 검사를 더 붙일 필요가 없다.
 */
function collect(
  sections: readonly { id: string; data: Record<string, unknown>; source: Record<string, string> }[],
  skip: ReadonlySet<string>,
): Map<string, Occurrence[]> {
  const out = new Map<string, Occurrence[]>()
  const push = (path: string, 값: string, 위치: string) => {
    const list = out.get(path) ?? []
    list.push({ 값: normalizeSpace(값), 위치 })
    out.set(path, list)
  }

  for (const s of sections) {
    if (skip.has(s.id)) continue
    for (const [field, path] of Object.entries(s.source ?? {})) {
      if (path === 'generated') continue
      const v = s.data[field]

      if (Array.isArray(v)) {
        // `days`는 여기서 빠진다 — `ROW_FIELDS`에 없다
        if (!(field in ROW_FIELDS)) continue
        for (const [p, 값] of expandRows(path, v)) push(p, 값, `${s.id}.${field}`)
        continue
      }

      if (typeof v !== 'string' && typeof v !== 'number') continue
      push(path, String(v), `${s.id}.${field}`)
    }
  }
  return out
}

/** 일차 배열을 꺼낸다. 두 모델 모두 `{day, text}`를 갖는다 */
function daysOf(
  sections: readonly { id: string; data: Record<string, unknown> }[], id: string,
): { day: string; text: string }[] | null {
  const sec = sections.find((s) => s.id === id)
  const days = sec?.data.days
  if (!Array.isArray(days)) return null
  return days.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>
    return { day: String(o.day ?? ''), text: typeof o.text === 'string' ? o.text : '' }
  })
}

/**
 * 소개서 명사구가 페이지 서술에 살아남았는가.
 *
 * 접두 일치를 허용하는 이유와 길이는 0차와 같다(`NOUN_PREFIX_LEN`) — 확장하면서
 * 「올레 7코스」가 「올레길 7코스」가 되는 정도는 정상이다. 값을 키우면 누락이
 * 통과하고, 줄이면 정상 확장이 반려된다.
 */
function survives(후보: string, haystack: string): boolean {
  if (haystack.includes(후보)) return true
  return 후보.length > NOUN_PREFIX_LEN && haystack.includes(후보.slice(0, NOUN_PREFIX_LEN))
}

/**
 * 스킬 `consistency-check` — 3차 대조. **항목 0건이면 통과.**
 *
 * 어느 쪽이 옳은지 판단하지 않는다. 기준은 `form_input`이고 그 판정은 1·2차의
 * 몫이다(§11.1). 이 함수는 **두 문서가 다르다는 사실만** 보고한다.
 */
export function checkConsistency(b: BrochureContent, p: PageContent): ValidationItem[] {
  const items: ValidationItem[] = []

  /* ── 1. 섹션 대응이 성립하는가 ─────────────────────────────── */
  const bIds = new Set(b.sections.map((s) => s.id))
  const pIds = new Set(p.sections.map((s) => s.id))

  for (const [bid, pid] of SECTION_PAIRS) {
    if (!bIds.has(bid)) {
      items.push(item('섹션 대응', null, bid, '(없음)',
        `소개서에서 «${bid}» 섹션이 사라졌습니다.`, `brochure_content.${bid}`))
    }
    if (!pIds.has(pid)) {
      items.push(item('섹션 대응', null, pid, '(없음)',
        `페이지에서 «${pid}» 섹션이 사라졌습니다.`, `page_content.${pid}`))
    }
  }

  /* ── 2. source를 조인 키로 값 대조 ─────────────────────────── */
  const bMap = collect(b.sections, new Set())
  // `sec_apply`는 제외한다 — 소개서에 대응 섹션이 없다(§11.4 skipped)
  const pMap = collect(p.sections, new Set(['sec_apply']))

  for (const [path, bOcc] of bMap) {
    const pOcc = pMap.get(path)
    if (!pOcc || pOcc.length === 0) {
      items.push(item('교차 대조', path, bOcc[0].값, '(대응 필드 없음)',
        `소개서 «${bOcc[0].위치}»의 값이 페이지 어디에도 없습니다. `
        + 'source 맵이 누락됐거나 필드가 빠졌습니다.',
        `page_content (source: ${path})`))
      continue
    }

    // 한 경로의 값은 양쪽 통틀어 하나여야 한다
    const 값들 = new Set([...bOcc, ...pOcc].map((o) => o.값))
    if (값들.size > 1) {
      items.push(item('교차 대조', path, bOcc[0].값, pOcc[0].값,
        `같은 값이어야 하는데 다릅니다. 소개서 «${bOcc[0].위치}» = «${bOcc[0].값}», `
        + `페이지 «${pOcc[0].위치}» = «${pOcc[0].값}».`,
        `page_content.${pOcc[0].위치}`))
    }
  }

  /* ── 3. 일차 수·번호 ───────────────────────────────────────── */
  const bDays = daysOf(b.sections, 'b_itinerary')
  const pDays = daysOf(p.sections, 'sec_itinerary')

  if (!bDays || !pDays) {
    if (bIds.has('b_itinerary') && pIds.has('sec_itinerary')) {
      items.push(item('일정 대조', '행사정보.일정', '(일차 배열)', '(없음)',
        '한쪽의 일정 배열을 읽을 수 없습니다.', 'page_content.sec_itinerary.days'))
    }
    return items
  }

  if (bDays.length !== pDays.length) {
    items.push(item('일정 대조', '행사정보.일정', `${bDays.length}일`, `${pDays.length}일`,
      '일차 수가 다릅니다.', 'page_content.sec_itinerary.days'))
    return items
  }

  for (const [i, bd] of bDays.entries()) {
    const pd = pDays[i]
    if (bd.day !== pd.day) {
      items.push(item('일정 대조', '행사정보.일정', bd.day, pd.day,
        `${i + 1}번째 일차의 번호가 다릅니다.`, `page_content.sec_itinerary.days[${i}].day`))
      continue
    }

    /*
     * 압축 → 확장이므로 **소개서의 명사구는 페이지에 남아 있어야 한다.**
     * 반대 방향(페이지에만 있는 요소)은 보지 않는다 — 연결어·안내 문구가 붙는
     * 것이 정상이고, 「입력에 없는 요소」 판정은 `form_input`을 쥔 1·2차의 몫이다.
     */
    const 사라진것 = extractNouns(bd.text).filter((n) => !survives(n, pd.text))
    if (사라진것.length > 0) {
      items.push(item('일정 대조', '행사정보.일정', bd.text, pd.text,
        `${bd.day}일차에서 소개서에 있던 «${사라진것.join('·')}»이(가) 페이지 서술에 없습니다. `
        + '확장 과정에서 값이 사라졌습니다.',
        `page_content.sec_itinerary.days[${i}].text`))
    }
  }

  return items
}

/** 대조 대상 섹션이 규정대로인지 — `skipped`는 항상 `["apply"]`다(§11.4) */
export function assertSectionCoverage(): string[] {
  const errors: string[] = []
  const covered = new Set(SECTION_PAIRS.map(([, pid]) => pid))
  const missing = PAGE_SECTION_IDS.filter((id) => id !== 'sec_apply' && !covered.has(id))
  if (missing.length > 0) {
    errors.push(`대응표가 페이지 섹션을 빠뜨렸습니다: ${missing.join(', ')}`)
  }
  const bCovered = new Set(SECTION_PAIRS.map(([bid]) => bid))
  const bMissing = BROCHURE_SECTION_IDS.filter((id) => !bCovered.has(id))
  if (bMissing.length > 0) {
    errors.push(`대응표가 소개서 섹션을 빠뜨렸습니다: ${bMissing.join(', ')}`)
  }
  return errors
}
