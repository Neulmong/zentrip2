import { db } from '@/lib/supabase'
import { loadProduct } from '@/lib/orchestrator'
import { appendLog } from '@/lib/logging'
import { loadApplication } from '@/lib/applications'
import { notFound, ok, serverError } from '@/lib/http'

/**
 * §14.4 #19 — `DELETE /api/applications/{id}`. **인증 필요 · AI 0회.**
 *
 * §13.1의 보유 기간(신청 접수일로부터 1년) 경과분을 지우는 경로다. 자동 삭제
 * 배치는 두지 않으므로(§18.2 Cron 제외) 이 요청이 유일한 삭제 수단이다.
 *
 * ## 상품 삭제(#18)와 분리돼 있다
 *
 * §12.4가 명시적으로 나눠 둔 이유를 그대로 따른다: 신청 데이터는 상품보다 오래
 * 보존해야 하고(분쟁 대응) 지우는 판단 기준도 다르다(보유 기간 경과). 한
 * 버튼으로 묶으면 상품을 정리하다 신청 이력을 함께 날린다.
 *
 * ## 로그는 남기고 개인정보는 남기지 않는다
 *
 * `application_deleted`를 `category = application`으로 기록하므로 `input`·`output`은
 * 저장 시점에 마스킹된다(§5.4). 「누구의 신청을 지웠는가」는 마스킹된 값으로
 * 추적하고, 원본은 삭제와 함께 사라진다 — 지운 개인정보가 로그에 되살아나면
 * 삭제한 의미가 없다.
 *
 * ## 조건이 없다
 *
 * #18의 상품 삭제와 달리 허용 상태·금지 조건이 없다(§12.4의 표는 상품 삭제
 * 규정이다). 상품이 게시 중이어도 신청 1건은 지울 수 있어야 한다 — 보유 기간
 * 경과는 상품 상태와 무관하게 온다.
 */

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let app
  try {
    app = await loadApplication(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!app) return notFound('신청 내역을 찾을 수 없습니다.')

  // 로그의 실행 단위 키를 먼저 확보한다 — 지운 뒤에는 product_id를 따라갈 수 없다.
  const product = await loadProduct(app.product_id).catch(() => null)

  const { error } = await db().from('applications').delete().eq('id', app.id)
  if (error) return serverError(`신청 삭제 실패: ${error.message}`)

  /*
   * 삭제 **후에** 기록한다. 먼저 쓰면 삭제가 실패했을 때 「지웠다」는 로그만
   * 남는다. §16.1.1대로 로그 실패가 본 동작을 되돌리지도 않는다.
   */
  if (product) {
    await appendLog({
      execution_id: product.execution_id,
      product_id: product.id,
      category: 'application',
      step: 'application_deleted',
      attempt_no: product.attempt_no,
      retry_index: 0,
      verdict: '-',
      status: product.status,
      input: { application_id: app.id, name: app.name, email: app.email, phone: app.phone },
      output: { received_at: app.created_at, email_status: app.email_status },
    })
  }

  return ok({ current_step: 'application_deleted', application_id: app.id })
}
