/**
 * Step 05·06(§12.2·§12.3·§4.1) 통합 테스트 — 실제 dev 서버 + 실제 Supabase. **AI 0회.**
 *
 * 게시는 상태값 전환이라 AI를 쓰지 않는다(§4.1). 그래서 파이프라인을 다시 돌리지
 * 않고 `draft` 행을 직접 심는다 — 무료 티어 쿼터를 태울 이유가 없다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:publish
 */
import { createClient } from '@supabase/supabase-js'
import { FIXTURE_PAGE } from '../components/page/fixture'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
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

/* ── 시드 ─────────────────────────────────────────────────────── */
const EXEC = `test-publish-${process.pid}`
const SLUG = `test-publish-${process.pid}`
const 행사명 = '게시 테스트 상품'

const passAxis = { verdict: 'pass' as const, items: [] }
const snapshot = (verdict: 'pass' | 'fail') => ({
  attempt_no: 1,
  verdict,
  validated_at: new Date().toISOString(),
  content_hash: 'testhash',
  axes: {
    axis_0: passAxis,
    axis_1: passAxis,
    axis_2: verdict === 'fail'
      ? { verdict: 'fail' as const, items: [{ field: '가격.성인', expected: '890,000원', actual: '990,000원', reason: '기준값 불일치' }] }
      : passAxis,
    axis_3: { ...passAxis, skipped: ['apply'] },
  },
})

const seed = async (patch: Record<string, unknown> = {}) => {
  await db.from('products').delete().eq('execution_id', EXEC)
  const { data, error } = await db.from('products').insert({
    execution_id: EXEC,
    slug: SLUG,
    status: 'draft',
    current_step: 'draft_registered',
    // §7.4 구조 — 최상위 키 6개. 여행기간은 2필드다(§6.2.1).
    form_input: {
      행사정보: {
        행사명, 여행지: '제주', 여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
        일정원문: '1일: 출발\n2일: 귀국', 타겟층: '가족', 여행스타일: '자연', 여행주제: '제주 걷기와 로컬 맛집 휴식',
        기획메모: '',
      },
      // 객체 배열 · 1건 이상 (§7.4)
      숙박: [{ 숙소명: '제주 호텔', 위치: '서귀포', 객실타입: '디럭스', 숙박일정: '3박 4일' }],
      상점: [{ 상점명: '올레 기념품점', 구분: '추천', 위치: '', 상점정보: '올레길 7코스 입구' }],
      가격: { 성인: '890000원', 아동: '해당 없음', 기타: '' },
      식사: { 식사정보: '조식 3회 · 중식 2회' },
      항공편: {
        공항: '김해', 항공사: '대한항공', 편명: 'KE1234',
        출발시간: '09:00', 도착시간: '10:10',
      },
    },
    page_content: FIXTURE_PAGE,
    validation_snapshot: snapshot('pass'),
    ...patch,
  }).select().single()
  if (error) { console.error('시드 실패:', error.message); process.exit(1) }
  return data
}

const post = (path: string, body: unknown) => fetch(`${BASE}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(body),
})

/* ── §12.2 게시 전 /p/{slug}는 404다 ────────────────────────────── */
console.log('\n§4.1·§12.2 draft 상태의 공개 경로')
let p = await seed()
const before = await fetch(`${BASE}/p/${SLUG}`)
check('draft는 /p/{slug}에서 404 (임시저장본 비공개)', before.status === 404, before.status)

/* ── §16.1.1 동시성 ──────────────────────────────────────────────── */
console.log('\n§16.1.1 조회 시점 검사')
const noStamp = await post(`/api/products/${p.id}/publish`, {})
check('updated_at 없으면 400', noStamp.status === 400, noStamp.status)

const staleRes = await post(`/api/products/${p.id}/publish`, { updated_at: '2020-01-01T00:00:00.000Z' })
check('낡은 updated_at은 409 stale', staleRes.status === 409, staleRes.status)
check('409에 reason=stale (§14.6)', (await staleRes.json()).reason === 'stale')

/* ── §11.5 게시 게이트 ──────────────────────────────────────────── */
console.log('\n§11.5 게시 게이트')
const failed = await seed({ validation_snapshot: snapshot('fail') })
const noOverride = await post(`/api/products/${failed.id}/publish`, { updated_at: failed.updated_at })
check('verdict=fail은 동의 없이 403 (409가 아니다)', noOverride.status === 403, noOverride.status)

const withOverride = await post(`/api/products/${failed.id}/publish`,
  { updated_at: failed.updated_at, override: true })
check('책임 게시 동의 시 200', withOverride.status === 200, await withOverride.clone().text())
check('override = true 응답', (await withOverride.json()).override === true)

const { data: ov } = await db.from('products').select('*').eq('id', failed.id).single()
check('publish_override_at 기록 (§11.5)', !!ov.publish_override_at)
const { data: ovLogs } = await db.from('execution_logs').select('step').eq('execution_id', EXEC)
check('publish_override 로그를 published와 따로 남긴다',
  !!ovLogs?.some((l: { step: string }) => l.step === 'publish_override')
  && !!ovLogs?.some((l: { step: string }) => l.step === 'published'),
  ovLogs?.map((l: { step: string }) => l.step))

const noPage = await seed({ page_content: null })
const noPageRes = await post(`/api/products/${noPage.id}/publish`, { updated_at: noPage.updated_at })
check('page_content 없으면 403', noPageRes.status === 403, noPageRes.status)

/* ── §12.2 게시 → 즉시 공개 ─────────────────────────────────────── */
console.log('\n§12.2 게시 — 재빌드 없이 즉시 공개')
p = await seed()
const t0 = Date.now()
const pub = await post(`/api/products/${p.id}/publish`, { updated_at: p.updated_at })
const body = await pub.json()
check('200 반환', pub.status === 200, body)
check('status = published', body.status === 'published', body.status)
check('url = /p/{slug}', body.url === `/p/${SLUG}`, body.url)
check('published_at 기록 (§12.2 2항)', !!body.published_at)

const publicRes = await fetch(`${BASE}/p/${SLUG}`)  // ← 쿠키 없음
const html = await publicRes.text()
check('비로그인 200 (§20 공개 접속)', publicRes.status === 200, publicRes.status)
check(`즉시 공개 — 게시부터 ${Date.now() - t0}ms`, Date.now() - t0 < 5000)
check('행사명이 렌더링된다', html.includes(FIXTURE_PAGE.sections[0].data.headline as string))
check('신청 폼 5개 필드 (§13.1)',
  ['이름', '이메일', '연락처', '인원수', '동의'].every((f) => html.includes(f)),
  ['이름', '이메일', '연락처', '인원수', '동의'].filter((f) => !html.includes(f)))
check('locked 섹션도 렌더링된다 (hero·apply)', html.includes('신청'))

/* ── §12.2 재게시 시 published_at 보존 ─────────────────────────── */
console.log('\n§12.3 게시 중단 → 즉시 404')
const { data: cur } = await db.from('products').select('*').eq('id', p.id).single()
const unpub = await post(`/api/products/${p.id}/unpublish`, { updated_at: cur.updated_at })
const unpubBody = await unpub.json()
check('200 반환', unpub.status === 200, unpubBody)
check('status = unpublished', unpubBody.status === 'unpublished', unpubBody.status)

const after = await fetch(`${BASE}/p/${SLUG}`)
check('공개 경로가 즉시 404 (캐시 없음)', after.status === 404, after.status)

const { data: cur2 } = await db.from('products').select('*').eq('id', p.id).single()
const repub = await post(`/api/products/${p.id}/publish`, { updated_at: cur2.updated_at })
const repubBody = await repub.json()
check('unpublished에서 재게시 가능 (§15.2)', repub.status === 200, repubBody)
check('published_at을 덮어쓰지 않는다 (§12.2 2항)',
  repubBody.published_at === body.published_at, [body.published_at, repubBody.published_at])

const dup = await post(`/api/products/${p.id}/publish`, { updated_at: repubBody.updated_at })
check('이미 게시된 상품은 403', dup.status === 403, dup.status)

/* ── 정리 ────────────────────────────────────────────────────────── */
if (!process.env.KEEP) {
  await db.from('execution_logs').delete().eq('execution_id', EXEC)
  await db.from('products').delete().eq('execution_id', EXEC)
  console.log('\n임시 데이터 정리 완료. (KEEP=1로 보존 가능)')
}

console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
