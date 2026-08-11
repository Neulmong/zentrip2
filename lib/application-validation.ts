/**
 * 신청 폼 검증 (§13.1) — **순수 모듈**.
 *
 * `lib/form-validation.ts`와 같은 이유로 순수하게 둔다: 폼(클라이언트)과
 * 라우트(서버)가 **같은 규칙 한 벌**을 쓴다. 서버는 클라이언트 검증을 신뢰하지
 * 않고 동일 규칙으로 재검증하며(§13.2 1항·§16.2), 위반 시 400을 반환하고
 * `applications` 행을 만들지 않는다.
 *
 * 5개 필드 구성은 **고정 계약**이다. 편집기에서 늘리거나 줄일 수 없고(§10.2·§13.1),
 * 그래서 이 파일이 필드 목록의 단일 출처가 된다.
 */

/** 동의 영역에 표시할 3개 항목(§13.1). 화면 문구를 코드 밖에 두지 않는다. */
export const CONSENT_NOTICE = {
  수집항목: '이름 · 이메일 · 연락처 · 인원수',
  수집목적: '여행 상품 신청 접수 및 안내',
  보유기간: '신청 접수일로부터 1년',
} as const

export const HEADCOUNT_MIN = 1
export const HEADCOUNT_MAX = 20

/**
 * 이메일 — RFC 형식 검사(§13.1).
 *
 * RFC 5322를 완전히 구현한 정규식은 실무에서 오탐이 더 크다. 「로컬부 @ 도메인부,
 * 공백 없음, 도메인에 점 1개 이상」까지만 본다 — 실제 도달 여부는 Resend 발송
 * 결과(`email_status = failed`)가 판정하므로 여기서 과하게 막을 이유가 없다.
 */
const EMAIL_RE = /^[^\s@,;:<>()[\]\\"]+@[^\s@.]+(\.[^\s@.]+)+$/

/** 연락처 — 숫자·하이픈만, 9~15자(§13.1). 국가번호 `+`는 받지 않는다. */
const PHONE_RE = /^[0-9-]{9,15}$/

/** 서버가 실제로 저장하는 형태. `consent`는 저장되지 않고 `consent_at`이 된다. */
export interface ApplicationValues {
  product_id: string
  name: string
  email: string
  phone: string
  headcount: number
}

export type ApplicationErrors = Record<string, string>

export type ApplicationCheck =
  | { ok: true; values: ApplicationValues }
  | { ok: false; errors: ApplicationErrors }

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * §13.1 표 그대로 검사한다. 반환이 `ok: false`면 `field_errors`로 400에 실어 보낸다.
 *
 * `product_id`는 폼 필드가 아니지만 같이 검사한다 — 누락되면 어느 상품의 신청인지
 * 알 수 없고, 그 상태로 INSERT하면 FK 오류가 500으로 새어 나간다.
 */
export function validateApplication(raw: unknown): ApplicationCheck {
  const errors: ApplicationErrors = {}
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: { _: '입력 형식이 올바르지 않습니다.' } }
  }
  const r = raw as Record<string, unknown>

  const product_id = str(r.product_id)
  if (!product_id) errors.product_id = '상품 정보가 없습니다. 페이지를 새로고침해 주세요.'

  const name = str(r.name)
  if (name.length < 2 || name.length > 30) {
    errors.name = '이름을 2~30자로 입력해 주세요.'
  }

  const email = str(r.email)
  if (!EMAIL_RE.test(email)) {
    errors.email = '이메일 형식을 확인해 주세요.'
  }

  const phone = str(r.phone)
  if (!PHONE_RE.test(phone)) {
    errors.phone = '연락처를 숫자와 하이픈으로 9~15자 입력해 주세요.'
  }

  /*
   * 인원수는 「1~20 정수」다(§13.1). 폼은 문자열로 보내오므로 문자열도 받되,
   * `parseInt`를 쓰지 않는다 — `"3명"`이 3으로 통과해 버린다.
   */
  const rawCount = typeof r.headcount === 'number' ? String(r.headcount) : str(r.headcount)
  const headcount = /^\d+$/.test(rawCount) ? Number(rawCount) : NaN
  if (!Number.isInteger(headcount) || headcount < HEADCOUNT_MIN || headcount > HEADCOUNT_MAX) {
    errors.headcount = `인원수를 ${HEADCOUNT_MIN}~${HEADCOUNT_MAX} 사이 정수로 입력해 주세요.`
  }

  /*
   * 동의는 **필수**다. 폼은 미체크 시 제출 버튼을 비활성으로 두지만(§13.1),
   * 그것은 안내일 뿐이고 판정은 여기서 한다 — 동의 없는 행이 생기면
   * `consent_at NOT NULL`을 채울 근거가 없다(§5.3).
   */
  if (r.consent !== true) {
    errors.consent = '개인정보 수집·이용에 동의해야 신청할 수 있습니다.'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, values: { product_id, name, email, phone, headcount } }
}
