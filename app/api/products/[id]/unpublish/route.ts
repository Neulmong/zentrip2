import { type NextRequest } from 'next/server'
import { loadProduct, updateProduct } from '@/lib/orchestrator'
import { checkPrecondition } from '@/lib/policy'
import { appendLog } from '@/lib/logging'
import { badRequest, conflict, notFound, ok, serverError } from '@/lib/http'
import type { ProductRow } from '@/lib/types'

export const maxDuration = 60

/**
 * §14.4 #13 — `POST /api/products/{id}/unpublish`. **AI 0회.**
 *
 * ## 접수된 신청은 지우지 않는다 (§12.3)
 *
 * 「`status = unpublished`로 전이한다. `/p/{slug}`는 404를 반환한다. **이미
 * 접수된 신청 데이터는 삭제하지 않는다.** 게시 중단된 상품의 신청 폼은
 * 표시되지 않는다.」 — 상품을 내리는 것과 이미 신청한 고객의 기록을 지우는
 * 것은 다른 일이다. 후자는 §12.4의 명시적 삭제뿐이다.
 *
 * ## `published_at`을 지우지 않는다
 *
 * 「언제 처음 공개됐나」는 중단해도 사실이다. 재게시 시 §12.2가 덮어쓰지
 * 않으므로, 여기서 지우면 그 값을 영구히 잃는다.
 *
 * ## 미충족은 403이 아니라 409 `precondition`이다
 *
 * §14.5는 #13에 `status = published` → 409 `precondition`을 규정한다.
 * #12의 403(게이트)과 다른 코드인 이유: 게이트는 「자격이 없다」이고 이쪽은
 * 「상태가 이미 그게 아니다」라서, 클라이언트가 재조회로 화면을 맞추면 풀린다.
 */

interface Body {
  /** §16.1.1 — 클라이언트가 읽은 시점의 값 */
  updated_at?: string
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let p: ProductRow | null
  try {
    p = await loadProduct(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')

  const detail = checkPrecondition('unpublish', p)
  if (detail) return conflict({ reason: 'precondition', detail })

  const body: Body = await req.json().catch(() => ({}))
  if (typeof body.updated_at !== 'string' || !body.updated_at) {
    return badRequest({ _: '조회 시점(updated_at)이 없습니다. 화면을 새로고침해 주세요.' })
  }
  if (body.updated_at !== p.updated_at) return conflict({ reason: 'stale' })

  let updated
  try {
    updated = await updateProduct(p, { status: 'unpublished' })
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!updated.ok) return conflict({ reason: 'stale' })

  await appendLog({
    execution_id: p.execution_id,
    product_id: p.id,
    category: 'lifecycle',
    step: 'unpublished',
    attempt_no: p.attempt_no,
    retry_index: 0,
    verdict: '-',
    status: 'unpublished',
    input: { slug: p.slug },
    // 신청 데이터를 남겼다는 사실을 기록에 남긴다 — 나중에 「왜 안 지웠나」를 묻지 않게
    output: { published_at_kept: updated.row.published_at, applications_kept: true },
  })

  return ok({
    current_step: updated.row.current_step,
    status: 'unpublished',
    updated_at: updated.row.updated_at,
  })
}
