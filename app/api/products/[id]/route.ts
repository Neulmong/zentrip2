import { NextResponse, type NextRequest } from 'next/server'
import { db, STORAGE_BUCKET } from '@/lib/supabase'
import { loadProduct } from '@/lib/orchestrator'
import { appendLog } from '@/lib/logging'
import { conflict, notFound, ok, serverError } from '@/lib/http'
import { deleteGate, type ProductStatusResponse } from '@/lib/status-view'

export const maxDuration = 60

/**
 * §14.4 #9 — `GET /api/products/{id}`. **AI 0회. 시작 조건 없음(§14.5).**
 *
 * 「상태·단계·검증 결과 조회(새로고침 복귀용)」. 쓰임새는 두 곳이다.
 *
 *   1. §14.6 — `409 {reason: "precondition"}` 또는 `stale`을 받은 클라이언트는
 *      **재호출하지 않고** 이 API로 현재 상태를 다시 읽어 화면을 §15.1 표에 맞춘다.
 *   2. §15.1.1 — `generating`에서 탭을 닫았다 돌아왔을 때, `current_step`으로
 *      어느 라우트부터 재개할지 판단한다.
 *
 * 시작 조건이 없는 이유: 조건을 걸면 「지금 무슨 상태인지 몰라서 물어보는」
 * 상황에서 거절당한다. 이 API는 상태를 **바꾸지 않으므로** 막을 이유도 없다.
 *
 * 산출물 본문을 싣지 않는 근거는 `ProductStatusResponse` 주석 참조.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let p
  try {
    p = await loadProduct(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')

  const body: ProductStatusResponse = {
    id: p.id,
    execution_id: p.execution_id,
    status: p.status,
    current_step: p.current_step,
    attempt_no: p.attempt_no,
    retry_counts: p.retry_counts,
    slug: p.slug,
    human_edited: p.human_edited,
    publish_override_at: p.publish_override_at,
    failure_reason: p.failure_reason,
    published_at: p.published_at,
    // §16.1.1 조건부 갱신 — `stale` 409를 받은 클라이언트가 최신 값을 잡는 유일한 경로
    updated_at: p.updated_at,
    validation_snapshot: p.validation_snapshot,
  }

  return NextResponse.json(body, { status: 200 })
}

/**
 * §14.4 #18 — `DELETE /api/products/{id}`. **AI 0회.**
 *
 * 삭제가 없으면 실패한 상품과 그 이미지가 영구히 쌓인다(§12.4).
 *
 * ## 「단일 트랜잭션」이 DELETE 한 문장이다
 *
 * §12.4는 삭제 범위를 단일 트랜잭션으로 처리하라고 규정한다. 애플리케이션에서
 * 여러 표를 순서대로 지우면 중간 실패 시 반쪽 삭제가 남는데, 스키마의 FK가
 * 그 일을 대신한다 — `products` 한 행을 지우면 같은 문장 안에서
 * `product_images`·`edit_history`는 `cascade`로 함께 사라지고,
 * `execution_logs`·`abnormality_flags`는 `set null`로 **남는다**(§5.4·§5.5).
 * 그래서 이 라우트는 표를 하나만 건드린다.
 *
 * ## Storage는 커밋 후에 지우고, 실패해도 성공으로 확정한다
 *
 * §12.4의 규정이다. 파일 삭제를 트랜잭션에 넣을 방법이 없고, 파일이 남는 것은
 * 고아 파일일 뿐이지만 DB 삭제가 되돌려지는 것은 「지웠는데 목록에 있다」가 된다.
 *
 * ## `published`는 여기서 막는다
 *
 * 공개 중인 URL이 갑자기 사라지는 것을 막기 위해 §12.4가 금지한 유일한 상태다.
 * `generating`은 반대로 **삭제 가능**하다 — 진행 주체가 사라진 상품을 정리하는
 * 것이 이 기능의 주 용도다(§15.1.1).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let p
  try {
    p = await loadProduct(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')

  // §16.1.1 — 다른 사람이 그 사이 게시했을 수 있다. 본문이 있을 때만 검사한다.
  const body: { updated_at?: string } = await req.json().catch(() => ({}))
  if (typeof body.updated_at === 'string' && body.updated_at !== p.updated_at) {
    return conflict({ reason: 'stale' })
  }

  const { count: applications, error: countError } = await db()
    .from('applications').select('*', { count: 'exact', head: true }).eq('product_id', p.id)
  if (countError) return serverError(`신청 내역 확인 실패: ${countError.message}`)

  const gate = deleteGate({ status: p.status, hasApplications: (applications ?? 0) > 0 })
  if (!gate.ok) return conflict({ reason: 'precondition', detail: gate.detail })

  /*
   * 지울 파일 목록을 **삭제 전에** 읽는다. `product_images`는 cascade로 함께
   * 사라지므로 뒤에 읽으면 경로를 알 수 없다. §12.4는 `{product_id}/` 접두사
   * 일괄 삭제를 규정하지만, 실제 경로를 갖고 지우면 접두사 규칙이 바뀌어도 맞는다.
   */
  const { data: images } = await db()
    .from('product_images').select('storage_path').eq('product_id', p.id)
  const paths = (images ?? []).map((i: { storage_path: string }) => i.storage_path)

  const { error: deleteError } = await db().from('products').delete().eq('id', p.id)
  if (deleteError) {
    // `on delete restrict`(applications)가 마지막 방어선이다 — 게이트를 통과했는데
    // 여기서 걸렸다면 그 사이 신청이 들어온 것이다.
    return conflict({
      reason: 'precondition',
      detail: `삭제할 수 없습니다: ${deleteError.message}`,
    })
  }

  /*
   * §5.4는 10개 단계 전부 기록을 요구하고 §12.4는 로그 보존을 규정한다.
   * `product_id`는 `null`이다 — 참조 대상이 사라졌으므로 FK를 만족할 수 없고,
   * `execution_id`가 §14.3 로그 화면에서 이 이력을 묶는 키다.
   */
  await appendLog({
    execution_id: p.execution_id,
    product_id: null,
    category: 'lifecycle',
    step: 'product_deleted',
    attempt_no: p.attempt_no,
    retry_index: 0,
    verdict: '-',
    status: p.status,
    input: { 행사명: p.form_input?.행사정보?.행사명 ?? null, from: p.status, slug: p.slug },
    output: { images: paths.length, deleted_at: new Date().toISOString() },
  })

  // 커밋 후 파일 삭제. 실패는 고아 파일로 남기고 요청은 성공으로 확정한다(§12.4).
  let storageError: string | null = null
  if (paths.length > 0) {
    const { error } = await db().storage.from(STORAGE_BUCKET).remove(paths)
    if (error) {
      storageError = error.message
      console.error('[storage] 고아 파일 발생', p.id, error.message)
    }
  }

  return ok({
    current_step: 'product_deleted',
    deleted: true,
    execution_id: p.execution_id,
    images_removed: storageError ? 0 : paths.length,
    // 숨기지 않는다 — 고아 파일이 생겼다는 사실은 운영자가 알아야 한다
    storage_error: storageError,
  })
}
