import { after, type NextRequest } from 'next/server'
import { db } from '@/lib/supabase'
import { loadProduct } from '@/lib/orchestrator'
import { appendLog } from '@/lib/logging'
import { badRequest, conflict, notFound, ok, serverError } from '@/lib/http'
import { validateApplication } from '@/lib/application-validation'
import { buildSnapshot, deliverApplicationEmail } from '@/lib/applications'
import type { ApplicationRow } from '@/lib/types'

/**
 * §14.4 #14 — `POST /api/applications`. **인증 불필요 · AI 0회.**
 *
 * 인증 밖의 유일한 쓰기 경로다. `proxy.ts`가 이 경로의 `POST`만 열어 두며
 * (`GET`은 #15이고 인증이 필요하다), 그래서 여기서는 사람이 보낸 값을
 * 하나도 신뢰하지 않는다 — `validateApplication`으로 전부 재검증한다(§13.2 1번).
 *
 * ## 처리 순서가 §13.2에 못 박혀 있다
 *
 * 특히 두 가지를 바꾸지 않는다.
 *
 * **로그가 메일보다 먼저다(5번 < 7번).** 메일 단계에서 예외·타임아웃이 나면
 * 신청 접수 기록 자체가 사라진다. 접수는 이미 성립한 사실이므로 발송 성패와
 * 무관하게 남아야 한다.
 *
 * **응답이 발송보다 먼저다(6번 < 7번).** 고객을 Resend 응답만큼 기다리게 할
 * 이유가 없고, 발송 실패가 신청 실패로 보이면 안 된다(§13.3). 서버리스는
 * 응답 후 컨텍스트가 종료될 수 있으므로 `after()`로 실행을 보장한다 —
 * `maxDuration`을 늘려주지는 않지만(§4.2) 이 단계에는 AI 호출이 없어
 * 60초 예산 안에서 끝난다.
 */

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null)

  const check = validateApplication(raw)
  if (!check.ok) return badRequest(check.errors)
  const v = check.values

  let p
  try {
    p = await loadProduct(v.product_id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')

  /*
   * §13.2 2번. `published`가 아니면 409 `product_not_published` —
   * 클라이언트는 재호출하지 않고 신청 폼을 닫는다(§14.6).
   *
   * 이 검사가 필요한 이유: 공개 페이지를 열어 둔 채 관리자가 게시를 중단하면
   * 폼은 그대로 살아 있다. 그 상태의 제출을 받으면 열리지 않는 URL이 담긴
   * 메일을 보내게 된다.
   */
  if (p.status !== 'published' || !p.slug) {
    return conflict({ reason: 'product_not_published' })
  }

  const snapshot = buildSnapshot(p)
  const consent_at = new Date().toISOString()

  let app: ApplicationRow
  try {
    const { data, error } = await db().from('applications').insert({
      product_id: p.id,
      name: v.name,
      email: v.email,
      phone: v.phone,
      headcount: v.headcount,
      // 동의 시각은 서버 시각이다. 클라이언트가 보낸 시각을 믿지 않는다(§5.3).
      consent_at,
      product_snapshot: snapshot,
      // 기본값이지만 명시한다 — 이 값이 발송 전 상태라는 것이 §13.2 4번의 요점이다
      email_status: 'pending',
    }).select().single()
    if (error) return serverError(`신청 저장 실패: ${error.message}`)
    app = data as ApplicationRow
  } catch (e) {
    return serverError((e as Error).message)
  }

  // 5번 — 메일보다 먼저. category = application이라 저장 시점에 마스킹된다(§5.4).
  await appendLog({
    execution_id: p.execution_id,
    product_id: p.id,
    category: 'application',
    step: 'application_received',
    attempt_no: p.attempt_no,
    retry_index: 0,
    verdict: '-',
    status: p.status,
    input: { name: v.name, email: v.email, phone: v.phone, headcount: v.headcount },
    output: { application_id: app.id, consent_at, slug: p.slug },
  })

  // 7번 — 응답 후 발송. 여기서 await하지 않는다.
  after(async () => {
    await deliverApplicationEmail(app, {
      execution_id: p.execution_id,
      product_id: p.id,
      attempt_no: p.attempt_no,
      resent: false,
    })
  })

  /*
   * 6번. 신청은 이 시점에 확정이다. `email_status`를 함께 돌려주지만 값은
   * 항상 `pending`이다 — 발송 결과를 응답에 담으려면 기다려야 하고, 그것이
   * 바로 §13.2가 금지한 순서다.
   */
  return ok({
    current_step: 'application_received',
    application_id: app.id,
    email_status: 'pending',
    received_at: app.created_at,
  })
}
