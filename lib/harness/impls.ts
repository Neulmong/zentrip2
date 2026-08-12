import 'server-only'
import { validateFormInput } from '@/lib/form-validation'
import { fillOptional, normalizeFields, PLACEHOLDER } from '@/lib/pipeline/normalize'
import { verifyAxis0 } from '@/lib/pipeline/axis0'
import { assertFactsUnchanged, buildBrochure, checkBrochure } from '@/lib/pipeline/brochure'
import { buildPage, checkPage } from '@/lib/pipeline/page'
import { resolveTheme } from '@/lib/pipeline/theme'
import { findMemoLeaks } from '@/lib/pipeline/memo-leak'
import { proposeSlug, withSuffix } from '@/lib/pipeline/slug'
import type { HarnessContext } from './context'

/**
 * `kind: mechanical` 스킬 등록표 — **AI 0회**(규약 R3의 기본값).
 *
 * 각 항목은 매니페스트의 `impl`이 가리키는 순수 함수를 부르고 결과를
 * 자료 버스에 쓴다. 여기서 하는 일은 **연결**이지 계산이 아니다 —
 * 계산은 `lib/pipeline/*`가 하고 그쪽만 `npm run test:policy`가 검증한다.
 *
 * 이 표에 없는 이름이 체인에 있으면 `runChain`이 던진다. 조용히 건너뛰지
 * 않는 이유: 검사 스킬이 빠진 채로 통과하는 것이 가장 위험한 실패다.
 */
export type SkillRunner = (c: HarnessContext, args: Record<string, unknown>) => void

/** 재료가 없으면 배선이 틀린 것이다 — 조용히 넘기지 않고 던진다 */
function need<T>(v: T | undefined, skill: string, what: string): T {
  if (v === undefined || v === null) {
    throw new Error(`하네스: 스킬 «${skill}»이 «${what}»를 요구하는데 없다. 체인 순서를 확인하라`)
  }
  return v
}

const 유출문구 = (위치: string, 토큰: string) =>
  `${위치}에 기획 메모의 «${토큰}»이 노출됐습니다 (고객 미노출 필드).`

export const MECHANICAL: Record<string, SkillRunner> = {
  /* ── intake-agent ─────────────────────────────────────────── */

  /**
   * 관문 재검사. 라우트 ①의 체인이지만 하네스가 구동하지 않는다
   * (매니페스트 `driven_by: "route"`). 다른 체인에 배선되면 여기가 실행된다.
   */
  'input-guard': (c) => {
    const errors = validateFormInput(c.fi)
    for (const [field, 사유] of Object.entries(errors)) {
      c.items.push({
        검증영역: '입력', source경로: field, 기준값: '(필수)',
        발견값: '(미입력 또는 형식 오류)', 사유, 위치: `form_input.${field}`,
      })
    }
    if (c.items.length > 0) c.stop = 'input_error'
  },

  'optional-field-fill': (c) => {
    const r = fillOptional(c.fi)
    c.filled = r.filled
    c.changes.push(...r.changes)
    c.채운경로 = r.채운경로
  },

  /**
   * 정규화 3종 + 결합 1종. `asserts: ["변경이력_존재"]`는 **여기서 검사하지 않는다** —
   * `runChain`이 매니페스트 선언을 읽어 `lib/harness/asserts.ts`의 평가기를 돌린다.
   *
   * 전에는 이 자리에 손으로 베낀 검사가 있었는데 `Array.isArray(r.changes)`였고
   * `normalizeFields`는 항상 배열을 반환하므로 영원히 참이었다. 선언과 강제가
   * 끊겨 있으면 그런 빈 검사가 생긴다.
   */
  'data-normalization': (c) => {
    const r = normalizeFields(c.filled ?? c.fi)
    c.cd = r.data
    c.changes.push(...r.changes)
  },

  'axis0-verification': (c) => {
    const cd = need(c.cd, 'axis0-verification', 'confirmed_data')
    const r = verifyAxis0(c.fi, cd, c.days)
    c.items.push(...r.items)
    c.위반후보 = r.위반후보
  },

  /* ── content-writer-agent ─────────────────────────────────── */

  'intro-template-writer': (c) => {
    const cd = need(c.cd, 'intro-template-writer', 'confirmed_data')
    const 핵심일정 = need(c.핵심일정, 'intro-template-writer', 'overview.핵심일정')
    c.brochure = buildBrochure(cd, 핵심일정)
  },

  /** 보호값 검증 — 소개서의 사실정보가 확정 데이터와 같은지. 변경 0건이어야 한다 */
  'tonal-manner-apply': (c) => {
    const cd = need(c.cd, 'tonal-manner-apply', 'confirmed_data')
    const b = need(c.brochure, 'tonal-manner-apply', 'brochure_content')
    c.errors.push(...assertFactsUnchanged(cd, b))
  },

  'brochure-contract-check': (c) => {
    c.errors.push(...checkBrochure(need(c.brochure, 'brochure-contract-check', 'brochure_content')))
  },

  /* ── web-builder-agent ────────────────────────────────────── */

  'theme-design-token-match': (c) => {
    const cd = need(c.cd, 'theme-design-token-match', 'confirmed_data')
    c.theme = resolveTheme(cd.행사정보.여행스타일)
  },

  'web-content-structure-gen': (c) => {
    const cd = need(c.cd, 'web-content-structure-gen', 'confirmed_data')
    c.page = buildPage({
      cd,
      theme: need(c.theme, 'web-content-structure-gen', 'theme'),
      slots: new Set(c.materials.imageSlots.map((r) => r.slot)),
      expanded: need(c.expanded, 'web-content-structure-gen', '확장 서술'),
      apply: need(c.apply, 'web-content-structure-gen', 'apply 문구'),
    })
  },

  'page-contract-check': (c) => {
    const page = need(c.page, 'page-contract-check', 'page_content')
    c.errors.push(...checkPage(page, new Set(c.materials.imageSlots.map((r) => r.slot))))
  },

  /**
   * slug — **이미 있으면 재발급하지 않는다.** 주소를 바꾸면 공유된 링크가 끊긴다(§12.1).
   *
   * 계약 검사가 이미 실패했으면 발급하지 않는다: 그 요청은 어차피 실패로
   * 돌아가고, slug를 미리 잡아 두면 다음 시도에서 쓸 이름이 하나 줄어든다.
   */
  'slug-issue': (c) => {
    if (c.errors.length > 0 || c.items.length > 0) return
    if (c.p.slug) { c.slug = c.p.slug; return }

    const cd = need(c.cd, 'slug-issue', 'confirmed_data')
    const proposed = proposeSlug(cd.행사정보.행사명)
    const slug = withSuffix(proposed.slug, c.materials.usedSlugs)
    if (!slug) { c.slug충돌 = proposed.slug; return }
    c.slug = slug
  },

  /* ── 양쪽 체인 공용 ───────────────────────────────────────── */

  /**
   * 기획메모 유출 검사 — 프롬프트의 「인용 금지」는 지시일 뿐 보증이 아니다.
   * 메모에만 있는 숫자(나이·인원)가 서술 필드에 나타나면 생성 실패로 본다.
   */
  'memo-leak-check': (c, args) => {
    const cd = need(c.cd, 'memo-leak-check', 'confirmed_data')
    const { 기획메모, ...메모제외 } = cd.행사정보
    const 확정값 = JSON.stringify({ ...cd, 행사정보: 메모제외 })

    const 서술: [string, string][] = args.target === 'page'
      ? [
          ...[...need(c.expanded, 'memo-leak-check', '확장 서술').entries()]
            .map(([day, text]) => [`days[${day}].text`, text] as [string, string]),
          ['apply.제목', need(c.apply, 'memo-leak-check', 'apply 문구').제목],
          ['apply.안내문구', need(c.apply, 'memo-leak-check', 'apply 문구').안내문구],
        ]
      : [['b_overview.핵심일정', need(c.핵심일정, 'memo-leak-check', 'overview.핵심일정')]]

    for (const l of findMemoLeaks(기획메모, 확정값, 서술)) {
      c.errors.push(유출문구(l.위치, l.토큰))
    }
  },
}

/** 부분 채움 일차 (§5.5 `itinerary_partial`) — 분해 결과에서 뽑는다 */
export function partialDaysOf(c: HarnessContext): string[] {
  return (c.cd?.행사정보.일정 ?? []).filter((d) => d.내용 === PLACEHOLDER).map((d) => d.day)
}
