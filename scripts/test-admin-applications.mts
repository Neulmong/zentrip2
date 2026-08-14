/**
 * §14.1 신청 내역 화면 + §14.4 #15·#16·#19 통합 테스트.
 * 실제 dev 서버 + 실제 Supabase + 실제 Resend. **AI 0회.**
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:admin-applications
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const TO = process.env.TEST_EMAIL_TO ?? 'delivered@resend.dev'
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

let pass = 0, fail = 0
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${n}`) }
  else { fail++; console.log(`  ❌ ${n}${got !== undefined ? `\n       → ${JSON.stringify(got)}` : ''}`) }
}

const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
})
if (!login.ok) { console.error('로그인 실패 — dev 서버 확인'); process.exit(1) }
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const EXEC = `test-adminapp-${process.pid}`
const SLUG = `test-adminapp-${process.pid}`
const 행사명 = '신청 내역 테스트 상품'

/* ── 시드 ─────────────────────────────────────────────────────── */
{
  const { data: old } = await db.from('products').select('id').eq('execution_id', EXEC).maybeSingle()
  if (old) await db.from('applications').delete().eq('product_id', old.id)
  await db.from('execution_logs').delete().eq('execution_id', EXEC)
  await db.from('products').delete().eq('execution_id', EXEC)
}

const { data: prod, error: seedError } = await db.from('products').insert({
  execution_id: EXEC, slug: SLUG, status: 'published',
  current_step: 'draft_registered', published_at: new Date().toISOString(),
  form_input: {
    행사정보: {
      행사명, 여행지: '제주', 여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
      일정원문: '1일: 출발\n2일: 귀국', 타겟층: '가족', 여행스타일: '자연', 여행주제: '제주 걷기와 로컬 맛집 휴식',
      기획메모: '',
    },
    // 객체 배열 · 1건 이상 (§7.4)
    숙박: [{ 숙소명: '제주 호텔', 위치: '서귀포', 객실타입: '디럭스', 숙박일정: '3박 4일' }],
    상점: [{ 상점명: '기념품점', 구분: '추천', 위치: '', 상점정보: '입구' }],
    가격: { 성인: '890000원', 아동: '해당 없음', 기타: '' },
    식사: { 식사정보: '조식 3회' },
    항공편: { 공항: '김해', 항공사: '대한항공', 편명: 'KE1234', 출발시간: '09:00', 도착시간: '10:10' },
  },
}).select().single()
if (seedError) { console.error('시드 실패:', seedError.message); process.exit(1) }

const snapshot = {
  행사명, 여행지: '제주', 여행기간: '2026-03-14 ~ 2026-03-17', 숙소명: '제주 호텔',
  가격: { 성인: '890000원', 아동: '해당 없음' }, url: `${BASE}/p/${SLUG}`,
}

/** 400일 전 = 보유 기간(365일) 경과분. §13.1의 수동 삭제 대상이다. */
const OLD_AT = new Date(Date.now() - 400 * 86_400_000).toISOString()

/*
 * `created_at`을 **두 행 모두** 명시한다. PostgREST의 벌크 insert는 키 합집합으로
 * 컬럼을 정하고 빠진 자리를 null로 채우므로, 한쪽만 지정하면 다른 행이
 * `created_at = null`로 들어가 NOT NULL 제약에 걸린다.
 */
const NOW_AT = new Date().toISOString()
const { data: apps, error: appError } = await db.from('applications').insert([
  { product_id: prod.id, name: '홍길동', email: TO, phone: '010-1234-5678', headcount: 2,
    consent_at: NOW_AT, created_at: NOW_AT, product_snapshot: snapshot,
    email_status: 'failed', email_error: '테스트용 실패 사유' },
  { product_id: prod.id, name: '김철수', email: TO, phone: '010-9876-5432', headcount: 4,
    consent_at: OLD_AT, created_at: OLD_AT, product_snapshot: snapshot,
    email_status: 'sent', email_error: null },
]).select()
if (appError) { console.error('신청 시드 실패:', appError.message); process.exit(1) }
const failedApp = apps!.find((a) => a.email_status === 'failed')!
const oldApp = apps!.find((a) => a.email_status === 'sent')!

const api = (qs = '') => fetch(`${BASE}/api/applications${qs}`, { headers: { cookie } })
const page = (qs = '') => fetch(`${BASE}/admin/applications${qs}`, {
  headers: { cookie }, redirect: 'manual',
})

/* ── §14.4 #15 GET ────────────────────────────────────────────── */
console.log('\n§14.4 #15 — GET /api/applications')
const anonGet = await fetch(`${BASE}/api/applications`)
check('인증 없는 GET은 401 (POST만 열려 있다)', anonGet.status === 401, anonGet.status)

const listRes = await api(`?product_id=${prod.id}`)
const list = await listRes.json()
check('200 반환', listRes.status === 200, list)
check('product_id로 좁혀진다 (2건)', list.count === 2, list.count)
const listed = list.applications as { id: string; name: string; email: string; phone: string }[]
check('기본 응답은 마스킹된 값이다 — 이름',
  listed.every((a) => a.name === '홍*동' || a.name === '김*수'), listed.map((a) => a.name))
check('기본 응답은 마스킹된 값이다 — 이메일',
  listed.every((a) => a.email !== TO && a.email.includes('***')), listed.map((a) => a.email))
check('기본 응답은 마스킹된 값이다 — 연락처',
  listed.every((a) => /^\d{3}-\*{4}-\d{4}$/.test(a.phone)), listed.map((a) => a.phone))

const revealed = ((await (await api(`?product_id=${prod.id}&reveal=${failedApp.id}`)).json())
  .applications as typeof listed)
check('reveal 지정 1건만 원본',
  revealed.find((a) => a.id === failedApp.id)?.phone === '010-1234-5678', revealed)
check('reveal하지 않은 행은 그대로 마스킹',
  revealed.find((a) => a.id === oldApp.id)?.phone === '010-****-5432', revealed)

const oldestFirst = ((await (await api(`?product_id=${prod.id}&sort=oldest`)).json())
  .applications as typeof listed)
check('sort=oldest는 접수일 오름차순 (§13.1 보유 기간 처리 방향)',
  oldestFirst[0]?.id === oldApp.id, oldestFirst.map((a) => a.id))

/* ── §14.1 화면 ───────────────────────────────────────────────── */
console.log('\n§14.1 — /admin/applications 화면')
const anonPage = await fetch(`${BASE}/admin/applications`, { redirect: 'manual' })
check('비로그인은 리다이렉트', anonPage.status === 307 || anonPage.status === 302, anonPage.status)

const html = await (await page(`?product_id=${prod.id}`)).text()
check('행사명 표시', html.includes(행사명))
check('발송 상태 표시 — 발송됨 · 발송 실패',
  html.includes('발송됨') && html.includes('발송 실패'))
check('실패 사유 표시', html.includes('테스트용 실패 사유'))
check('[재발송] 버튼', html.includes('재발송'))
check('[삭제] 버튼', html.includes('삭제'))
check('인원수 표시', html.includes('2명') && html.includes('4명'))

console.log('§13.1 — 연락처 기본 마스킹, 명시적 조작 시에만 전체 표시 (P-07)')
check('마스킹된 연락처가 보인다', html.includes('010-****-5678'))
check('원본 연락처가 HTML에 없다', !html.includes('010-1234-5678'), true)
check('원본 이메일이 HTML에 없다', !html.includes(TO), true)
check('[전체 보기] 링크가 있다', html.includes('전체 보기'))

const revealedHtml = await (await page(`?product_id=${prod.id}&reveal=${failedApp.id}`)).text()
check('reveal 시 해당 행만 원본이 온다', revealedHtml.includes('010-1234-5678'))
check('reveal해도 다른 행은 마스킹', revealedHtml.includes('010-****-5432'))
check('[가리기] 링크로 되돌릴 수 있다', revealedHtml.includes('가리기'))

console.log('§13.1 — 보유 기간 경과 표시')
check('경과분 배지', html.includes('보유 기간 경과'))
check('경과 건수 요약', html.includes('1건'))

/* ── §14.4 #16 재발송 ─────────────────────────────────────────── */
console.log('\n§14.4 #16 · §13.3 — 재발송')
const resend = await fetch(`${BASE}/api/applications/${failedApp.id}/resend`, {
  method: 'POST', headers: { cookie },
})
const resendBody = await resend.json()
check('200 반환', resend.status === 200, resendBody)
check('email_status = pending 응답', resendBody.email_status === 'pending', resendBody)

const { data: reset } = await db.from('applications').select('*').eq('id', failedApp.id).single()
check('DB도 pending으로 되돌아간다 (화면이 재조회해도 지난 실패가 보이지 않는다)',
  reset.email_status === 'pending', reset.email_status)
check('지난 실패 사유가 지워진다', reset.email_error === null, reset.email_error)

let final = reset
for (let i = 0; i < 30 && final.email_status === 'pending'; i++) {
  await new Promise((r) => setTimeout(r, 500))
  const { data } = await db.from('applications').select('*').eq('id', failedApp.id).single()
  final = data
}
check('after()가 실행돼 상태가 확정된다', final.email_status !== 'pending', final.email_status)
check(`재발송 성공 (수신 ${TO})`, final.email_status === 'sent', final.email_error)

const { data: resentLogs } = await db.from('execution_logs').select('*')
  .eq('execution_id', EXEC).eq('step', 'email_resent')
check('email_resent 로그 1행 (email_sent와 다른 step)', resentLogs?.length === 1, resentLogs?.length)
check('verdict = pass', resentLogs?.[0]?.verdict === 'pass', resentLogs?.[0]?.verdict)
check('재발송 로그도 마스킹된다', resentLogs?.[0]?.input?.email !== TO, resentLogs?.[0]?.input?.email)

const badResend = await fetch(
  `${BASE}/api/applications/00000000-0000-0000-0000-000000000000/resend`,
  { method: 'POST', headers: { cookie } },
)
check('없는 신청은 404', badResend.status === 404, badResend.status)

/* ── §14.4 #19 삭제 ──────────────────────────────────────────── */
console.log('\n§14.4 #19 · §12.4 — 신청 삭제 (보유 기간 경과분 처리 · U-09)')
const del = await fetch(`${BASE}/api/applications/${oldApp.id}`, {
  method: 'DELETE', headers: { cookie },
})
check('200 반환', del.status === 200, await del.clone().text())

const { data: gone } = await db.from('applications').select('id').eq('id', oldApp.id).maybeSingle()
check('행이 삭제됐다', gone === null, gone)

const { data: delLogs } = await db.from('execution_logs').select('*')
  .eq('execution_id', EXEC).eq('step', 'application_deleted')
check('application_deleted 로그 1행', delLogs?.length === 1, delLogs?.length)
check('category = application', delLogs?.[0]?.category === 'application', delLogs?.[0]?.category)
check('삭제 로그에 원본 개인정보가 남지 않는다 (§5.4)',
  delLogs?.[0]?.input?.name === '김*수' && delLogs?.[0]?.input?.email !== TO,
  delLogs?.[0]?.input)

const badDel = await fetch(`${BASE}/api/applications/${oldApp.id}`, {
  method: 'DELETE', headers: { cookie },
})
check('이미 삭제된 신청은 404', badDel.status === 404, badDel.status)

const after = await (await page(`?product_id=${prod.id}`)).text()
check('삭제 후 화면에서 사라진다', !after.includes('010-****-5432'), true)
check('남은 1건은 그대로', after.includes('010-****-5678'))

/* ── 상세 화면 요약 (§14.1) ───────────────────────────────────── */
console.log('\n§14.1 — 상세 화면의 로그 요약 · 신청 내역 요약 (P-06)')
const detail = await (await fetch(`${BASE}/admin/products/${prod.id}`, { headers: { cookie } })).text()
check('실행 로그 요약 블록', detail.includes('실행 로그'))
check('신청 내역 요약 블록', detail.includes('신청 내역'))
check('접수 건수 표시', detail.includes('1건'))
check('신청이 있으면 상품 삭제 불가 안내 (§12.4)',
  detail.includes('신청이 있는 상품은 삭제할 수 없습니다'))
check('실행 로그 화면 링크', detail.includes(`/admin/logs/${EXEC}`))
check('신청 내역 화면 링크', detail.includes(`/admin/applications?product_id=${prod.id}`))

/* ── 정리 ─────────────────────────────────────────────────────── */
if (!process.env.KEEP) {
  await db.from('applications').delete().eq('product_id', prod.id)
  await db.from('execution_logs').delete().eq('execution_id', EXEC)
  await db.from('products').delete().eq('execution_id', EXEC)
  console.log('\n임시 데이터 정리 완료. (KEEP=1로 보존 가능)')
}

console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
