import type { NextRequest } from 'next/server'
import { runAgent } from '@/lib/harness/run'

export const maxDuration = 60

/**
 * Step 06 — 2차 검증 (§9.5 ②). **AI 1회. 주 검증이다.**
 *
 * 배선은 `.claude/harness/manifest.json`의 `validate-page`가 갖는다 —
 * `validator-agent` · 스킬 `fact-check`(`target: page`, `axis: axis_2`) ·
 * 재료 `image_slots`(슬롯·대체 텍스트 대조용).
 *
 * 소진 시 `draft`로 전이하고 `draft_registered`를 이 단계가 기록한다 —
 * 2차가 실패로 확정되면 클라이언트가 ③을 호출하지 않으므로, 아무도
 * 등록하지 않으면 어떻게 임시저장에 도달했는지 알 수 없게 된다(§9.5).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runAgent('validate-page', { req, productId: id })
}
