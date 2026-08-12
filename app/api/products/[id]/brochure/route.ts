import type { NextRequest } from 'next/server'
import { runAgent } from '@/lib/harness/run'

export const maxDuration = 60

/**
 * Step 03 — 소개서 생성 (§8.3). **AI 1회.**
 *
 * 배선은 `.claude/harness/manifest.json`의 `brochure`가 갖는다 —
 * `content-writer-agent` · 스킬 체인 5개(개요 생성 → 뼈대 조립 → 보호값 검증 →
 * 계약 검사 → 메모 유출 검사).
 *
 * 값 필드는 기계 치환하고 AI는 `overview.핵심일정`만 만든다 —
 * 근거는 `lib/pipeline/brochure.ts` 상단.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runAgent('brochure', { req, productId: id })
}
