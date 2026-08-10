/**
 * slug 정책 (§12.1) — **순수 모듈**.
 *
 * 허용 문자는 영문 소문자·숫자·하이픈뿐이다. 한글 slug는
 * `/p/%EC%A0%9C%EC%A3%BC…`로 percent-encoding되어 링크 복사·QR에서 읽을 수 없다.
 */

/**
 * 행사명이 **영문·숫자·공백만으로 구성된 경우에만** 그것을 변환해 쓴다.
 * 한글이 한 글자라도 포함되면 **로마자 변환을 시도하지 않고** 무작위 slug를 낸다 —
 * 자동 로마자 변환은 표기 왜곡(`제주` → `jeju`/`cheju`)을 낳고 규칙이 모호해진다.
 */
export function proposeSlug(eventName: string): { slug: string; 방식: '행사명변환' | '무작위' } {
  const name = eventName.trim()
  if (/^[A-Za-z0-9 ]+$/.test(name)) {
    const converted = name.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-')
    if (converted.length > 0) return { slug: converted, 방식: '행사명변환' }
  }
  return { slug: `p-${randomBase36(6)}`, 방식: '무작위' }
}

function randomBase36(n: number): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => alphabet[b % 36]).join('')
}

/** 동일 slug가 있으면 `-2`, `-3` … 접미사를 붙인다(§12.1). */
export function withSuffix(base: string, taken: Set<string>): string | null {
  if (!taken.has(base)) return base
  for (let i = 2; i <= 6; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return null
}

export const SLUG_RE = /^[a-z0-9-]+$/

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s) && s.length >= 1 && s.length <= 80
}
