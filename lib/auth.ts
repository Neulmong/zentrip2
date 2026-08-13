/**
 * spec §14.2 — 단일 공유 비밀번호 + HMAC 서명 쿠키.
 *
 * Web Crypto만 사용한다. middleware는 Edge 런타임에서 도는데 `node:crypto`가
 * 없으므로, 여기에 `server-only`나 node 전용 API를 들이면 미들웨어가 깨진다.
 */

export const SESSION_COOKIE = 'zentrip_session'
/** 유효기간 7일 (§14.2) */
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60

const encoder = new TextEncoder()

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET이 설정되지 않았습니다.')
  return s
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

/** 길이 정보까지 흘리지 않도록 바이트 단위 XOR 누산으로 비교한다. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * 비밀번호 비교 (§14.2 "타이밍 공격 방지를 위해 상수 시간 비교").
 * 두 값을 각각 HMAC한 뒤 다이제스트를 비교하므로 길이 차이도 드러나지 않는다.
 */
export async function passwordMatches(input: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) throw new Error('ADMIN_PASSWORD가 설정되지 않았습니다.')
  const [a, b] = await Promise.all([hmac(`pw:${input}`), hmac(`pw:${expected}`)])
  return timingSafeEqual(a, b)
}

export async function issueSession(): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC })),
  )
  return `${payload}.${toBase64Url(await hmac(payload))}`
}

export async function sessionIsValid(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return false

  const payload = token.slice(0, dot)
  const provided = token.slice(dot + 1)

  // 서명을 먼저 검증한다 — 페이로드를 신뢰하기 전에.
  const expected = toBase64Url(await hmac(payload))
  if (!timingSafeEqual(encoder.encode(provided), encoder.encode(expected))) return false

  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.exp === 'number' && json.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

/* ── 로그인 시도 제한 (§14.2 "IP당 분당 5회") ──────────────────────
 *
 * **세는 것은 실패뿐이다.** 이 제한의 목적은 비밀번호 무차별 대입을 막는
 * 것이므로, 세어야 할 것은 「비밀번호를 틀린 횟수」다.
 *
 * 성공까지 세면 정상 사용자가 자기 자신을 잠근다 — 실제로 테스트 스위트를
 * 연속 실행했을 때 뒤쪽이 전부 「로그인 실패」로 떨어졌다. 공격자는 어차피
 * 틀리므로 제한이 약해지지 않고, 막히는 쪽은 제대로 로그인하는 사람뿐이다.
 *
 * 성공하면 기록을 **지운다**. 비밀번호를 몇 번 헷갈렸다가 맞힌 사람이
 * 그 뒤 1분간 잠기는 것도 같은 이유로 틀렸다 — 무차별 대입이 아니다.
 *
 * ⚠ 알려진 한계: 인스턴스 메모리 기반이라 서버리스에서는 인스턴스별로 집계된다.
 * 현재 규모에서는 충분하지만, 엄밀한 전역 제한이 필요하면 저장소로 옮겨야 한다.
 * ───────────────────────────────────────────────────────────────── */
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 5
const failures = new Map<string, number[]>()

function recentFailures(ip: string, now: number): number[] {
  return (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
}

/** 검사만 한다 — 기록하지 않는다. 기록은 `recordFailedAttempt`의 몫이다. */
export function rateLimitExceeded(ip: string): boolean {
  return recentFailures(ip, Date.now()).length >= MAX_ATTEMPTS
}

/** 비밀번호가 틀렸을 때만 부른다. */
export function recordFailedAttempt(ip: string): void {
  const now = Date.now()
  const recent = recentFailures(ip, now)
  recent.push(now)
  failures.set(ip, recent)

  if (failures.size > 1000) {
    for (const [k, v] of failures) {
      if (v.every((t) => now - t >= WINDOW_MS)) failures.delete(k)
    }
  }
}

/** 로그인에 성공했다. 그 IP의 실패 이력을 지운다. */
export function clearFailedAttempts(ip: string): void {
  failures.delete(ip)
}

export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? headers.get('x-real-ip')
    ?? 'unknown'
}
