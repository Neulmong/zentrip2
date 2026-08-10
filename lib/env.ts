import 'server-only'

/**
 * spec §4 — 환경 변수는 전부 서버 전용이다.
 * `NEXT_PUBLIC_` 접두사 변수를 만들지 않는다. 공개 페이지도 서버 렌더링하므로
 * 클라이언트에서 Supabase를 직접 호출하지 않는다(§16.3).
 *
 * 빌드 시점에 터지지 않도록 접근 시점에 검사한다 — Vercel 빌드는
 * 런타임 환경변수 없이 돌 수 있기 때문이다.
 */
function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `환경 변수 ${name}이(가) 설정되지 않았습니다. ` +
      `로컬은 .env.local, 배포는 Vercel 프로젝트 설정에 등록하세요.`,
    )
  }
  return v
}

export const env = {
  get ANTHROPIC_API_KEY() { return required('ANTHROPIC_API_KEY') },
  get SUPABASE_URL() { return required('SUPABASE_URL') },
  get SUPABASE_SERVICE_ROLE_KEY() { return required('SUPABASE_SERVICE_ROLE_KEY') },
  get RESEND_API_KEY() { return required('RESEND_API_KEY') },
  get ADMIN_PASSWORD() { return required('ADMIN_PASSWORD') },
  get SESSION_SECRET() { return required('SESSION_SECRET') },
  get SITE_URL() { return required('SITE_URL') },
  get CONTACT_INFO() { return required('CONTACT_INFO') },
}
