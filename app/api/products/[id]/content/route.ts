import { type NextRequest } from 'next/server'
import { db } from '@/lib/supabase'
import { loadProduct, updateProduct } from '@/lib/orchestrator'
import { checkPrecondition } from '@/lib/policy'
import { appendLog } from '@/lib/logging'
import { badRequest, conflict, notFound, ok, serverError } from '@/lib/http'
import { diffSections, validateEdit, type EditRecord } from '@/lib/edit-contract'
import type { PageContent } from '@/lib/pipeline/page'
import type { ProductRow, ProductStatus } from '@/lib/types'

export const maxDuration = 60

/**
 * §14.4 #10 — `PATCH /api/products/{id}/content`. **AI 0회.**
 *
 * ## §10.3이 정한 저장 순서를 그대로 따른다
 *
 *   1. 길이 계약 검사 → 위반 시 **400, 저장하지 않는다**
 *   2. `page_content` 갱신
 *   3. `human_edited = true`
 *   4. `draft` → `reviewing`. `published`·`unpublished`·`reviewing`은 유지
 *   5. 변경된 섹션마다 `edit_history` 기록
 *   6. `execution_logs`에 `content_edited` (`category = lifecycle`)
 *   7. `form_input`·`confirmed_data`·`validation_snapshot`·`attempt_no`는 건드리지 않는다
 *
 * ## 검증 스냅샷을 갱신하지 않는 이유 (§10.4·§16.2)
 *
 * AI 검증은 §11.4의 기준 시점에 고정되고 **편집 이후 재검증하지 않는다.**
 * 편집으로 배지를 다시 계산하면 「AI가 검증한 문장」과 「사람이 고친 문장」의
 * 경계가 사라진다. 편집분의 사실 정확성은 기획자 책임이며, 그 사실을
 * `human_edited` 배지가 화면에 남긴다.
 *
 * ## 대체 텍스트를 여기서 함께 받는 근거
 *
 * §10.2는 편집 가능 범위에 **대체 텍스트**를 명시하는데, 그 값은
 * `page_content`가 아니라 `product_images.alt`에 있고 §14.4 표에 전용 라우트가
 * 없다. 편집기의 저장 경로는 이 라우트 하나뿐이므로 여기서 함께 받는다.
 * §10.3 7항이 「건드리지 않는다」고 못박은 4개 컬럼과는 무관하다.
 */

interface Body {
  /** §16.1.1 — 클라이언트가 **읽은 시점**의 값. 없으면 400이다(아래 주석 참조) */
  updated_at?: string
  page_content?: unknown
  /** `product_images.id` → 대체 텍스트 (§10.2·§17.2) */
  image_alts?: Record<string, string>
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

  const detail = checkPrecondition('content', p)
  if (detail) return conflict({ reason: 'precondition', detail })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return badRequest({ _: '본문을 읽을 수 없습니다.' })
  }

  /* ── §16.1.1 낙관적 잠금 ───────────────────────────────────────
   * 「쓰기 라우트는 클라이언트가 읽은 시점의 `updated_at`을 함께 보낸다」.
   *
   * 파이프라인 라우트들은 요청 안에서 읽고 곧바로 쓰므로 조건부 UPDATE만으로
   * 충분하지만, 편집기는 다르다 — 사람이 편집 화면을 열어둔 채 10분을 보내는
   * 동안 다른 사람이 저장할 수 있다. 그 창을 덮으려면 **화면을 연 시점의 값**을
   * 기준으로 삼아야 한다. 없이 보내면 「마지막 저장이 이긴다」가 아니라
   * 「먼저 연 사람이 남의 편집을 조용히 지운다」가 된다.
   * ──────────────────────────────────────────────────────────── */
  if (typeof body.updated_at !== 'string' || !body.updated_at) {
    return badRequest({ _: '편집 시작 시점(updated_at)이 없습니다. 화면을 새로고침해 주세요.' })
  }
  if (body.updated_at !== p.updated_at) return conflict({ reason: 'stale' })

  const before = p.page_content as PageContent | null
  if (!before) return conflict({ reason: 'precondition', detail: 'page_content가 없습니다.' })

  /* ── 참조 가능한 이미지 ─────────────────────────────────────── */
  const { data: imageRows, error: imgErr } = await db()
    .from('product_images').select('id, slot').eq('product_id', p.id)
  if (imgErr) return serverError(`이미지 조회 실패: ${imgErr.message}`)

  const imageIds = new Set((imageRows ?? []).map((r) => String(r.id)))
  const slots = new Set((imageRows ?? []).map((r) => String(r.slot)))

  /* ── ① 검사 — 위반 시 400, 행은 그대로 둔다 (§10.3 1항) ───── */
  const { errors, content } = validateEdit(body.page_content, { before, imageIds, slots })
  if (!content) return badRequest(errors)

  const altErrors = checkAlts(body.image_alts, imageIds)
  if (altErrors) return badRequest(altErrors)

  const records = diffSections(before, content)
  if (records.length === 0 && !body.image_alts) {
    // 바뀐 게 없으면 이력·로그를 남기지 않는다. 저장 버튼을 두 번 눌렀다고
    // 같은 행이 쌓이면 이력이 근거가 되지 못한다.
    return ok({ current_step: p.current_step, status: p.status, updated_at: p.updated_at, edited: 0 })
  }

  /* ── ② 이력을 먼저 넣고, 상품 갱신이 실패하면 되돌린다 ────────
   * §16.1.1은 「`page_content` 갱신 + `human_edited` + 상태 전이 + `edit_history`」를
   * 한 트랜잭션으로 묶으라고 규정한다. Supabase 클라이언트는 여러 테이블을
   * 한 트랜잭션으로 묶지 못하므로, **되돌릴 수 있는 쪽을 먼저** 실행하고
   * 실패 시 보상 삭제한다. 커밋 지점은 `products`의 조건부 UPDATE 한 번이다.
   *
   * 순서를 뒤집으면(상품 먼저) 이력 없는 편집이 확정돼 §10.3 5항을 어긴다.
   * ──────────────────────────────────────────────────────────── */
  let historyIds: number[] = []
  if (records.length > 0) {
    const { data, error } = await db().from('edit_history')
      .insert(records.map((r: EditRecord) => ({
        product_id: p.id, action: r.action, section_id: r.section_id,
        before: r.before, after: r.after,
      })))
      .select('id')
    if (error) return serverError(`편집 이력 기록 실패: ${error.message}`)
    historyIds = (data ?? []).map((r) => Number(r.id))
  }

  const rollbackHistory = async () => {
    if (historyIds.length > 0) {
      await db().from('edit_history').delete().in('id', historyIds).then(() => {}, () => {})
    }
  }

  /* ── ③ 커밋 — 조건부 UPDATE 한 번 (§10.3 2·3·4항) ─────────── */
  const patch: Partial<ProductRow> = {
    page_content: content,
    human_edited: true,
    status: nextStatus(p.status),
  }

  let updated
  try {
    updated = await updateProduct(p, patch)
  } catch (e) {
    await rollbackHistory()
    return serverError((e as Error).message)
  }
  if (!updated.ok) {
    await rollbackHistory()
    return conflict({ reason: 'stale' })
  }

  /* ── ④ 대체 텍스트 (§10.2) ────────────────────────────────────
   * 여기부터의 실패는 되돌리지 않는다. 본문 저장은 확정됐고, 대체 텍스트는
   * 다시 저장하면 회복된다. 대신 조용히 넘기지 않고 응답과 로그에 남긴다.
   * ──────────────────────────────────────────────────────────── */
  let altWarning: string | null = null
  const alts = Object.entries(body.image_alts ?? {})
  for (const [imageId, alt] of alts) {
    const { error } = await db().from('product_images')
      .update({ alt: alt.trim() }).eq('id', imageId).eq('product_id', p.id)
    if (error) { altWarning = `대체 텍스트 저장에 실패했습니다: ${error.message}`; break }
  }

  /* ── ⑤ 로그 (§10.3 6항) — 트랜잭션 밖이다(§16.1.1) ─────────── */
  await appendLog({
    execution_id: p.execution_id,
    product_id: p.id,
    category: 'lifecycle',
    step: 'content_edited',
    attempt_no: p.attempt_no,
    retry_index: 0,
    // 편집은 검증이 아니다 — 통과/반려로 적을 수 있는 판정이 없다(§5.4)
    verdict: '-',
    status: updated.row.status,
    input: { updated_at: body.updated_at, alt_count: alts.length },
    output: {
      // 본문 전체가 아니라 **무엇이 바뀌었는지**만 남긴다. 편집 1회에 페이지
      // 전문을 두 벌씩 적으면 로그가 산출물 저장소가 된다 — 그 역할은
      // edit_history가 맡는다(§5.6).
      changes: records.map((r) => ({ action: r.action, section_id: r.section_id })),
      status_from: p.status, status_to: updated.row.status,
      ...(altWarning ? { alt_warning: altWarning } : {}),
    },
  })

  return ok({
    current_step: updated.row.current_step,
    status: updated.row.status,
    // 이어서 저장하려면 새 기준 시점이 필요하다(§16.1.1)
    updated_at: updated.row.updated_at,
    human_edited: true,
    edited: records.length,
    ...(altWarning ? { alt_warning: altWarning } : {}),
  })
}

/**
 * §10.3 4항 — `draft`만 전이한다.
 *
 * `published`를 `reviewing`으로 되돌리면 공개 중인 페이지가 조용히 내려간다.
 * 게시 중단은 §12.3의 명시적 조작(#13)이지 편집의 부수 효과가 아니다.
 */
function nextStatus(s: ProductStatus): ProductStatus {
  return s === 'draft' ? 'reviewing' : s
}

function checkAlts(
  alts: Record<string, string> | undefined, imageIds: Set<string>,
): Record<string, string> | null {
  if (!alts) return null
  const errors: Record<string, string> = {}
  for (const [id, alt] of Object.entries(alts)) {
    if (!imageIds.has(id)) { errors[`alt.${id}`] = '이 상품의 이미지가 아닙니다.'; continue }
    // §17.2 — 모든 이미지에 대체 텍스트. 빈 값으로 지우는 것을 막는다.
    if (typeof alt !== 'string' || !alt.trim()) errors[`alt.${id}`] = '대체 텍스트는 비울 수 없습니다.'
    else if (alt.trim().length > 120) errors[`alt.${id}`] = '대체 텍스트는 120자를 넘을 수 없습니다.'
  }
  return Object.keys(errors).length > 0 ? errors : null
}
