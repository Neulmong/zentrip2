import { NextResponse, type NextRequest } from 'next/server'
import {
  SESSION_COOKIE, SESSION_MAX_AGE_SEC,
  clientIp, issueSession, passwordMatches, rateLimitExceeded,
} from '@/lib/auth'

/** spec §14.2 — 인증 불필요(로그인 화면에서 호출). middleware의 공개 경로다. */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers)
  if (rateLimitExceeded(ip)) {
    return NextResponse.json(
      { error: 'rate_limited', message: '시도가 너무 잦습니다. 1분 후 다시 시도해 주세요.' },
      { status: 429 },
    )
  }

  let password: unknown
  try {
    password = (await req.json())?.password
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (typeof password !== 'string' || password.length === 0) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (!(await passwordMatches(password))) {
    // 어떤 부분이 틀렸는지 알려주지 않는다.
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: SESSION_COOKIE,
    value: await issueSession(),
    httpOnly: true,
    // 로컬 http에서는 Secure 쿠키가 저장되지 않으므로 프로덕션에서만 켠다.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  })
  return res
}
