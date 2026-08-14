import 'server-only'
import { ai, toLogOutput } from '@/lib/ai'
import { CHAT_SCHEMA, type ChatResult } from '@/lib/pipeline/ai-contracts'
import { agentOf, assertBudget, manifestRouteSpec, promptOf, skillSpec, userPromptOf } from './loader'

/**
 * Task 1 — AI 역질문 챗봇의 실행 계층 — **`runStep` 밖이다**(`draft.ts`와 같은 이유).
 *
 * 대화 한 턴이 AI 1회다(절대원칙 1). 대화 이력은 **클라이언트가** 매 요청에 실어
 * 보내므로 서버는 상태를 저장하지 않는다(서버 무상태). 산출은 form_input이 아니라
 * 메모이고, 그 메모는 `plan-draft`로 넘어가 사람이 폼에서 확정한다(반환각 보장 유지).
 *
 * | 규약 | 어떻게 |
 * |---|---|
 * | R1 | 라우트는 `runPlanChat`만 부른다 |
 * | R3 | AI 실행 **전에** `assertBudget`으로 대조한다 |
 * | R4 | system은 `promptOf`, user 지시문은 `userPromptOf`에서만 온다 |
 * | R5 | 스킬 순서·예산을 `manifest.json`에서 읽는다 |
 *
 * 로그는 남기지 않는다 — 상품 행이 없어 `execution_logs`의 대상이 아니다(`plan-draft`와 같은 한계).
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type ChatOutcome =
  | { kind: 'ok'; result: ChatResult; aiLog: Record<string, unknown> }
  | { kind: 'ai_fail'; errorType: string; retryAfterMs?: number }

/** 이력·발화 길이 상한 — 요청이 무한정 커지지 않게 한다(캐시·지연 보호) */
const MAX_MESSAGES = 24
const MAX_CONTENT = 2000

export async function runPlanChat(messages: ChatMessage[]): Promise<ChatOutcome> {
  const ROUTE = 'plan-chat' as const
  agentOf(ROUTE)
  const spec = manifestRouteSpec(ROUTE)
  const skill = spec.skills[0].name // plan-chat

  // R7·R3 — kind 확인 + 예산 대조를 AI 호출 전에 한다(draft.ts와 같은 규율)
  const sk = skillSpec(skill)
  if (sk.kind === 'spec') throw new Error(`하네스 규약 R7 위반: kind:spec 스킬 «${skill}»이 체인에 있다`)
  if (sk.kind === 'ai') assertBudget(ROUTE, skill, 0)

  const 대화 = messages
    .slice(-MAX_MESSAGES)
    .map((m) => `${m.role === 'user' ? '사용자' : '도우미'}: ${m.content.slice(0, MAX_CONTENT)}`)
    .join('\n')

  const user = `## 대화\n${대화}\n\n${userPromptOf(skill)}`

  const res = await ai().call<ChatResult>({
    system: promptOf(skill),
    user,
    schema: CHAT_SCHEMA,
    effort: skillSpec(skill).effort ?? 'generate',
    label: ROUTE,
  })

  const aiLog = toLogOutput(res)
  if (!res.ok) {
    console.error('[plan-chat] AI 실패', res.errorType, aiLog)
    return { kind: 'ai_fail', errorType: res.errorType, retryAfterMs: res.retryAfterMs }
  }

  /*
   * 방어: `ready`인데 `memo`가 비면 대화가 유실된다 — `ask`로 떨어뜨려 한 번 더
   * 묻게 한다. 스키마가 memo를 required로 두지 못하는 이유는 `ask`엔 memo가 없어서다.
   */
  const data = res.data
  const result: ChatResult = data.mode === 'ready' && data.memo?.trim()
    ? data
    : { mode: 'ask', message: data.message?.trim() || '조금만 더 알려주세요. 어디로 떠나는 여행인가요?' }

  return { kind: 'ok', result, aiLog }
}
