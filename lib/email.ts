import 'server-only'
import { Resend } from 'resend'
import { env } from './env'
import { applicationHtml, applicationSubject, applicationText } from './email-body'
import type { ApplicationRow } from './types'

/**
 * 신청 확인 이메일 **발송** (§13.3).
 *
 * 본문 구성은 `lib/email-body.ts`가 갖는다 — 순수 모듈이라 단독으로 검증할 수
 * 있고, §13.3의 항목이 다 들어갔는지를 `test:application`이 실제로 센다.
 * 여기 남는 것은 서버에서만 할 수 있는 일뿐이다: 키를 읽고, 보내고, 실패를
 * 값으로 돌려준다.
 *
 * ## 발신 주소
 *
 * 자체 도메인 인증 전에는 Resend 기본 발신 주소를 쓴다(§13.3). 이 경로에서
 * **수신은 Resend 가입 이메일로만** 도달한다 — 신청 폼에 본인 가입 주소를
 * 넣어야 도착을 확인할 수 있는 이유이고, 다른 주소로 보내면 Resend가 422로 거부한다(그 실패는
 * `email_status = failed`로 남고 신청 자체는 성공으로 확정된다).
 */

/** 도메인 인증 전 고정 발신 주소. 인증 후 `MAIL_FROM` 같은 변수로 바꾼다. */
const FROM = 'zentrip <onboarding@resend.dev>'

export interface SendResult {
  ok: boolean
  /** 실패 사유. `applications.email_error`에 그대로 저장한다(§5.3) */
  error?: string
  /** Resend가 발급한 메시지 id. 성공 시 로그 `output`에 남긴다 */
  id?: string
}

/**
 * 발송한다. **던지지 않는다** — 호출부(§13.2 7번)는 신청을 이미 성공으로
 * 확정한 뒤라서, 예외가 올라가면 `email_status`를 갱신할 기회를 잃는다.
 * 실패는 값으로 돌려준다.
 */
export async function sendApplicationEmail(
  app: Pick<ApplicationRow, 'name' | 'email' | 'headcount' | 'product_snapshot'>,
): Promise<SendResult> {
  try {
    // 문의 안내의 출처는 환경변수다(§13.3). 읽는 것은 서버인 여기의 몫이다.
    const contact = env.CONTACT_INFO
    const resend = new Resend(env.RESEND_API_KEY)
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: app.email,
      subject: applicationSubject(app.product_snapshot),
      text: applicationText(app, contact),
      html: applicationHtml(app, contact),
    })
    if (error) return { ok: false, error: `${error.name}: ${error.message}` }
    return { ok: true, id: data?.id }
  } catch (e) {
    // 키 누락(env 접근 시 throw)·네트워크 오류가 여기로 온다.
    return { ok: false, error: (e as Error).message }
  }
}
