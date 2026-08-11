import 'server-only'
import { db } from './supabase'
import { appendLog } from './logging'
import { sendApplicationEmail } from './email'
import { env } from './env'
import { combineTripPeriod } from './form-validation'
import type { ApplicationRow, ProductRow, ProductSnapshot } from './types'

/**
 * 신청 처리의 공용 계층 (§13.2·§13.3).
 *
 * 발송을 라우트 안에 직접 쓰지 않는 이유: 최초 발송(#14)과 재발송(#16)이
 * 「보내고 → `email_status` 갱신 → 로그」라는 **같은 3동작**을 하고 `step`만
 * 다르다. 두 벌로 두면 한쪽만 고쳐져 §13.3의 실패 처리가 갈린다.
 */

/**
 * 신청 시점 스냅샷을 만든다(§13.2 3번).
 *
 * 출처는 **`form_input`**이다. `page_content`가 아닌 이유는 그쪽이 편집기에서
 * 사람 손을 타고(§10.2) AI 검증 대상도 아니라서(§10.4), 메일에 적힌 값의
 * 근거로 삼을 수 없기 때문이다. `form_input`은 검증 4축의 기준값이다(§11.1).
 */
export function buildSnapshot(p: ProductRow): ProductSnapshot {
  const g = p.form_input.행사정보
  return {
    행사명: g.행사명,
    여행지: g.여행지,
    여행기간: combineTripPeriod(g.여행기간_시작, g.여행기간_종료),
    숙소명: p.form_input.숙박.숙소명,
    가격: { 성인: p.form_input.가격.성인, 아동: p.form_input.가격.아동 },
    url: `${env.SITE_URL.replace(/\/$/, '')}/p/${p.slug}`,
  }
}

/* ── 조회 (§14.1 신청 내역 화면 · §14.4 #15) ───────────────────── */

/**
 * 전체 신청 내역. 상품으로 좁히려면 `product_id`를 넘긴다.
 *
 * 정렬 기준이 접수일인 이유는 §13.1이다 — 보유 기간(1년) 경과분을 「관리
 * 화면에서 접수일 기준으로 정렬해 수동 처리」하도록 규정하므로, 오래된 것부터
 * 보는 방향(`oldest`)이 실제 운영 동작이다. 기본은 최근순이다.
 */
export async function loadApplications(opts: {
  product_id?: string
  oldestFirst?: boolean
} = {}): Promise<ApplicationRow[]> {
  let q = db().from('applications').select('*')
  if (opts.product_id) q = q.eq('product_id', opts.product_id)
  const { data, error } = await q.order('created_at', { ascending: !!opts.oldestFirst })
  if (error) throw new Error(`신청 내역 조회 실패: ${error.message}`)
  return (data ?? []) as ApplicationRow[]
}

export async function loadApplication(id: string): Promise<ApplicationRow | null> {
  const { data, error } = await db()
    .from('applications').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`신청 조회 실패: ${error.message}`)
  return (data as ApplicationRow | null) ?? null
}

/** §13.1 — 개인정보 보유 기간. 경과분은 §12.4의 `DELETE`로 수동 삭제한다. */
export const RETENTION_DAYS = 365

/** 접수일로부터 보유 기간이 지났는가. 화면에서 삭제 대상을 골라내는 데 쓴다. */
export function retentionExpired(created_at: string, now = new Date()): boolean {
  const age = now.getTime() - new Date(created_at).getTime()
  return age > RETENTION_DAYS * 86_400_000
}

/**
 * 발송하고 결과를 `applications`와 `execution_logs`에 반영한다.
 *
 * `verdict`는 발송 성패를 그대로 쓴다 — §5.4가 「성공·실패 모두 기록」을
 * 요구하고, 저장값은 영어다(`pass`/`fail`).
 *
 * 신청 자체는 이 함수의 성패와 무관하게 이미 확정돼 있다(§13.3 실패 처리).
 * 그래서 반환값을 응답 코드로 바꾸지 않는다 — 관리 화면의 [재발송]이 남은 경로다.
 */
export async function deliverApplicationEmail(
  app: Pick<ApplicationRow, 'id' | 'name' | 'email' | 'headcount' | 'product_snapshot'>,
  ctx: { execution_id: string; product_id: string; attempt_no: number; resent: boolean },
): Promise<void> {
  const result = await sendApplicationEmail(app)

  const { error: updateError } = await db()
    .from('applications')
    .update(
      result.ok
        ? { email_status: 'sent', email_error: null }
        : { email_status: 'failed', email_error: result.error ?? '알 수 없는 오류' },
    )
    .eq('id', app.id)
  if (updateError) console.error('[applications] email_status 갱신 실패', updateError.message)

  await appendLog({
    execution_id: ctx.execution_id,
    product_id: ctx.product_id,
    // 마스킹 대상이다 — `to`가 원본으로 남으면 로그 화면으로 새어 나간다(§5.4)
    category: 'application',
    step: ctx.resent ? 'email_resent' : 'email_sent',
    attempt_no: ctx.attempt_no,
    retry_index: 0,
    verdict: result.ok ? 'pass' : 'fail',
    status: result.ok ? 'sent' : 'failed',
    input: { application_id: app.id, email: app.email },
    output: result.ok
      ? { email_id: result.id ?? null }
      : { error: result.error ?? '알 수 없는 오류' },
  })
}
