import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

/**
 * service role 클라이언트 — RLS를 우회한다(§16.3).
 * 서버 라우트·서버 컴포넌트에서만 쓰며 클라이언트 번들에 들어가지 않는다.
 * `server-only` import가 실수로 클라이언트에 끌려가면 빌드를 실패시킨다.
 */
let cached: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cached
}

export const STORAGE_BUCKET = 'product-images'
