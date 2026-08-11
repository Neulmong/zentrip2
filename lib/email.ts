import 'server-only'
import { Resend } from 'resend'
import { env } from './env'
import type { ApplicationRow, ProductSnapshot } from './types'

/**
 * 신청 확인 이메일 (§13.3).
 *
 * ## 본문은 `product_snapshot`만 읽는다
 *
 * 인자로 상품 행을 받지 않는다 — 받을 수 있으면 언젠가 현재 값을 읽고, 그
 * 순간 「발송한 메일과 현재 페이지가 다르다」는 §13.3이 막으려던 상태가 된다.
 * 타입이 그것을 강제한다.
 *
 * ## 총액을 계산하지 않는다
 *
 * §13.3의 금지 항목이다. 인원수와 단가를 **나란히 적기만** 한다. 곱셈을
 * 넣으면 유아 할인·유류할증처럼 이 시스템이 모르는 변수를 무시한 금액이
 * 확정 청구액처럼 읽힌다.
 *
 * ## 발신 주소
 *
 * 자체 도메인 인증 전에는 Resend 기본 발신 주소를 쓴다(§13.3). 이 경로에서
 * **수신은 Resend 가입 이메일로만** 도달한다 — 데모 대본이 본인 가입 주소를
 * 넣는 이유이고, 다른 주소로 보내면 Resend가 422로 거부한다(그 실패는
 * `email_status = failed`로 남고 신청 자체는 성공으로 확정된다).
 */

/** 도메인 인증 전 고정 발신 주소. 인증 후 `MAIL_FROM` 같은 변수로 바꾼다. */
const FROM = 'zentrip <onboarding@resend.dev>'

/** §13.3이 문구까지 규정한다. 게시 중단·삭제된 링크를 열지 못하는 경우의 안내다. */
const URL_NOTICE = '상품이 마감·중단된 경우 링크가 열리지 않을 수 있습니다. 문의처로 연락해 주세요.'

export interface SendResult {
  ok: boolean
  /** 실패 사유. `applications.email_error`에 그대로 저장한다(§5.3) */
  error?: string
  /** Resend가 발급한 메시지 id. 성공 시 로그 `output`에 남긴다 */
  id?: string
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 본문에 들어가는 9개 항목(§13.3). 표 순서를 그대로 쓴다. */
function rows(app: {
  name: string; headcount: number; product_snapshot: ProductSnapshot
}): [string, string][] {
  const s = app.product_snapshot
  return [
    ['상품명', s.행사명],
    ['여행지', s.여행지],
    ['여행기간', s.여행기간],
    ['숙소', s.숙소명],
    ['성인 요금', s.가격.성인],
    ['아동 요금', s.가격.아동],
    // 총액을 만들지 않는다(§13.3). 인원수는 인원수로만 적는다.
    ['신청 인원수', `${app.headcount}명`],
  ]
}

export function applicationSubject(s: ProductSnapshot): string {
  return `[zentrip] ${s.행사명} 신청이 접수되었습니다`
}

export function applicationText(app: {
  name: string; headcount: number; product_snapshot: ProductSnapshot
}): string {
  const s = app.product_snapshot
  return [
    `${app.name}님, 신청이 접수되었습니다.`,
    '',
    ...rows(app).map(([k, v]) => `${k}: ${v}`),
    `상품 페이지: ${s.url}`,
    '',
    URL_NOTICE,
    '',
    `문의: ${env.CONTACT_INFO}`,
  ].join('\n')
}

function applicationHtml(app: {
  name: string; headcount: number; product_snapshot: ProductSnapshot
}): string {
  const s = app.product_snapshot
  const tr = rows(app)
    .map(([k, v]) => `<tr>
        <th align="left" style="padding:6px 16px 6px 0;color:#666;font-weight:500;white-space:nowrap">${escapeHtml(k)}</th>
        <td style="padding:6px 0">${escapeHtml(v)}</td>
      </tr>`)
    .join('')

  return `<div style="max-width:560px;margin:0 auto;padding:24px;font-family:system-ui,sans-serif;font-size:15px;line-height:1.7;color:#171717">
  <p style="margin:0 0 20px"><strong>${escapeHtml(app.name)}</strong>님, 신청이 접수되었습니다.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">${tr}</table>
  <p style="margin:24px 0 8px">
    <a href="${escapeHtml(s.url)}" style="color:#0f766e">상품 페이지 보기</a>
  </p>
  <p style="margin:0 0 24px;font-size:13px;color:#666">${escapeHtml(URL_NOTICE)}</p>
  <hr style="border:none;border-top:1px solid #e5e5e5;margin:0 0 16px">
  <p style="margin:0;font-size:13px;color:#666">문의: ${escapeHtml(env.CONTACT_INFO)}</p>
</div>`
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
    const resend = new Resend(env.RESEND_API_KEY)
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: app.email,
      subject: applicationSubject(app.product_snapshot),
      text: applicationText(app),
      html: applicationHtml(app),
    })
    if (error) return { ok: false, error: `${error.name}: ${error.message}` }
    return { ok: true, id: data?.id }
  } catch (e) {
    // 키 누락(env 접근 시 throw)·네트워크 오류가 여기로 온다.
    return { ok: false, error: (e as Error).message }
  }
}
