import { NextResponse, type NextRequest } from 'next/server'
import { loadProduct } from '@/lib/orchestrator'
import { badRequest, notFound, serverError } from '@/lib/http'
import { runEnrichSearch } from '@/lib/harness/enrichment'
import type { ConfirmedData } from '@/lib/pipeline/normalize'
import type { ProductRow } from '@/lib/types'

/** AI 1회(그라운딩)를 쓰는 라우트다(§4.2). */
export const maxDuration = 60

/**
 * Task 2 — place-enrichment **1단계 (검색)**. AI 1회(googleSearch 그라운딩).
 *
 * 상태 기계 밖 선택 보강이다(§7 · `plan-draft`식). 상품 상태를 바꾸지 않고 DB에도
 * 쓰지 않는다 — 검색 텍스트와 출처를 **클라이언트에 돌려주고**, 2단계
 * (`enrich-structure`)가 그것을 받아 구조화·저장한다. 두 호출로 나눈 이유는
 * 그라운딩과 responseSchema를 한 호출에서 병용할 수 없기 때문이다(probe-grounding 실측).
 *
 * 인증은 `proxy.ts`가 `/api/*`에 건다. 라우트는 하네스를 한 번 부를 뿐이다(R1).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let p: ProductRow | null
  try {
    p = await loadProduct(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')
  if (!p.confirmed_data) {
    return badRequest({ _: '보강할 확정 데이터가 없습니다. 먼저 상품을 생성해 주세요.' })
  }

  try {
    const outcome = await runEnrichSearch(p.confirmed_data as ConfirmedData)

    if (outcome.kind === 'no_targets') {
      return badRequest({ _: '보강할 장소(숙소·상점)가 없습니다.' })
    }
    // AI 실패는 §4.3 정상 경로 — 카운터 없이 클라이언트가 이 라우트를 재호출한다.
    if (outcome.kind === 'ai_fail') {
      return NextResponse.json(
        { reason: 'retry', retry_after_ms: outcome.retryAfterMs ?? 0 },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { grounded_text: outcome.text, sources: outcome.sources },
      { status: 200 },
    )
  } catch (e) {
    // 배선 오류(등록되지 않은 스킬·예산 초과)는 여기로 온다 — 재호출로 낫지 않는다
    return serverError(`검색 실패: ${(e as Error).message}`)
  }
}
