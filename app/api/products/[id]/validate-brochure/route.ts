import type { NextRequest } from 'next/server'
import { runAgent } from '@/lib/harness/run'

export const maxDuration = 60

/**
 * Step 04 — 1차 검증 (§8.4). **AI 1회.**
 *
 * 배선은 `.claude/harness/manifest.json`의 `validate-brochure`가 갖는다 —
 * `validator-agent` · 스킬 `fact-check`(`target: brochure`, `axis: axis_1`).
 *
 * 기준값은 `form_input`이다 — `confirmed_data`는 0차의 검증 대상이지
 * 기준이 아니다(§11.1).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runAgent('validate-brochure', { req, productId: id })
}
