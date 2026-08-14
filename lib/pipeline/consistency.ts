/**
 * 3차 검증 — 소개서 ↔ 페이지 교차 대조 (spec 2.8 §11.4 · 명령서 ⑤). **순수 모듈 · AI 0회.**
 *
 * ## 2.7 → 2.8에서 뒤집힌 것
 *
 * 2.7은 `SECTION_PAIRS`(소개서 8 ↔ 페이지 9 **1:1 대응표**)의 존재를 먼저 검사했다.
 * 2.8은 페이지 구성이 자유로워져 대응표가 성립하지 않는다 — **대응표를 삭제하고**
 * `source` 커버리지로 옮긴다:
 *
 *   · 소개서의 `source` 경로 집합 ⊆ 페이지의 `source` 경로 집합
 *   · 같은 경로의 값이 문자열로 동일
 *   · 일정 배열 대조 — 단 일정 섹션을 **id가 아니라 type으로** 찾는다
 *     (`itinerary` 또는 `timeline`. 어느 쪽을 써도 일정 커버리지가 성립)
 *
 * ## 왜 기계로 할 수 있나 (2.7과 동일)
 *
 * 두 콘텐츠 모델은 **같은 `source` 경로 문자열**을 쓴다. 소개서 `b_price.성인`과
 * 페이지의 어느 price 블록이든 `source`는 `"가격.성인"`이다. 그래서 필드 이름·섹션
 * id를 하드코딩하지 않고 `source`를 조인 키로 값을 맞댈 수 있다. `collect()`가
 * 섹션 id·타입에 의존하지 않으므로(§8.1) 구성 자유와 4축 검증이 양립한다.
 *
 * ## 포기한 것 — 서술 문장의 의미 대조 (2.7과 동일)
 *
 * 소개서 명사구가 페이지에 살아남았는지만 본다(압축 → 확장이므로 이 방향은 성립).
 * 반대 방향(페이지에만 있는 요소)은 `form_input`을 쥔 1·2차 `fact-check`가 잡는다.
 */
import type { ValidationItem } from '../types'
import type { ConfirmedData } from './normalize'
import { normalizeSpace } from './normalize'
import { extractNouns, NOUN_PREFIX_LEN } from './axis0'
import { expandRows, requiredPaths, ROW_FIELDS } from './paths'
import { type BrochureContent } from './brochure'
import { type PageContent } from './page'
import { isItineraryType } from './vocabulary'

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
 * `source` 경로 → 그 경로를 가리키는 값들. (2.7과 동일)
 *
 * 제외: `source`가 `"generated"`인 필드, `days` 배열(일차 서술은 아래에서 따로).
 * **`숙소들`·`상점들`은 펼친다** — 경로에 인덱스를 붙여(`숙박[0].숙소명`) 조인 키가 성립.
 */
function collect(
  sections: readonly { id: string; type?: string; data: Record<string, unknown>; source: Record<string, string> }[],
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
        if (!(field in ROW_FIELDS)) continue // `days`·`문구들`은 여기서 빠진다
        for (const [p, 값] of expandRows(path, v)) push(p, 값, `${s.id}.${field}`)
        continue
      }
      if (typeof v !== 'string' && typeof v !== 'number') continue
      push(path, String(v), `${s.id}.${field}`)
    }
  }
  return out
}

/** 일차 배열을 꺼낸다. 소개서는 id로, 페이지는 **type으로** 찾는다(명령서 ⑤) */
function brochureDays(sections: readonly { id: string; data: Record<string, unknown> }[]) {
  return daysFrom(sections.find((s) => s.id === 'b_itinerary')?.data)
}
function pageDays(sections: readonly { type: string; data: Record<string, unknown> }[]) {
  return daysFrom(sections.find((s) => isItineraryType(s.type))?.data)
}
function daysFrom(data: Record<string, unknown> | undefined): { day: string; text: string }[] | null {
  const days = data?.days
  if (!Array.isArray(days)) return null
  return days.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>
    return { day: String(o.day ?? ''), text: typeof o.text === 'string' ? o.text : '' }
  })
}

function survives(후보: string, haystack: string): boolean {
  if (haystack.includes(후보)) return true
  return 후보.length > NOUN_PREFIX_LEN && haystack.includes(후보.slice(0, NOUN_PREFIX_LEN))
}

/**
 * 스킬 `consistency-check` — 3차 대조. **항목 0건이면 통과.**
 * 기준은 `form_input`이고 그 판정은 1·2차의 몫이다 — 여기는 두 문서가 다르다는
 * 사실만 보고한다(§11.1).
 */
export function checkConsistency(b: BrochureContent, p: PageContent): ValidationItem[] {
  const items: ValidationItem[] = []

  /* ── 1. source를 조인 키로 값 대조 (소개서 ⊆ 페이지) ───────── */
  const bMap = collect(b.sections, new Set())
  // apply 블록은 소개서에 대응이 없다(§11.4 skipped) — type으로 제외한다
  const applyIds = new Set(p.sections.filter((s) => s.type === 'apply').map((s) => s.id))
  const pMap = collect(p.sections, applyIds)

  for (const [path, bOcc] of bMap) {
    // 재료 없음(`해당 없음`)은 페이지가 블록을 생략할 수 있다(§8.5) — 대조에서 제외
    if (bOcc[0].값 === '해당 없음') continue

    const pOcc = pMap.get(path)
    if (!pOcc || pOcc.length === 0) {
      items.push(item('교차 대조', path, bOcc[0].값, '(대응 필드 없음)',
        `소개서 «${bOcc[0].위치}»의 값이 페이지 어디에도 없습니다. `
        + 'source 맵이 누락됐거나 필드가 빠졌습니다.',
        `page_content (source: ${path})`))
      continue
    }

    const 값들 = new Set([...bOcc, ...pOcc].map((o) => o.값))
    if (값들.size > 1) {
      items.push(item('교차 대조', path, bOcc[0].값, pOcc[0].값,
        `같은 값이어야 하는데 다릅니다. 소개서 «${bOcc[0].위치}» = «${bOcc[0].값}», `
        + `페이지 «${pOcc[0].위치}» = «${pOcc[0].값}».`,
        `page_content.${pOcc[0].위치}`))
    }
  }

  /* ── 2. 일차 수·번호·명사구 생존 ──────────────────────────── */
  const bDays = brochureDays(b.sections)
  const pDays = pageDays(p.sections)

  if (!bDays || !pDays) {
    // 소개서엔 일정이 있는데 페이지에 일정 타입 블록이 없으면 위반
    if (bDays && !pDays) {
      items.push(item('일정 대조', '행사정보.일정', '(일차 배열)', '(없음)',
        '페이지에 일정(itinerary·timeline) 블록이 없습니다.', 'page_content (type: itinerary|timeline)'))
    }
    return items
  }

  if (bDays.length !== pDays.length) {
    items.push(item('일정 대조', '행사정보.일정', `${bDays.length}일`, `${pDays.length}일`,
      '일차 수가 다릅니다.', 'page_content.itinerary.days'))
    return items
  }

  for (const [i, bd] of bDays.entries()) {
    const pd = pDays[i]
    if (bd.day !== pd.day) {
      items.push(item('일정 대조', '행사정보.일정', bd.day, pd.day,
        `${i + 1}번째 일차의 번호가 다릅니다.`, `page_content.itinerary.days[${i}].day`))
      continue
    }
    const 사라진것 = extractNouns(bd.text).filter((n) => !survives(n, pd.text))
    if (사라진것.length > 0) {
      items.push(item('일정 대조', '행사정보.일정', bd.text, pd.text,
        `${bd.day}일차에서 소개서에 있던 «${사라진것.join('·')}»이(가) 페이지 서술에 없습니다. `
        + '확장 과정에서 값이 사라졌습니다.',
        `page_content.itinerary.days[${i}].text`))
    }
  }

  return items
}

/**
 * 대조 매핑의 완전성 — 「소개서가 가리키는 경로 전부가 페이지 **필수 경로**에
 * 포함된다」(명령서 ⑤). 2.7의 `SECTION_PAIRS` 완전성 검사를 대체한다.
 *
 * 소개서의 각 `source` 경로(재료 없음·generated 제외)가 `requiredPaths(cd)`에
 * 있어야 한다 — 배열 원소 경로(`숙박[0].숙소명`)는 배열 루트(`숙박`)로 대조한다.
 */
export function assertSectionCoverage(b: BrochureContent, cd: ConfirmedData): string[] {
  const errors: string[] = []
  const req = requiredPaths(cd)
  const bMap = collect(b.sections, new Set())
  for (const [path, occ] of bMap) {
    // 덮을 사실이 없는 것은 제외 — `해당 없음`(재료 없음)·빈 값(선택 필드 미입력)
    if (occ[0].값 === '해당 없음' || occ[0].값 === '') continue
    const root = path.split('[')[0]
    if (!req.has(path) && !req.has(root)) {
      errors.push(`소개서가 가리키는 «${path}»가 페이지 필수 경로에 없습니다.`)
    }
  }
  return errors
}
