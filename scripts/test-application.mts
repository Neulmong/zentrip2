/**
 * Step 06(§13) 통합 테스트 — 실제 dev 서버 + 실제 Supabase + 실제 Resend. **AI 0회.**
 *
 * 게시된 상품을 직접 심고 신청 API를 두드린다. `after()` 안의 발송은 응답보다
 * 늦게 끝나므로 `email_status`가 `pending`을 벗어날 때까지 폴링한다.
 *
 * 수신 주소는 Resend 테스트 주소 `delivered@resend.dev`를 쓴다(도메인 미인증
 * 상태에서도 받는 주소다). 실제 메일함으로 보려면:
 *
 *   npm run dev  (별도 터미널)
 *   TEST_EMAIL_TO=you@example.com npm run test:application
 */
import { createClient } from '@supabase/supabase-js'
import { FIXTURE_PAGE } from '../components/page/fixture'
import { applicationSubject, applicationText } from '../lib/email-body'

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

const EXEC = `test-application-${process.pid}`
const SLUG = `test-apply-${process.pid}`
const 행사명 = '신청 테스트 상품'

const passAxis = { verdict: 'pass' as const, items: [] }

async function seed(status: string) {
  await db.from('applications').delete().eq('product_id', (
    (await db.from('products').select('id').eq('execution_id', EXEC).maybeSingle()).data?.id
    ?? '00000000-0000-0000-0000-000000000000'
  ))
  await db.from('products').delete().eq('execution_id', EXEC)
  const { data, error } = await db.from('products').insert({
    execution_id: EXEC,
    slug: SLUG,
    status,
    current_step: 'draft_registered',
    form_input: {
      행사정보: {
        행사명, 여행지: '제주', 여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
        일정원문: '1일: 출발\n2일: 귀국', 타겟층: '가족', 여행스타일: '자연', 여행주제: '제주 걷기와 로컬 맛집 휴식',
        기획메모: '',
      },
      // 객체 배열 · 1건 이상 (§7.4)
      숙박: [{ 숙소명: '제주 올레 호텔', 위치: '서귀포', 객실타입: '디럭스', 숙박일정: '3박 4일' }],
      상점: [{ 상점명: '올레 기념품점', 구분: '추천', 위치: '', 상점정보: '7코스 입구' }],
      가격: { 성인: '890000원', 아동: '해당 없음', 기타: '' },
      식사: { 식사정보: '조식 3회 · 중식 2회' },
      항공편: {
        공항: '김해', 항공사: '대한항공', 편명: 'KE1234',
        출발시간: '09:00', 도착시간: '10:10',
      },
    },
    page_content: FIXTURE_PAGE,
    validation_snapshot: {
      attempt_no: 1, verdict: 'pass', validated_at: new Date().toISOString(),
      content_hash: 'testhash',
      axes: { axis_0: passAxis, axis_1: passAxis, axis_2: passAxis,
        axis_3: { ...passAxis, skipped: ['apply'] } },
    },
    ...(status === 'published' ? { published_at: new Date().toISOString() } : {}),
  }).select().single()
  if (error) { console.error('시드 실패:', error.message); process.exit(1) }
  return data
}

/** 인증 없이 보낸다 — 이 라우트만 인증 밖이다(§14.4 #14). 쿠키를 일부러 안 붙인다. */
const apply = (body: unknown) => fetch(`${BASE}/api/applications`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const valid = (over: Record<string, unknown> = {}) => ({
  name: '홍길동', email: TO, phone: '010-1234-5678', headcount: 2, consent: true, ...over,
})

/* ── §13.2 1번 서버 재검증 ────────────────────────────────────── */
console.log('\n§13.1·§13.2 1번 — 서버 재검증 (위반 → 400, 행을 만들지 않는다)')
const p = await seed('published')

const cases: [string, Record<string, unknown>, string][] = [
  ['이름 2자 미만', { name: '홍' }, 'name'],
  ['이름 30자 초과', { name: '가'.repeat(31) }, 'name'],
  ['이메일 형식 위반', { email: 'not-an-email' }, 'email'],
  ['연락처 9자 미만', { phone: '010-123' }, 'phone'],
  ['연락처에 문자 포함', { phone: '010-abcd-5678' }, 'phone'],
  ['인원수 0', { headcount: 0 }, 'headcount'],
  ['인원수 21', { headcount: 21 }, 'headcount'],
  ['인원수 비정수', { headcount: '2명' }, 'headcount'],
  ['동의 미체크', { consent: false }, 'consent'],
]
for (const [label, over, field] of cases) {
  const res = await apply({ product_id: p.id, ...valid(over) })
  const body = await res.json()
  check(`${label} → 400 (${field})`,
    res.status === 400 && !!body.field_errors?.[field], { status: res.status, body })
}
const { count: afterBad } = await db.from('applications')
  .select('*', { count: 'exact', head: true }).eq('product_id', p.id)
check('400일 때 applications 행이 생기지 않는다', afterBad === 0, afterBad)

/* ── §13.2 2번 published 확인 ─────────────────────────────────── */
console.log('\n§13.2 2번 — published가 아니면 409')
const draft = await seed('draft')
const draftRes = await apply({ product_id: draft.id, ...valid() })
check('draft 상품 신청은 409', draftRes.status === 409, draftRes.status)
check('409 reason = product_not_published (§14.6)',
  (await draftRes.json()).reason === 'product_not_published')

const unknown = await apply({ product_id: '00000000-0000-0000-0000-000000000000', ...valid() })
check('없는 상품은 404 (409가 아니다)', unknown.status === 404, unknown.status)

/* ── 정상 접수 ────────────────────────────────────────────────── */
console.log('\n§13.2 3~6번 — 접수 확정 (발송을 기다리지 않는다)')
const prod = await seed('published')
const t0 = Date.now()
const res = await apply({ product_id: prod.id, ...valid() })
const okBody = await res.json()
const elapsed = Date.now() - t0

check('200 반환', res.status === 200, okBody)
check('application_id 반환', typeof okBody.application_id === 'string')
check('email_status = pending — 발송을 기다리지 않았다', okBody.email_status === 'pending', okBody)
check(`응답이 발송보다 빠르다 (${elapsed}ms)`, elapsed < 3000, elapsed)

const { data: app } = await db.from('applications').select('*').eq('id', okBody.application_id).single()
check('consent_at 기록 (§5.3 NOT NULL)', !!app.consent_at)
check('입력값 원본 저장 — applications는 마스킹하지 않는다',
  app.name === '홍길동' && app.email === TO && app.phone === '010-1234-5678' && app.headcount === 2,
  { name: app.name, headcount: app.headcount })

/* ── §13.2 3번 스냅샷 ─────────────────────────────────────────── */
console.log('\n§13.2 3번 · §13.3 — product_snapshot')
const s = app.product_snapshot
check('행사명·여행지·숙소명 (form_input 기준)',
  s.행사명 === 행사명 && s.여행지 === '제주' && s.숙소명 === '제주 올레 호텔', s)
check('여행기간은 결합값 (§6.2.1)', s.여행기간 === '2026-03-14 ~ 2026-03-17', s.여행기간)
check('성인·아동 가격 (아동은 `해당 없음` 유지 §6.1)',
  s.가격?.성인 === '890000원' && s.가격?.아동 === '해당 없음', s.가격)
check('url은 절대 URL (§13.3)', /^https?:\/\/.+\/p\/.+/.test(s.url ?? ''), s.url)
check('총액 필드가 없다 (§13.3 금지)',
  !JSON.stringify(s).includes('총액') && !('총액' in s), Object.keys(s))

/* ── §13.2 5번 로그가 메일보다 먼저 ───────────────────────────── */
console.log('\n§13.2 5번 · §5.4 — 로그를 메일보다 먼저 남긴다')
const { data: recv } = await db.from('execution_logs').select('*')
  .eq('execution_id', EXEC).eq('step', 'application_received').order('id')
check('application_received 1행', recv?.length === 1, recv?.length)
const r0 = recv?.[0]
check('category = application', r0?.category === 'application', r0?.category)
check('verdict = "-" (판정 단계가 아니다)', r0?.verdict === '-', r0?.verdict)
check('이름 마스킹 (§5.4 개인정보 예외)', r0?.input?.name === '홍*동', r0?.input?.name)
check('이메일 마스킹', r0?.input?.email !== TO && /\*\*\*/.test(r0?.input?.email ?? ''),
  r0?.input?.email)
check('연락처 마스킹', /^\d{3}-\*{4}-\d{4}$/.test(r0?.input?.phone ?? ''), r0?.input?.phone)
check('인원수는 마스킹하지 않는다 (개인정보 3종만)', r0?.input?.headcount === 2, r0?.input?.headcount)

/* ── §13.2 7번 after() 발송 ───────────────────────────────────── */
console.log('\n§13.2 7번 · §13.3 — after() 안에서 발송')
let final = app
for (let i = 0; i < 30 && final.email_status === 'pending'; i++) {
  await new Promise((r) => setTimeout(r, 500))
  const { data } = await db.from('applications').select('*').eq('id', app.id).single()
  final = data
}
check('email_status가 pending을 벗어났다 — after()가 실행됐다',
  final.email_status !== 'pending', final.email_status)
if (final.email_status === 'failed') {
  console.log(`     ↳ 발송 실패 사유: ${final.email_error}`)
}
check(`발송 성공 (수신 ${TO})`, final.email_status === 'sent', final.email_error)
check('성공 시 email_error가 비어 있다',
  final.email_status !== 'sent' || final.email_error === null, final.email_error)

const { data: sent } = await db.from('execution_logs').select('*')
  .eq('execution_id', EXEC).eq('step', 'email_sent').order('id')
check('email_sent 1행', sent?.length === 1, sent?.length)
check('verdict가 발송 성패와 일치 (§5.4 성공·실패 모두 기록)',
  sent?.[0]?.verdict === (final.email_status === 'sent' ? 'pass' : 'fail'),
  { verdict: sent?.[0]?.verdict, email_status: final.email_status })
check('application_received가 email_sent보다 앞선다 (§13.2 5번 < 7번)',
  (r0?.id ?? 0) < (sent?.[0]?.id ?? 0), { received: r0?.id, sent: sent?.[0]?.id })
check('email_sent 로그도 마스킹된다',
  sent?.[0]?.input?.email !== TO, sent?.[0]?.input?.email)

/* ── 공개 페이지에 폼이 실제로 있다 ────────────────────────────── */
console.log('\n§13.1 — 공개 페이지의 신청 폼 (비로그인)')
const html = await (await fetch(`${BASE}/p/${SLUG}`)).text()
for (const label of ['이름', '이메일', '연락처', '인원수', '개인정보 수집·이용에 동의합니다']) {
  check(`"${label}" 렌더링`, html.includes(label))
}
for (const [k, v] of [
  ['수집 항목', '이름 · 이메일 · 연락처 · 인원수'],
  ['수집 목적', '여행 상품 신청 접수 및 안내'],
  ['보유 기간', '신청 접수일로부터 1년'],
] as [string, string][]) {
  check(`동의 안내 — ${k}`, html.includes(v), v)
}
check('제출 버튼이 있다', html.includes('신청하기'))
check('플레이스홀더가 남아 있지 않다', !html.includes('신청 접수는 준비 중입니다'))

/* ── 정리 ─────────────────────────────────────────────────────── */
if (!process.env.KEEP) {
  await db.from('applications').delete().eq('product_id', prod.id)
  await db.from('execution_logs').delete().eq('execution_id', EXEC)
  await db.from('products').delete().eq('execution_id', EXEC)
  console.log('\n임시 데이터 정리 완료. (KEEP=1로 보존 가능)')
}

/* ════════════════════════════════════════════════════════════════
 * §13.3 — 이메일 본문 구성
 *
 * 「신청자명, 상품명, 여행지, 여행기간, 숙소, 성인·아동 가격, 신청 인원수,
 *  상품 페이지 URL, 문의 안내」가 **전부** 들어가야 한다.
 *
 * 이 검사가 없어서 소스 주석이 「9개 항목」이라고 적힌 채 남아 있었다.
 * 개수를 주석으로 주장하지 말고 여기서 센다.
 * ════════════════════════════════════════════════════════════════ */
console.log('\n§13.3 이메일 본문 구성')
{
  const snapshot = {
    행사명: '제주 올레 바람 여행', 여행지: '제주',
    여행기간: '2026-03-14 ~ 2026-03-17', 숙소명: '롯데호텔 제주',
    가격: { 성인: '120,000원', 아동: '해당 없음' },
    url: 'https://example.test/p/jeju-olle',
  }
  const app = { name: '홍길동', headcount: 2, product_snapshot: snapshot }
  const contact = process.env.CONTACT_INFO!
  const text = applicationText(app, contact)

  const REQUIRED: [string, string][] = [
    ['신청자명', '홍길동'],
    ['상품명', snapshot.행사명],
    ['여행지', snapshot.여행지],
    ['여행기간', snapshot.여행기간],
    ['숙소', snapshot.숙소명],
    ['성인 가격', snapshot.가격.성인],
    ['아동 가격', snapshot.가격.아동],
    ['신청 인원수', '2명'],
    ['상품 페이지 URL', snapshot.url],
    ['문의 안내', contact],
  ]
  for (const [label, value] of REQUIRED) {
    check(`${label}이(가) 본문에 있다`, text.includes(value), { label, value })
  }
  check(`§13.3이 요구하는 항목이 ${REQUIRED.length}개 전부 있다`,
    REQUIRED.every(([, v]) => text.includes(v)))

  // §13.3 금지 — 총액 계산. 2명 × 120,000 = 240,000이 나오면 안 된다.
  check('총액을 계산하지 않는다 (§13.3 금지)',
    !text.includes('240,000') && !text.includes('240000'), text)

  check('URL 안내 문구가 있다 (§13.3이 문구까지 규정)',
    text.includes('상품이 마감·중단된 경우 링크가 열리지 않을 수 있습니다.'))
  check('제목에 행사명이 들어간다',
    applicationSubject(snapshot).includes(snapshot.행사명), applicationSubject(snapshot))
  check('본문 데이터가 스냅샷에서만 온다 (현재 상품을 다시 읽지 않는다)',
    !text.includes('undefined') && !text.includes('[object'), text)
}

console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
