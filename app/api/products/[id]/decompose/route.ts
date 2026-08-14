import type { NextRequest } from 'next/server'
import { runAgent } from '@/lib/harness/run'

export const maxDuration = 60

/**
 * Step 02 — 정규화 · 일차 분해 · 0차 검증 (§8.2). **AI 1회.**
 *
 * 배선은 `.claude/harness/manifest.json`의 `decompose`가 갖는다 —
 * 에이전트(`intake-agent`)·스킬 체인 4개·단계명·카운터·AI 예산 전부.
 * 무엇이 어떤 순서로 실행되는지 알고 싶으면 매니페스트를 읽는다(규약 R1·R5).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runAgent('decompose', { req, productId: id })
}
