import type { NextRequest } from 'next/server'
import { runAgent } from '@/lib/harness/run'

export const maxDuration = 60

/**
 * Step 07 — 3차 검증 + draft 등록 (§9.5 ③). **AI 1회.**
 *
 * 배선은 `.claude/harness/manifest.json`의 `validate-consistency`가 갖는다 —
 * `validator-agent` · 스킬 `consistency-check`.
 *
 * 1·2차가 모두 통과하면 3차는 논리적으로 통과해야 한다(둘 다 `form_input`과
 * 일치하므로). 따라서 3차는 사실정보 재확인이 아니라 **교차 검증·회귀 감지**다.
 *
 * **2차 실패 시 이 라우트는 호출되지 않는다**(§11.1). 시작 조건이 `axis_2 = pass`다.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return runAgent('validate-consistency', { req, productId: id })
}
