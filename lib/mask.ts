/**
 * 개인정보 마스킹 (§5.4) — 순수 모듈.
 *
 * `category = application` 행의 input·output은 **저장 시점에** 마스킹한다.
 * 신청 내역 화면에서 연락처를 가려도(§13.1) 로그 화면에서 원본이 나오면
 * 마스킹이 한쪽으로 새어 나간다. 원본은 `applications` 표에만 둔다.
 */

export function maskName(v: string): string {
  if (v.length <= 1) return '*'
  if (v.length === 2) return v[0] + '*'
  return v[0] + '*'.repeat(v.length - 2) + v[v.length - 1]
}

export function maskEmail(v: string): string {
  const at = v.indexOf('@')
  if (at < 0) return '***'
  return v.slice(0, Math.min(2, at)) + '***' + v.slice(at)
}

export function maskPhone(v: string): string {
  const digits = v.replace(/\D/g, '')
  if (digits.length < 7) return '****'
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`
}

const NAME_KEYS = new Set(['name', '이름', '신청자명', '신청자'])
const EMAIL_KEYS = new Set(['email', '이메일'])
const PHONE_KEYS = new Set(['phone', '연락처', '전화', '전화번호'])

/** 키 이름을 근거로 재귀 마스킹한다. 그 외 값은 원본 그대로 둔다. */
export function maskPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskPii)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase()
      if (typeof v === 'string') {
        if (NAME_KEYS.has(key)) { out[k] = maskName(v); continue }
        if (EMAIL_KEYS.has(key)) { out[k] = maskEmail(v); continue }
        if (PHONE_KEYS.has(key)) { out[k] = maskPhone(v); continue }
      }
      out[k] = maskPii(v)
    }
    return out
  }
  return value
}
