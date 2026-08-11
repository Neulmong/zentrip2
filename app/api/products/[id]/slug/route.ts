import { type NextRequest } from 'next/server'
import { db } from '@/lib/supabase'
import { loadProduct, updateProduct } from '@/lib/orchestrator'
import { checkPrecondition } from '@/lib/policy'
import { appendLog } from '@/lib/logging'
import { badRequest, conflict, notFound, ok, serverError } from '@/lib/http'
import { isValidSlug } from '@/lib/pipeline/slug'
import type { ProductRow } from '@/lib/types'

export const maxDuration = 60

/**
 * §14.4 #11 — `PATCH /api/products/{id}/slug`. **AI 0회.**
 *
 * ## `draft` / `reviewing`에서만 바꿀 수 있다 (§12.1)
 *
 * 「**게시 후 불변** — `published`로 전이한 시점부터 변경 불가. 이후 행사명을
 * 수정해도 URL은 유지된다」. 공개된 주소가 바뀌면 이미 배포된 링크·QR이
 * 전부 죽는다. `unpublished`도 막는다 — 게시 중단은 되돌릴 수 있는 상태이고,
 * 그 사이에 주소를 갈아끼우면 재게시 후 옛 링크가 깨진 채로 살아난다.
 *
 * ## 중복은 400이 아니라 409 `slug_conflict`다 (§14.6)
 *
 * 입력 자체는 규칙에 맞고 **다른 상품이 먼저 쓰고 있을 뿐**이다. 클라이언트는
 * 폼 오류를 표시하는 게 아니라 다른 slug로 재요청한다.
 */

interface Body {
  slug?: string
  /** §16.1.1 — 클라이언트가 읽은 시점의 값 */
  updated_at?: string
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let p: ProductRow | null
  try {
    p = await loadProduct(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')

  const detail = checkPrecondition('slug', p)
  if (detail) return conflict({ reason: 'precondition', detail })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return badRequest({ _: '본문을 읽을 수 없습니다.' })
  }

  if (typeof body.updated_at !== 'string' || !body.updated_at) {
    return badRequest({ _: '편집 시작 시점(updated_at)이 없습니다. 화면을 새로고침해 주세요.' })
  }
  if (body.updated_at !== p.updated_at) return conflict({ reason: 'stale' })

  const slug = (body.slug ?? '').trim().toLowerCase()
  if (!isValidSlug(slug)) {
    return badRequest({
      slug: '영문 소문자·숫자·하이픈만 쓸 수 있습니다(1~80자). 한글·공백·특수문자는 넣을 수 없습니다.',
    })
  }
  if (slug === p.slug) {
    return ok({ current_step: p.current_step, slug, updated_at: p.updated_at, changed: false })
  }

  /* ── 중복 확인 ─────────────────────────────────────────────────
   * 여기서 통과해도 커밋까지의 사이에 남이 채갈 수 있다. 그래서 확인은
   * **거절을 빨리 돌려주기 위한 것**이고, 진짜 보증은 DB의 UNIQUE 제약이다
   * (§16.1.1 「slug 발급 경쟁」). 아래에서 23505를 같은 409로 접는다.
   * ──────────────────────────────────────────────────────────── */
  const { data: taken, error: selErr } = await db()
    .from('products').select('id').eq('slug', slug).maybeSingle()
  if (selErr) return serverError(`slug 조회 실패: ${selErr.message}`)
  if (taken) return conflict({ reason: 'slug_conflict' })

  const beforeSlug = p.slug

  let updated
  try {
    updated = await updateProduct(p, { slug })
  } catch (e) {
    // UNIQUE 위반 — 확인과 커밋 사이에 다른 요청이 같은 slug를 가져갔다.
    // 접미사를 자동으로 올리지 않는다: 사람이 직접 고른 주소를 말없이
    // `-2`로 바꾸면 화면에 표시된 것과 실제 주소가 달라진다(§12.1의
    // 접미사 규칙은 **자동 발급** 경로에만 해당한다).
    if (/23505|duplicate key/i.test((e as Error).message)) {
      return conflict({ reason: 'slug_conflict' })
    }
    return serverError((e as Error).message)
  }
  if (!updated.ok) return conflict({ reason: 'stale' })

  await appendLog({
    execution_id: p.execution_id,
    product_id: p.id,
    category: 'lifecycle',
    step: 'slug_changed',
    attempt_no: p.attempt_no,
    retry_index: 0,
    verdict: '-',
    status: updated.row.status,
    input: { from: beforeSlug },
    output: { to: slug },
  })

  return ok({
    current_step: updated.row.current_step,
    slug,
    updated_at: updated.row.updated_at,
    changed: true,
  })
}
