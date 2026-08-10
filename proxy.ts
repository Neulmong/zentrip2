import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, sessionIsValid } from '@/lib/auth'

/**
 * spec §14.2 — 보호 대상: `/admin/*`, `/new/*`, 그리고
 * `POST /api/applications`를 제외한 모든 API.
 *
 * 공개로 남는 것: `/p/{slug}`(고객용 상품 페이지), 로그인 화면, 로그인 API,
 * 그리고 고객 신청 API.
 *
 * Next.js 16에서 `middleware` 파일 규약이 `proxy`로 대체됐다. 동작은 같다.
 */
const PUBLIC_PATHS = new Set(['/admin/login', '/api/admin/login'])

function isPublic(req: NextRequest): boolean {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.has(pathname)) return true
  // 고객 신청은 인증 불필요. 단 POST만 열고 조회(GET)는 막는다(§14.4 #14·#15).
  if (pathname === '/api/applications' && req.method === 'POST') return true
  return false
}

export async function proxy(req: NextRequest) {
  if (isPublic(req)) return NextResponse.next()

  if (await sessionIsValid(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next()
  }

  // API는 리다이렉트하면 클라이언트가 HTML을 JSON으로 파싱하려 든다.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const login = new URL('/admin/login', req.url)
  login.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ['/admin/:path*', '/new/:path*', '/api/:path*'],
}
