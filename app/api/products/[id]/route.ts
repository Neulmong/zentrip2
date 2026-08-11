import { NextResponse, type NextRequest } from 'next/server'
import { loadProduct } from '@/lib/orchestrator'
import { notFound, serverError } from '@/lib/http'
import type { ProductStatusResponse } from '@/lib/status-view'

export const maxDuration = 60

/**
 * §14.4 #9 — `GET /api/products/{id}`. **AI 0회. 시작 조건 없음(§14.5).**
 *
 * 「상태·단계·검증 결과 조회(새로고침 복귀용)」. 쓰임새는 두 곳이다.
 *
 *   1. §14.6 — `409 {reason: "precondition"}` 또는 `stale`을 받은 클라이언트는
 *      **재호출하지 않고** 이 API로 현재 상태를 다시 읽어 화면을 §15.1 표에 맞춘다.
 *   2. §15.1.1 — `generating`에서 탭을 닫았다 돌아왔을 때, `current_step`으로
 *      어느 라우트부터 재개할지 판단한다.
 *
 * 시작 조건이 없는 이유: 조건을 걸면 「지금 무슨 상태인지 몰라서 물어보는」
 * 상황에서 거절당한다. 이 API는 상태를 **바꾸지 않으므로** 막을 이유도 없다.
 *
 * 산출물 본문을 싣지 않는 근거는 `ProductStatusResponse` 주석 참조.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let p
  try {
    p = await loadProduct(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')

  const body: ProductStatusResponse = {
    id: p.id,
    execution_id: p.execution_id,
    status: p.status,
    current_step: p.current_step,
    attempt_no: p.attempt_no,
    retry_counts: p.retry_counts,
    slug: p.slug,
    human_edited: p.human_edited,
    publish_override_at: p.publish_override_at,
    failure_reason: p.failure_reason,
    published_at: p.published_at,
    // §16.1.1 조건부 갱신 — `stale` 409를 받은 클라이언트가 최신 값을 잡는 유일한 경로
    updated_at: p.updated_at,
    validation_snapshot: p.validation_snapshot,
  }

  return NextResponse.json(body, { status: 200 })
}
