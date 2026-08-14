import 'server-only'
import { validateFormInput } from '@/lib/form-validation'
import { fillOptional, normalizeFields, PLACEHOLDER } from '@/lib/pipeline/normalize'
import { verifyAxis0 } from '@/lib/pipeline/axis0'
import {
  assertFactsUnchanged, buildBrochure, checkBrochure, type BrochureContent,
} from '@/lib/pipeline/brochure'
import { buildPage, checkPage, type PageContent } from '@/lib/pipeline/page'
import { baselineEnrichment, hasEnrichTargets } from '@/lib/pipeline/enrichment'
import { checkConsistency } from '@/lib/pipeline/consistency'
import { resolveThemeSpec } from '@/lib/pipeline/theme'
import { gateInfo } from '@/lib/pipeline/vocabulary'
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
function need<T>(v: T | undefined | null, skill: string, what: string): T {
  if (v === undefined || v === null) {
    throw new Error(`하네스: 스킬 «${skill}»이 «${what}»를 요구하는데 없다. 체인 순서를 확인하라`)
  }
  return v
}

const 유출문구 = (위치: string, 토큰: string) =>
  `${위치}에 기획 메모의 «${토큰}»이 노출됐습니다 (고객 미노출 필드).`

/**
 * 소개서(brochure_content)의 개요 서술(`b_overview.data.핵심일정`)을 꺼낸다.
 * source: generated이고 소개서 단계에서 이미 검증을 통과한 값이라 페이지가 그대로 승계한다.
 * 없거나 형태가 다르면 undefined — 그때 페이지 개요는 여행주제만 남는다(graceful).
 */
function overviewText(brochure: unknown): string | undefined {
  const secs = (brochure as { sections?: { id?: string; data?: Record<string, unknown> }[] } | null)?.sections
  const v = secs?.find((s) => s.id === 'b_overview')?.data?.핵심일정
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

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

  /**
   * 어휘·재료 게이트 (명령서 ⑥) — 체인 1번(AI 앞). 어휘 목록 + 재료 유무(§8.5)를
   * 확정해 AI에게 넘긴다. AI가 존재할 수 없는 블록(항공 미이용·0행)에 토큰을
   * 쓰지 않게 한다. `ai-skills.ts`가 `c.gate`를 user 메시지에 싣는다.
   */
  'block-vocabulary-gate': (c) => {
    const cd = need(c.cd, 'block-vocabulary-gate', 'confirmed_data')
    c.gate = gateInfo(cd)
  },

  /**
   * 테마 — **AI 뒤로 이동**(명령서 ⑥). AI가 고른 디자인 의도(`themeSpec`: hue+mood)를
   * 검증하고 무효 필드만 폴백한다. 색은 OKLCH로 계산되고 대비 4종이 보증된다(theme.ts).
   */
  'theme-design-token-match': (c) => {
    const cd = need(c.cd, 'theme-design-token-match', 'confirmed_data')
    c.theme = resolveThemeSpec(c.themeSpec, cd.행사정보.여행스타일)
  },

  'web-content-structure-gen': (c) => {
    const cd = need(c.cd, 'web-content-structure-gen', 'confirmed_data')
    const page = buildPage({
      cd,
      theme: need(c.theme, 'web-content-structure-gen', 'theme'),
      slots: new Set(c.materials.imageSlots.map((r) => r.slot)),
      plan: need(c.plan, 'web-content-structure-gen', '블록 계획'),
      expanded: need(c.expanded, 'web-content-structure-gen', '확장 서술'),
      apply: need(c.apply, 'web-content-structure-gen', 'apply 문구'),
      hero: c.hero,
      // 소개서 개요(generated)를 페이지 여행 개요로 승계 — 새 AI 호출 없이 재사용
      개요: overviewText(c.p.brochure_content),
    })
    /*
     * Q2 안전장치 — 생성 즉시 **모든 장소에 기본 설명**을 깐다. 그라운딩(웹 검색)이
     * 아직 안 돌았거나 완전히 실패해도 카드가 빈 채로 게시되지 않는다. 그라운딩이
     * 성공하면 enrich-structure가 이 enrichment를 실측 요약으로 통째로 교체한다.
     * enrichment는 `checkPage`·검증 4축 밖의 부가 데이터라 계약에 영향이 없다.
     */
    if (hasEnrichTargets(cd)) page.enrichment = baselineEnrichment(cd)
    c.page = page
  },

  'page-contract-check': (c) => {
    const page = need(c.page, 'page-contract-check', 'page_content')
    const cd = need(c.cd, 'page-contract-check', 'confirmed_data')
    c.errors.push(...checkPage(page, new Set(c.materials.imageSlots.map((r) => r.slot)), cd))
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

  /* ── validator-agent ──────────────────────────────────────── */

  /**
   * 3차 교차 대조 — **AI 0회**(이전에는 `kind: ai`였다).
   *
   * 두 콘텐츠 모델이 같은 `source` 경로를 쓰므로 그것을 조인 키로 값을 맞댄다.
   * 판정을 `verdict`에도 적는다 — `validator-agent`가 AI 검증 3종과 **같은
   * 갈래**로 처리하게 하기 위해서다(항목이 없는 `fail`은 실패로 세지 않는다).
   */
  'consistency-check': (c) => {
    const b = need(c.p.brochure_content as BrochureContent | null, 'consistency-check', 'brochure_content')
    const page = need(c.p.page_content as PageContent | null, 'consistency-check', 'page_content')
    const items = checkConsistency(b, page)
    c.items.push(...items)
    c.verdict = items.length > 0 ? 'fail' : 'pass'
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

    /**
     * 2.8에서 서술 필드가 넓어졌다(명령서 ⑥) — 일차 서술·apply 문구에 더해
     * AI가 계획에 쓴 `highlight.문구들`·`cta.제목/본문`·`spotlight.본문`도 본다.
     * 이 셋은 `c.plan`에 있다(값이 아니라 서술이므로 AI가 직접 쓴 필드다).
     */
    const 계획서술: [string, string][] = (c.plan ?? []).flatMap((b, i) => {
      const out: [string, string][] = []
      if (Array.isArray(b.문구들)) b.문구들.forEach((s, j) => out.push([`blocks[${i}].문구들[${j}]`, String(s)]))
      if (typeof b.제목 === 'string' && b.제목) out.push([`blocks[${i}].제목`, b.제목])
      if (typeof b.본문 === 'string' && b.본문) out.push([`blocks[${i}].본문`, b.본문])
      return out
    })

    const 서술: [string, string][] = args.target === 'page'
      ? [
          ...[...need(c.expanded, 'memo-leak-check', '확장 서술').entries()]
            .map(([day, text]) => [`days[${day}].text`, text] as [string, string]),
          ['apply.제목', need(c.apply, 'memo-leak-check', 'apply 문구').제목],
          ['apply.안내문구', need(c.apply, 'memo-leak-check', 'apply 문구').안내문구],
          ...계획서술,
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
