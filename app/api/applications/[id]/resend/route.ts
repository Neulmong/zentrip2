import { after } from 'next/server'
import { db } from '@/lib/supabase'
import { loadProduct } from '@/lib/orchestrator'
import { deliverApplicationEmail, loadApplication } from '@/lib/applications'
import { conflict, notFound, ok, serverError } from '@/lib/http'

/**
 * §14.4 #16 — `POST /api/applications/{id}/resend`. **인증 필요 · AI 0회.**
 *
 * §13.3의 실패 처리가 끝나는 지점이다. 발송 실패는 신청을 되돌리지 않고
 * `email_status = failed`로 남으며, 사람이 이 경로로 다시 보낸다.
 *
 * ## `email_resent`를 `email_sent`와 다른 `step`으로 남긴다
 *
 * §5.4의 `step` 목록이 둘을 나눠 두었다. 같은 값으로 쓰면 로그 화면에서
 * 「처음부터 실패했는가」와 「사람이 다시 보냈는가」를 구분할 수 없다.
 *
 * ## 발송을 기다리지 않는다
 *
 * 최초 접수(§13.2 7번)와 같은 이유로 `after()`에 넣는다. 다만 여기서는 이미
 * 관리자가 화면을 보고 있으므로, 응답에 「발송을 시작했다」는 뜻의
 * `email_status = pending`을 실어 보내고 화면이 재조회하게 한다.
 *
 * ## 본문은 다시 만들지 않는다
 *
 * 저장된 `product_snapshot`을 그대로 쓴다(§13.3). 재발송 시점의 현재 상품 값을
 * 읽으면, 처음 받은 메일과 다시 받은 메일의 내용이 달라진다.
 */

export const maxDuration = 60

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let app
  try {
    app = await loadApplication(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!app) return notFound('신청 내역을 찾을 수 없습니다.')

  /*
   * 로그의 `execution_id`·`attempt_no`는 상품에서 가져온다. `applications`에는
   * 없는 값이고, 로그는 실행 단위로 묶여야 §14.3의 단일 화면에서 함께 보인다.
   *
   * `product_id`는 `ON DELETE RESTRICT`이므로(§5.3) 신청이 있는 동안 상품은
   * 지워지지 않는다 — 그래도 없으면 재발송할 근거가 없으니 409로 막는다.
   */
  const product = await loadProduct(app.product_id).catch(() => null)
  if (!product) return conflict({ reason: 'precondition', detail: '상품 행이 없습니다.' })

  /*
   * DB도 `pending`으로 되돌린다. 응답만 `pending`이라고 말하고 행을 그대로 두면,
   * 화면이 재조회했을 때 지난 실패 상태가 그대로 보여 「재발송 버튼이 아무것도
   * 하지 않았다」로 읽힌다. 지난 실패 사유도 함께 지운다 — 이번 시도의 결과로
   * 갈아치워야 하고, 남겨 두면 성공 후에도 실패 사유가 붙어 있다.
   */
  const { error: resetError } = await db()
    .from('applications')
    .update({ email_status: 'pending', email_error: null })
    .eq('id', app.id)
  if (resetError) return serverError(`재발송 준비 실패: ${resetError.message}`)

  after(async () => {
    await deliverApplicationEmail(app, {
      execution_id: product.execution_id,
      product_id: product.id,
      attempt_no: product.attempt_no,
      resent: true,
    })
  })

  return ok({
    current_step: 'email_resent',
    application_id: app.id,
    email_status: 'pending',
  })
}
