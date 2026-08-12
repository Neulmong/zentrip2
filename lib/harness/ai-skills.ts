import 'server-only'
import { ai, toLogOutput, type Effort } from '@/lib/ai'
import {
  DECOMPOSE_SCHEMA, EXPAND_SCHEMA, OVERVIEW_SCHEMA, VALIDATION_SCHEMA,
  type DecomposeResult, type ExpandResult, type ValidationResult,
} from '@/lib/pipeline/ai-contracts'
import type { PageContent } from '@/lib/pipeline/page'
import type { ValidationItem } from '@/lib/types'
import { promptOf, skillSpec, userPromptOf } from './loader'
import { partialDaysOf } from './impls'
import type { HarnessContext } from './context'

/**
 * `kind: ai` 스킬 — **라우트당 최대 1개**(규약 R3).
 *
 * ## 시스템 프롬프트는 여기 없다
 *
 * `promptOf(스킬명)`이 `generated/registry.ts`에서 꺼낸다. 그 파일은
 * SKILL.md의 `## 프롬프트` 펜스를 구운 것이다 — 프롬프트를 바꾸려면
 * SKILL.md를 고치고 `npm run build:harness`를 돌린다(규약 R4·R5).
 *
 * ## 여기 남아 있는 것은 user 메시지 조립이다
 *
 * 가변 입력(확정 데이터·폼 입력·생성물)을 문자열로 엮는 코드다. 시스템
 * 프롬프트와 달리 요청마다 달라지므로 문서로 동결할 수 없다. 단 조립 끝에
 * 붙는 **지시문**은 사실상 프롬프트이며, SKILL.md로 옮기는 것이 남은 숙제다
 * (`npm run test:harness`가 ⏳로 보고한다).
 *
 * ## 실패는 던지지 않는다
 *
 * AI 실패는 §4.3의 정상 경로다 — `c.aiFail`에 담고 체인을 멈춘다.
 * 에이전트가 그것을 카운터·409로 옮긴다(R7).
 */

const EFFORT: Record<string, Effort> = { generate: 'generate', validate: 'validate' }

/** 스킬의 AI 라벨. 매니페스트 `args.label`이 있으면 그것이 우선한다 */
function labelOf(skill: string, args: Record<string, unknown>): string {
  return typeof args.label === 'string' ? args.label : skill
}

/** AI 검증 스킬 3종의 공통 후처리 — items 정규화 */
function toItems(res: ValidationResult): ValidationItem[] {
  return (res.items ?? []).map((i) => ({
    검증영역: i.검증영역, source경로: i.source경로 ?? null,
    기준값: i.기준값, 발견값: i.발견값, 사유: i.사유, 위치: i.위치,
  }))
}

export type AiSkillRunner =
  (c: HarnessContext, args: Record<string, unknown>) => Promise<void>

/** 호출 1건을 수행하고 로그·실패를 자료 버스에 적는다. 예산은 `runChain`이 이미 대조했다 */
async function call<T>(
  c: HarnessContext, skill: string, args: Record<string, unknown>, user: string,
  schema: Record<string, unknown>,
): Promise<T | null> {
  const spec = skillSpec(skill)
  const res = await ai().call<T>({
    system: promptOf(skill),
    user,
    schema,
    effort: EFFORT[spec.effort ?? 'generate'],
    label: labelOf(skill, args),
  })

  c.aiCalls += spec.ai
  c.aiLog = toLogOutput(res)

  if (!res.ok) {
    c.aiFail = { skill, errorType: res.errorType, retryAfterMs: res.retryAfterMs }
    c.stop = 'ai_fail'
    return null
  }
  return res.data
}

export const AI_SKILLS: Record<string, AiSkillRunner> = {
  /** 일정 원문 → 일차 배열. 분해 실패 2종은 입력 문제다(§8.2 5항) */
  'itinerary-decomposition': async (c, args) => {
    if (!c.cd) throw new Error('하네스: itinerary-decomposition이 confirmed_data를 요구한다')
    const cd = c.cd

    const data = await call<DecomposeResult>(c, 'itinerary-decomposition', args,
      `여행기간 일수: ${c.days}일\n\n일정원문:\n${cd.행사정보.일정원문}\n\n`
      + `${userPromptOf('itinerary-decomposition')}\n`
      + JSON.stringify({ 식사: cd.식사, 숙박: cd.숙박, 상점: cd.상점 }, null, 2),
      DECOMPOSE_SCHEMA)
    if (!data) return

    c.분해판정 = data.판정
    if (data.판정 !== 'pass') { c.stop = 'input_error'; return }

    c.cd = { ...cd, 행사정보: { ...cd.행사정보, 일정: data.일정 } }
    c.partialDays = partialDaysOf(c)
  },

  /** 소개서 개요 — §8.7에서 `source: "generated"`인 유일한 필드 */
  'intro-content-fill': async (c, args) => {
    if (!c.cd) throw new Error('하네스: intro-content-fill이 confirmed_data를 요구한다')
    const cd = c.cd

    // 비어 있으면 싣지 않는다 — 「기획 메모: (없음)」은 프롬프트만 늘린다.
    const memo = cd.행사정보.기획메모?.trim()
      ? `\n\n## 기획 메모 (어조 참고용 · 인용 금지 · 고객 미노출)\n${cd.행사정보.기획메모}`
      : ''

    const data = await call<{ 핵심일정: string }>(c, 'intro-content-fill', args,
      `${userPromptOf('intro-content-fill')}\n`
      + `여행지: ${cd.행사정보.여행지} / 여행기간: ${cd.행사정보.여행기간}\n`
      + `여행주제: ${cd.행사정보.여행주제}\n\n`
      + cd.행사정보.일정.map((d) => `${d.day}일차: ${d.내용}`).join('\n')
      + memo,
      OVERVIEW_SCHEMA)
    if (!data) return

    c.핵심일정 = data.핵심일정.trim()
  },

  /** 페이지 확장 서술 + 신청 문구 — §9.3의 `generated` 필드 */
  'content-structuring': async (c, args) => {
    if (!c.cd) throw new Error('하네스: content-structuring이 confirmed_data를 요구한다')
    const cd = c.cd

    const data = await call<ExpandResult>(c, 'content-structuring', args,
      `## 일차별 압축 서술 (소개서) — 이것을 확장하라\n`
      + cd.행사정보.일정.map((d) =>
        `${d.day}일차\n  원문근거: ${d.원문근거 || '(없음)'}\n  압축: ${d.내용}`).join('\n')
      + `\n\n## 상품 정보 (신청 안내문구 작성용)\n`
      + `행사명: ${cd.행사정보.행사명} / 여행지: ${cd.행사정보.여행지}\n`
      + `여행기간: ${cd.행사정보.여행기간}\n`
      + `여행주제: ${cd.행사정보.여행주제}\n`
      // 비어 있으면 싣지 않는다 — 프롬프트만 늘린다.
      + (cd.행사정보.기획메모?.trim()
        ? `\n## 기획 메모 (어조 참고용 · 인용 금지 · 고객 미노출)\n${cd.행사정보.기획메모}\n`
        : '')
      + `\n${userPromptOf('content-structuring')}`,
      EXPAND_SCHEMA)
    if (!data) return

    c.expanded = new Map(data.days.map((d) => [d.day, d.text]))
    c.apply = data.apply
  },

  /**
   * 1·2차 사실정보 대조. **기준값은 `form_input`이다**(§11.1).
   * 검사 대상은 `args.target`이 정한다 — 프롬프트는 한 벌을 공유한다.
   */
  'fact-check': async (c, args) => {
    const 기준 = `## 기준값 (form_input)\n${JSON.stringify(c.p.form_input, null, 2)}\n\n`
      + `## 참고 (confirmed_data — 정규화 표기 대조용)\n`
      + `${JSON.stringify(c.p.confirmed_data, null, 2)}\n\n`

    const user = args.target === 'page'
      ? 기준
        + `## 검사 대상 (page_content — 페이지 9개 섹션)\n`
        + `${JSON.stringify(c.p.page_content as PageContent, null, 2)}\n\n`
        + `## 업로드된 이미지 슬롯\n${JSON.stringify(c.materials.imageSlots, null, 2)}\n\n`
        + userPromptOf('fact-check', 'page')
      : 기준
        + `## 검사 대상 (brochure_content — 소개서 8개 섹션)\n`
        + `${JSON.stringify(c.p.brochure_content, null, 2)}\n\n`
        + userPromptOf('fact-check', 'brochure')

    const data = await call<ValidationResult>(c, 'fact-check', args, user, VALIDATION_SCHEMA)
    if (!data) return

    c.verdict = data.판정
    c.items.push(...toItems(data))
  },

}

/*
 * `consistency-check`는 **여기 없다.** `kind: ai` → `kind: mechanical`로 내렸다.
 *
 * 두 콘텐츠 모델이 같은 `source` 경로 문자열을 쓰므로 그것을 조인 키로 기계
 * 대조가 된다(`lib/pipeline/consistency.ts`). AI 의미 대조보다 오히려 엄격하다 —
 * AI는 「대충 같아 보이면」 통과시키지만 기계는 공백 정리 외의 차이를 통과시키지
 * 않는다. 라우트당 AI가 6회에서 **5회**로 줄었다.
 */
