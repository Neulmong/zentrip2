import 'server-only'
import { ai, toLogOutput, type Effort } from '@/lib/ai'
import {
  COMPOSE_SCHEMA, DECOMPOSE_SCHEMA, OVERVIEW_SCHEMA, VALIDATION_SCHEMA,
  type ComposeResult, type DecomposeResult, type ValidationResult,
} from '@/lib/pipeline/ai-contracts'
import { VOCABULARY, TONES, WIDTHS, PADS, EDGES, MEDIAS, ALIGNS } from '@/lib/pipeline/vocabulary'
import { MOODS, BACKGROUNDS, RHYTHMS, SCALES, HEADLINES, ACCENTS } from '@/lib/pipeline/theme'
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
 * 붙는 **지시문**은 사실상 프롬프트이므로 SKILL.md로 옮겨 `userPromptOf(스킬명)`이
 * 꺼내온다 — 시스템 프롬프트와 같은 경로다(규약 R4). `test:harness`가 이 파일과
 * `draft.ts`에서 지시문이 `userPromptOf()`로 들어오는지 검사한다.
 *
 * ## 실패는 던지지 않는다
 *
 * AI 실패는 §4.3의 정상 경로다 — `c.aiFail`에 담고 체인을 멈춘다.
 * 에이전트가 그것을 카운터·409로 옮긴다(R7).
 */

/**
 * 매니페스트의 `effort` 문자열 → `lib/ai`의 `Effort`.
 *
 * `plan`이 여기 있는 이유: 지금 이 파일의 스킬 중에 쓰는 것은 없지만, 빠뜨리면
 * `EFFORT[...]`가 `undefined`를 내고 provider가 추론 깊이 없이 호출된다 —
 * **조용히.** 3종을 다 적어 두면 새 스킬이 어느 값을 써도 그런 일이 없다.
 */
const EFFORT: Record<string, Effort> = {
  generate: 'generate', validate: 'validate', plan: 'plan',
}

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

    /*
     * 참고 값은 **이름만 줄로 넣는다.** 이 호출이 요청 예산에 가장 가깝기 때문이다
     * (실측 22.5초 · CLAUDE.md). 전에는 `숙박`·`상점` 객체를 `JSON.stringify(…, null, 2)`로
     * 통째로 넣었는데, 2.7에서 둘이 **배열**이 되면서 상점이 13곳인 상품에서 이 덩어리만
     * 2000자를 넘겼다 — 그리고 실제로 분해가 3회 연속 타임아웃했다.
     *
     * 이 값들이 필요한 이유는 하나다: 일차 서술에 숙소명·상점명이 등장할 수 있어야 하고
     * (§6.3의 「다른 확정 값」), 그 근거 대조는 **기계가** 한다(`otherValues`).
     * 그러니 AI에게는 이름 목록이면 충분하고 주소·구분·객실타입은 필요 없다.
     */
    const 이름줄 = (label: string, xs: string[]) =>
      (xs.filter(Boolean).length ? `${label}: ${xs.filter(Boolean).join(', ')}\n` : '')

    const data = await call<DecomposeResult>(c, 'itinerary-decomposition', args,
      `여행기간 일수: ${c.days}일\n\n일정원문:\n${cd.행사정보.일정원문}\n\n`
      + `${userPromptOf('itinerary-decomposition')}\n`
      + 이름줄('숙소', cd.숙박.map((s) => s.숙소명))
      + 이름줄('상점', cd.상점.map((s) => s.상점명))
      + `식사: ${cd.식사.식사정보}\n`,
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

  /**
   * 페이지 구성 (spec 2.8 §9.2·§9.3 · 명령서 4-①·⑤). AI가 디자이너가 되어
   * **디자인 스펙(theme) + 블록 계획(blocks) + 서술**을 만든다. 값 필드는 `buildPage`가
   * `confirmed_data`에서 치환하므로 여기 없다(사실정보가 AI를 거치지 않는다).
   *
   * 어휘·재료 표는 여기서 조립하고(gate 산출을 싣는다), **지시 문장은 SKILL.md에서**
   * 온다(규약 R4).
   */
  'content-structuring': async (c, args) => {
    if (!c.cd) throw new Error('하네스: content-structuring이 confirmed_data를 요구한다')
    const cd = c.cd
    const gate = c.gate
    if (!gate) throw new Error('하네스: content-structuring이 block-vocabulary-gate 산출을 요구한다')

    const 어휘표 = gate.available
      .map((t) => `- ${t} (layout: ${VOCABULARY[t].layouts.join('·')})`).join('\n')
    const 금지 = gate.unavailable.length
      ? `\n## 만들지 마라 (재료 없음 — §8.5)\n${gate.unavailable.join(' · ')}\n` : ''
    const refs = gate.spotlightRefs.length
      ? `\n## spotlight 참조 대상\n${gate.spotlightRefs.join(' · ')}\n` : ''

    const data = await call<ComposeResult>(c, 'content-structuring', args,
      `## 쓸 수 있는 블록과 layout\n${어휘표}\n${금지}${refs}`
      + `\n## 스타일 손잡이 (블록마다 지정 · 무효 값은 무시된다)\n`
      + `tone: ${TONES.join('·')} / width: ${WIDTHS.join('·')} / align: ${ALIGNS.join('·')}\n`
      + `pad: ${PADS.join('·')} / edge: ${EDGES.join('·')} / media: ${MEDIAS.join('·')}\n`
      + `\n## 테마(디자인 의도 · 색이 아니라 hue+mood)\n`
      + `hue: 0~359 정수 / mood: ${MOODS.join('·')} / background: ${BACKGROUNDS.join('·')}\n`
      + `headline: ${HEADLINES.join('·')} / accent: ${ACCENTS.join('·')}\n`
      + `rhythm: ${RHYTHMS.join('·')} / scale: ${SCALES.join('·')}\n`
      + `\n## 일차별 압축 서술 (days[].text로 확장하라)\n`
      + cd.행사정보.일정.map((d) =>
        `${d.day}일차\n  원문근거: ${d.원문근거 || '(없음)'}\n  압축: ${d.내용}`).join('\n')
      + `\n\n## 상품 정보 (신청 문구·분위기 참고)\n`
      + `행사명: ${cd.행사정보.행사명} / 여행지: ${cd.행사정보.여행지}\n`
      + `여행기간: ${cd.행사정보.여행기간} / 여행스타일: ${cd.행사정보.여행스타일}\n`
      + `여행주제: ${cd.행사정보.여행주제}\n`
      + (cd.행사정보.기획메모?.trim()
        ? `\n## 기획 메모 (어조 참고용 · 인용 금지 · 고객 미노출)\n${cd.행사정보.기획메모}\n`
        : '')
      + `\n${userPromptOf('content-structuring')}`,
      COMPOSE_SCHEMA)
    if (!data) return

    // 관대한 스키마라 일부가 빠질 수 있다 — 조립이 완결하도록 기본값을 둔다(재시도 소진 방지)
    c.themeSpec = data.theme
    // 히어로 감성 카피 — 있으면 배너에, 없으면 조립이 행사명으로 폴백한다
    c.hero = {
      headline: data.hero?.headline?.trim() ?? '',
      subcopy: data.hero?.subcopy?.trim() ?? '',
    }
    c.plan = Array.isArray(data.blocks) ? data.blocks : []
    c.expanded = new Map((data.days ?? []).map((d) => [d.day, d.text]))
    c.apply = data.apply?.제목 || data.apply?.안내문구
      ? data.apply
      : { 제목: '신청 안내', 안내문구: '아래 양식으로 신청해 주세요. 확인 후 연락드리겠습니다.' }
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
        + `## 검사 대상 (page_content — 페이지 블록)\n`
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
