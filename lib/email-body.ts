import type { ProductSnapshot } from './types'

/**
 * 신청 확인 이메일의 **본문 구성** (§13.3) — 순수 모듈.
 *
 * 발송(Resend·환경변수)과 분리한 이유는 `lib/policy.ts`와 같다: **단독으로
 * 검증할 수 있어야 하기 때문이다.** 본문이 `server-only` 모듈에 묶여 있으면
 * 테스트에서 불러올 수 없고, 그래서 §13.3이 요구하는 항목이 다 들어갔는지를
 * 아무도 세지 않은 채 주석으로만 「9개 항목」이라 적혀 있었다(실제로는 10개다).
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
 * ## `contact`를 인자로 받는 이유
 *
 * 문의 안내의 출처는 환경변수 `CONTACT_INFO`다(§13.3). 그 값을 여기서 직접
 * 읽으면 이 모듈이 다시 서버 전용이 된다. 읽는 것은 호출부의 몫이다.
 */

export interface ApplicationMail {
  name: string
  headcount: number
  product_snapshot: ProductSnapshot
}

/** §13.3이 문구까지 규정한다. 게시 중단·삭제된 링크를 열지 못하는 경우의 안내다. */
export const URL_NOTICE =
  '상품이 마감·중단된 경우 링크가 열리지 않을 수 있습니다. 문의처로 연락해 주세요.'

export function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * §13.3의 본문 구성 중 **표로 넣는 7개.** 순서를 그대로 쓴다.
 *
 * 나머지 3개는 표가 아니라 본문의 제자리에 있다 — 신청자명은 첫 줄 인사,
 * 상품 페이지 URL은 링크, 문의 안내는 맨 아래다. 합쳐서 §13.3의 10개다.
 * 실제로 다 들어가는지는 `test:application`의 §13.3 본문 검사가 센다.
 */
export function rows(app: ApplicationMail): [string, string][] {
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

export function applicationText(app: ApplicationMail, contact: string): string {
  const s = app.product_snapshot
  return [
    `${app.name}님, 신청이 접수되었습니다.`,
    '',
    ...rows(app).map(([k, v]) => `${k}: ${v}`),
    `상품 페이지: ${s.url}`,
    '',
    URL_NOTICE,
    '',
    `문의: ${contact}`,
  ].join('\n')
}

export function applicationHtml(app: ApplicationMail, contact: string): string {
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
  <p style="margin:0;font-size:13px;color:#666">문의: ${escapeHtml(contact)}</p>
</div>`
}
