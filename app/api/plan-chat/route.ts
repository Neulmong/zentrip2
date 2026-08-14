import { NextResponse, type NextRequest } from 'next/server'
import { badRequest, serverError } from '@/lib/http'
import { runPlanChat, type ChatMessage } from '@/lib/harness/chat'

/** AI 1회를 쓰는 라우트다(§4.2 · Task 1). */
export const maxDuration = 60

/**
 * Task 1 — AI 역질문 챗봇 (`plan-chat`). **AI 1회 / 대화 한 턴.**
 *
 * 대화 이력을 클라이언트가 매 요청에 싣는다(서버 무상태). 상품 행을 만들지 않고
 * DB에 쓰지 않는다 — `plan-draft`와 같은 상태 기계 밖 라우트다. 라우트는 요청을
 * 읽고 하네스를 한 번 부를 뿐이다(규약 R1).
 *
 * 인증은 `proxy.ts`가 `/api/*`에 건다.
 */

const MAX_MESSAGES = 40

/** 신뢰할 수 없는 입력을 `ChatMessage[]`로 정제한다 */
function parseMessages(v: unknown): ChatMessage[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const out: ChatMessage[] = []
  for (const m of v.slice(-MAX_MESSAGES)) {
    const role = (m as { role?: unknown })?.role
    const content = (m as { content?: unknown })?.content
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
      out.push({ role, content })
    }
  }
  // 첫 발화는 반드시 사용자여야 대화가 성립한다
  return out.length > 0 && out[0].role === 'user' ? out : null
}

export async function POST(req: NextRequest) {
  let body: { messages?: unknown }
  try {
    body = await req.json()
  } catch {
    return badRequest({ messages: '요청 본문을 읽을 수 없습니다.' })
  }

  const messages = parseMessages(body.messages)
  if (!messages) {
    return badRequest({ messages: '대화 내용을 입력해 주세요.' })
  }

  try {
    const outcome = await runPlanChat(messages)

    // AI 실패는 §4.3 정상 경로 — 카운터 없이 클라이언트가 같은 요청을 다시 보낸다
    if (outcome.kind === 'ai_fail') {
      return NextResponse.json(
        { reason: 'retry', retry_after_ms: outcome.retryAfterMs ?? 0 },
        { status: 409 },
      )
    }

    return NextResponse.json(outcome.result, { status: 200 })
  } catch (e) {
    // 배선 오류(등록되지 않은 스킬·예산 초과)는 여기로 온다 — 재호출로 낫지 않는다
    return serverError(`대화 처리 실패: ${(e as Error).message}`)
  }
}
