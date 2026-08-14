import type { NextRequest } from 'next/server'
import { runAgent } from '@/lib/harness/run'

export const maxDuration = 60

/**
 * Step 05 — 페이지 생성 + slug 발급 (§9.5 ①). **AI 1회.**
 *
 * 배선은 `.claude/harness/manifest.json`의 `page`가 갖는다 —
 * `web-builder-agent` · 스킬 체인 6개 · 재료 2종(`image_slots`·`used_slugs`) ·
 * **진입 전이**(`brochure_ready → generating` + 카운터 초기화, §14.5 #5).
 *
 * 진입 전이가 라우트에 있던 코드였다. 매니페스트의 `entry`가 그것을 선언하고
 * `runAgent`가 수행한다 — 라우트가 상태를 직접 바꾸지 않는다(규약 R1).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runAgent('page', { req, productId: id })
}
