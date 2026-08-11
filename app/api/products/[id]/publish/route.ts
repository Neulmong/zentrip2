import { type NextRequest } from 'next/server'
import { loadProduct, updateProduct } from '@/lib/orchestrator'
import { appendLog } from '@/lib/logging'
import { badRequest, conflict, forbidden, notFound, ok, serverError } from '@/lib/http'
import { publishGate } from '@/lib/status-view'
import type { ProductRow } from '@/lib/types'

export const maxDuration = 60

/**
 * §14.4 #12 — `POST /api/products/{id}/publish`. **AI 0회.**
 *
 * ## 게시는 DB 상태값 전환이다 (§4.1)
 *
 * 재빌드·배포 대기가 없다. `status = published`가 되는 순간 `/p/{slug}`가
 * 200을 반환한다 — 게시당 1~3분 지연과 빌드 실패로 시연이 끊기는 것을 피한
 * 결정이다.
 *
 * ## 미통과는 409가 아니라 403이다 (§14.5·§14.6)
 *
 * 「403 게시 게이트 미통과 → 클라이언트는 게시 버튼 비활성 유지」. 409는
 * 「다시 시도하거나 다시 읽어라」는 뜻인데, 게이트 미통과는 **재호출로 풀리지
 * 않는다** — 검증을 다시 돌리거나 책임 게시에 동의해야 한다.
 *
 * ## `published_at`은 최초 게시 때만 기록한다 (§12.2 2항)
 *
 * 재게시(`unpublished → published`)에서 덮어쓰면 「언제 처음 공개됐나」를
 * 알 수 없게 된다. 신청 이력과 대조할 기준 시점이 사라진다.
 */

interface Body {
  /** §11.5 책임 게시 — `verdict = fail`을 게시하려면 명시적 동의가 필요하다 */
  override?: boolean
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

  // 본문이 없어도 동작해야 한다 — 확인이 필요 없는 pass 경로는 빈 POST다.
  const body: Body = await req.json().catch(() => ({}))

  if (typeof body.updated_at !== 'string' || !body.updated_at) {
    return badRequest({ _: '조회 시점(updated_at)이 없습니다. 화면을 새로고침해 주세요.' })
  }
  if (body.updated_at !== p.updated_at) return conflict({ reason: 'stale' })

  const gate = publishGate(
    {
      status: p.status,
      validation_snapshot: p.validation_snapshot,
      human_edited: p.human_edited,
      publish_override_at: p.publish_override_at,
      slug: p.slug,
      hasPageContent: !!p.page_content,
    },
    { override: body.override === true },
  )
  if (!gate.ok) return forbidden(gate.reason)

  const now = new Date().toISOString()

  const patch: Partial<ProductRow> = {
    status: 'published',
    // 최초 게시에만 기록한다(§12.2 2항). 재게시는 덮어쓰지 않는다.
    ...(p.published_at ? {} : { published_at: now }),
    /*
     * 책임 게시의 흔적. **이미 값이 있으면 덮어쓰지 않는다** — 처음 책임을
     * 진 시점이 추적의 기준이고(§11.5 「이력을 남겨 사후 추적」), 재게시마다
     * 갱신하면 그 시점이 사라진다.
     */
    ...(gate.override && !p.publish_override_at ? { publish_override_at: now } : {}),
  }

  let updated
  try {
    updated = await updateProduct(p, patch)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!updated.ok) return conflict({ reason: 'stale' })

  /*
   * 로그 2건. `publish_override`를 `published`와 **따로** 남기는 이유는
   * §11.5가 그렇게 규정하기 때문이고(「`publish_override_at` 기록 +
   * `publish_override` 로그」), 관리자 로그 뷰(§14.3)에서 책임 게시만
   * 골라내려면 별도 `step`이어야 한다.
   */
  if (gate.override) {
    await appendLog({
      execution_id: p.execution_id,
      product_id: p.id,
      category: 'lifecycle',
      step: 'publish_override',
      attempt_no: p.attempt_no,
      retry_index: 0,
      verdict: '-',
      status: 'published',
      input: { verdict: 'fail', human_edited: p.human_edited },
      output: {
        publish_override_at: updated.row.publish_override_at,
        // 무엇을 알고도 게시했는지가 사후 추적의 핵심이다(§11.3)
        failed_items: p.validation_snapshot?.axes
          ? Object.entries(p.validation_snapshot.axes)
              .filter(([, r]) => r?.verdict === 'fail')
              .map(([axis, r]) => ({ axis, count: r?.items.length ?? 0 }))
          : [],
      },
    })
  }

  await appendLog({
    execution_id: p.execution_id,
    product_id: p.id,
    category: 'lifecycle',
    step: 'published',
    attempt_no: p.attempt_no,
    retry_index: 0,
    verdict: '-',
    status: 'published',
    input: { from: p.status, override: gate.override },
    output: { slug: p.slug, published_at: updated.row.published_at, url: `/p/${p.slug}` },
  })

  return ok({
    current_step: updated.row.current_step,
    status: 'published',
    slug: p.slug,
    url: `/p/${p.slug}`,
    published_at: updated.row.published_at,
    override: gate.override,
    updated_at: updated.row.updated_at,
  })
}
