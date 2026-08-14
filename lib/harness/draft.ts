import 'server-only'
import { ai, toLogOutput } from '@/lib/ai'
import { PLAN_SCHEMA, type PlanResult } from '@/lib/pipeline/ai-contracts'
import {
  assembleDraft, checkDraft, FREEFORM_MAX, FREEFORM_MIN, parseFreeform,
  type DraftResult, type FreeformParse,
} from '@/lib/pipeline/freeform'
import type { FormInput } from '@/lib/types'
import { assertBudget, agentOf, manifestRouteSpec, promptOf, skillSpec, userPromptOf } from './loader'

/**
 * §7.5 자연어 초안의 실행 계층 — **`runStep` 밖이다.**
 *
 * ## 왜 `runAgent`를 쓰지 않나
 *
 * `runAgent` → `runStep`은 **기존 상품 행을 전제한다.** 조회, 시작 조건 판정,
 * `updated_at` 조건부 갱신, 재시도 카운터, `execution_logs` append가 전부 그
 * 행에 달려 있다. 초안 라우트는 상품이 **아직 없는** 시점에 호출되므로 그 전제가
 * 하나도 성립하지 않는다. 억지로 통과시키려면 가짜 행을 만들어야 하고, 그러면
 * 초안을 눌렀다 만 상품이 DB에 남는다.
 *
 * ## 그래도 규약은 그대로 지킨다
 *
 * | 규약 | 어떻게 |
 * |---|---|
 * | R1 | 라우트는 `runPlanDraft` 하나만 부른다. 파이프라인 로직이 라우트에 없다 |
 * | R2 | 스킬 3개가 각각 추출·기획·검사 한 가지씩 한다 |
 * | R3 | `ai` 스킬 실행 **전에** `assertBudget`으로 대조한다 |
 * | R4 | system은 `promptOf`, user 지시문은 `userPromptOf`에서만 온다 |
 * | R5 | 체인 순서를 `manifest.json`에서 읽는다. 여기 하드코딩하지 않는다 |
 *
 * ## 로그를 남기지 않는다
 *
 * `execution_logs`·`abnormality_flags`는 둘 다 `product_id`를 요구한다(§5.4·§5.5).
 * 남길 곳이 없으므로 **남기지 않는다.** AI 실패는 응답 코드로만 드러난다 —
 * 이것이 이 라우트에서 받아들인 정직한 한계다(§7.5 실행 예산).
 */

const ROUTE = 'plan-draft' as const

/** 자료 버스. `HarnessContext`와 달리 상품 행이 없다 */
interface DraftContext {
  text: string
  /** 연도 없는 날짜 보완 기준 — 요청 시점의 연도(§7.5). 상품 행이 없어 `created_at`이 없다 */
  baseYear?: number
  /** 사람이 지정한 여행기간 — 직접 고르면 그 값이 이긴다(연도 보완보다 우선) */
  hint?: { 시작: string; 종료: string }
  parsed?: FreeformParse
  plan?: PlanResult
  /** 후보 번호가 실제 값으로 치환된 초안 (`draft-assemble`의 산출물) */
  draft?: FormInput
  result?: DraftResult
  aiCalls: number
  aiLog: Record<string, unknown>
  aiFail?: { skill: string; errorType: string }
}

export type DraftOutcome =
  | { kind: 'ok'; body: DraftResult & { aiLog: Record<string, unknown> } }
  | { kind: 'input_error'; field: string; reason: string }
  | { kind: 'ai_fail'; errorType: string }

/* ════════════════════════════════════════════════════════════════
 * 스킬 러너 3종
 * ════════════════════════════════════════════════════════════════ */

type Runner = (c: DraftContext) => Promise<void>

const SKILLS: Record<string, Runner> = {
  /** 1번 — 메모에서 기계로 알아볼 수 있는 것만 뽑는다 */
  'freeform-parse': async (c) => {
    c.parsed = parseFreeform(c.text, c.baseYear)
  },

  /**
   * 2번 — 일차 배분 + 폼 초안. **이 라우트의 AI 1회를 전부 쓴다.**
   *
   * user 메시지의 데이터 조립만 여기 있고 지시 문장은 SKILL.md에서 온다(R4).
   * 장소 목록을 지시문 **앞**에 두는 이유는 SKILL.md에 적혀 있다 — 목록을 읽은
   * 직후에 「전부 남겨라」를 보게 하는 자리다.
   */
  'trip-planning': async (c) => {
    const p = c.parsed
    if (!p) throw new Error('하네스: trip-planning이 freeform-parse의 결과를 요구한다')

    const 날짜 = c.hint ?? p.날짜
    const 일수 = 날짜
      ? Math.round(
          (Date.parse(`${날짜.종료}T00:00:00Z`) - Date.parse(`${날짜.시작}T00:00:00Z`))
          / 86_400_000,
        ) + 1
      : p.일수

    /*
     * 목록에 **번호와 출처 라벨**을 붙인다. 번호는 AI가 고를 키이고, 출처는
     * 분류 신호다 — 「어느 것이 숙소이고 어느 것이 가게인가」를 이름만으로는
     * 알 수 없는데 기획자가 이미 블록으로 분류해 두었다.
     */
    const user =
      `## 기획자 메모 (원문)\n${c.text}\n\n`
      + `## 장소 목록 (${p.장소후보.length}곳 — 전부 초안에 남아야 한다)\n`
      + (p.장소후보.length > 0
        ? p.장소후보
          .map((c2, i) => `${i}. ${c2.이름}${c2.출처 ? ` [${c2.출처}]` : ''}`)
          .join('\n')
        : '(추출된 장소 없음)')
      + '\n\n## 여행기간\n'
      + (날짜
        ? `${날짜.시작} ~ ${날짜.종료} (${일수}일)`
        : '연도를 읽을 수 없다. 여행기간 두 필드를 빈 문자열로 두어라.')
      + `\n\n${userPromptOf('trip-planning')}`

    const res = await ai().call<PlanResult>({
      system: promptOf('trip-planning'),
      user,
      schema: PLAN_SCHEMA,
      // 매니페스트가 선언한 값을 그대로 쓴다 — 여기 하드코딩하면 문서와 갈린다(R5)
      effort: skillSpec('trip-planning').effort ?? 'plan',
      label: 'plan-draft',
    })

    c.aiCalls += skillSpec('trip-planning').ai
    c.aiLog = toLogOutput(res)

    if (!res.ok) {
      c.aiFail = { skill: 'trip-planning', errorType: res.errorType }
      /*
       * 이 라우트는 `execution_logs`에 남길 수 없다 — 상품 행이 없다(§5.4).
       * 그래서 실패의 유일한 흔적이 서버 로그다. 지우면 409만 남고 왜 실패했는지
       * (타임아웃인지 스키마 위반인지 빈 본문인지) 알 방법이 사라진다.
       */
      console.error('[plan-draft] AI 실패', res.errorType, c.aiLog)
      return
    }

    /*
     * 사람이 날짜를 지정했으면 **그 값이 이긴다.** AI가 빈 문자열로 두거나
     * 다른 값을 넣었더라도 사람이 고른 것이 기준이다 — 여행기간은 일차 수와
     * 이미지 슬롯 수를 결정하므로(§6.2.1) 여기서 어긋나면 폼 전체가 어긋난다.
     */
    c.plan = c.hint
      ? { ...res.data, 여행기간_시작: c.hint.시작, 여행기간_종료: c.hint.종료 }
      : res.data
  },

  /**
   * 3번 — 후보 번호를 실제 이름·주소로 치환한다.
   *
   * **값이 AI를 거치지 않는 지점이다.** AI가 이름·주소를 다시 쓰게 했을 때
   * 카페 13곳에서 `max_tokens`로 실패했고(실측), 그보다 중요하게는 옮기는
   * 과정에서 값이 바뀔 수 있었다. 근거는 SKILL.md에 있다.
   */
  'draft-assemble': async (c) => {
    if (!c.plan || !c.parsed) {
      throw new Error('하네스: draft-assemble이 초안과 추출 결과를 요구한다')
    }
    c.draft = assembleDraft(c.plan, c.parsed)
  },

  /** 4번 — §7.1 검사 + origin 3종 + 누락 목록. 초안을 고치지 않는다 */
  'draft-form-check': async (c) => {
    if (!c.draft || !c.parsed) {
      throw new Error('하네스: draft-form-check가 조립된 초안을 요구한다')
    }
    /*
     * 날짜는 **사람이 고른 값이 이긴다.** `parsed.날짜`만 넘기면 사람이 고른
     * 여행기간이 `planned`로 판정되고(원문에 `2026-11-04`가 없으므로) 사람이
     * 직접 고른 칸에 「AI 초안」 배지가 붙는다.
     */
    c.result = checkDraft(c.draft, c.text, c.parsed.장소후보, {
      날짜: c.hint ?? c.parsed.날짜,
      행사날짜: c.parsed.행사날짜,
    })
  },
}

/* ════════════════════════════════════════════════════════════════
 * 체인 실행
 * ════════════════════════════════════════════════════════════════ */

/**
 * 매니페스트 순서대로 스킬을 실행한다.
 *
 * `runChain`(run.ts)과 나눠 둔 이유: 그쪽은 `HarnessContext`(상품 행·검증 항목·
 * 카운터)에 묶여 있다. 여기서 재사용하려면 그 타입의 절반을 optional로 풀어야
 * 하고, 그러면 **파이프라인 라우트에서도 상품 행이 없을 수 있는 것처럼** 보인다.
 * 40줄을 아끼려고 6개 라우트의 타입 보장을 약하게 만드는 거래는 하지 않는다.
 *
 * 등록되지 않은 이름을 만나면 던진다 — 검사 스킬이 빠진 채 통과하는 것이 가장
 * 위험한 실패다(`runChain`과 같은 판단).
 */
export async function runPlanDraft(input: {
  text: string
  baseYear?: number
  hint?: { 시작: string; 종료: string }
}): Promise<DraftOutcome> {
  const text = (input.text ?? '').trim()

  if (text.length < FREEFORM_MIN) {
    return {
      kind: 'input_error', field: 'text',
      reason: `메모를 ${FREEFORM_MIN}자 이상 적어 주세요. 지금은 ${text.length}자입니다.`,
    }
  }
  if (text.length > FREEFORM_MAX) {
    return {
      kind: 'input_error', field: 'text',
      reason: `메모는 ${FREEFORM_MAX}자를 넘을 수 없습니다. 지금은 ${text.length}자입니다.`,
    }
  }

  // 배선을 양방향으로 확인한다 — 매니페스트의 `agent` 선언에 구속력을 준다
  agentOf(ROUTE)
  const spec = manifestRouteSpec(ROUTE)

  const c: DraftContext = { text, baseYear: input.baseYear, hint: input.hint, aiCalls: 0, aiLog: {} }

  for (const s of spec.skills) {
    const sk = skillSpec(s.name)

    // R7 — kind:spec 스킬은 하네스 바깥을 문서화한다. 체인에서 실행하지 않는다
    if (sk.kind === 'spec') {
      throw new Error(`하네스 규약 R7 위반: kind:spec 스킬 «${s.name}»이 체인에 있다`)
    }
    // R3 — 호출 **전에** 대조한다. 부른 뒤 세면 이미 돈과 25초를 쓴 다음이다
    if (sk.kind === 'ai') assertBudget(ROUTE, s.name, c.aiCalls)

    const run = SKILLS[s.name]
    if (!run) throw new Error(`하네스: 스킬 «${s.name}»의 러너가 draft.ts에 등록되지 않았다`)
    await run(c)

    if (c.aiFail) return { kind: 'ai_fail', errorType: c.aiFail.errorType }
  }

  if (!c.result) throw new Error('하네스: 체인이 끝났는데 초안이 없다')
  return { kind: 'ok', body: { ...c.result, aiLog: c.aiLog } }
}
