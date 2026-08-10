/**
 * §8.5 소개서 생성 4요청 통합 테스트 — 실제 dev 서버 + 실제 Supabase + 실제 AI.
 *
 * AI를 3회 호출하므로 무료 티어 쿼터를 쓴다. 자주 돌리지 않는다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:pipeline
 */
import { createClient } from '@supabase/supabase-js'

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

/* ── ① 상품 등록 ─────────────────────────────────────────────── */
console.log('\n① POST /api/products')
const fd = new FormData()
for (const [k, v] of Object.entries({
  행사명: '제주 올레 바람 여행', 여행지: '제주',
  여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
  일정원문: [
    '1일: 김해공항 출발, 올레 7코스 걷기, 중식·석식 제공',
    '2일: 성산일출봉, 해녀박물관 관람, 조식·중식 제공',
    '3일: 자유 일정, 조식 제공',
    '4일: 귀국',
  ].join('\n'),
  숙소명: '롯데호텔 제주', 객실타입: '디럭스룸', 위치: '중문',
  상점명: '제주 로컬 기념품 숍', 상점정보: '여행객 10% 할인',
  가격_성인: '120000', 가격_아동: '해당 없음', 가격_기타: '항공료 별도',
  식사정보: '조식 3회, 중식 2회, 석식 1회', 여행스타일: '자연',
})) fd.set(k, v)

const created = await (await fetch(`${BASE}/api/products`, { method: 'POST', headers: { cookie }, body: fd })).json()
if (!created.product_id) { console.error('등록 실패', created); process.exit(1) }
const pid: string = created.product_id
console.log(`  product_id ${pid}`)

const call = async (path: string) => {
  const t = Date.now()
  const r = await fetch(`${BASE}/api/products/${pid}/${path}`, { method: 'POST', headers: { cookie } })
  const body = await r.json().catch(() => ({}))
  return { status: r.status, body, ms: Date.now() - t }
}
const row = async () => (await db.from('products').select('*').eq('id', pid).single()).data

/* ── ② 일차 분해 + 0차 ───────────────────────────────────────── */
console.log('\n② POST /decompose  (AI 1회)')
const r2 = await call('decompose')
console.log(`  ${r2.status} · ${(r2.ms / 1000).toFixed(1)}초`)
if (r2.status !== 200) console.log(`  본문: ${JSON.stringify(r2.body).slice(0, 400)}`)
check('200', r2.status === 200)

const p2 = await row()
const cd = p2?.confirmed_data
check('axis_0 = pass', p2?.validation_snapshot?.axes?.axis_0?.verdict === 'pass')
check('current_step = normalization_validated', p2?.current_step === 'normalization_validated')
// B5의 뿌리 — 결합은 confirmed_data에서만 일어난다
check('여행기간 결합 «{시작} ~ {종료}» (§6.2.1)',
  cd?.행사정보?.여행기간 === '2026-03-14 ~ 2026-03-17', cd?.행사정보?.여행기간)
check('일차 4개 (여행기간과 정확히 일치)', cd?.행사정보?.일정?.length === 4,
  cd?.행사정보?.일정?.length)
check('원문근거가 일정원문의 부분 문자열',
  (cd?.행사정보?.일정 ?? []).every((d: { 원문근거: string }) =>
    d.원문근거 === '' || cd.행사정보.일정원문.includes(d.원문근거)))
check('선택 미입력은 «추후 추가 예정» (§6.1)',
  cd?.행사정보?.타겟층 === '추후 추가 예정' && cd?.항공편?.공항 === '추후 추가 예정')
check('자유 서술 필드는 공백 규칙만 — 금액 표기 유지',
  cd?.가격?.기타 === '항공료 별도' && cd?.식사?.식사정보 === '조식 3회, 중식 2회, 석식 1회')
check('여행스타일 원본 유지', cd?.행사정보?.여행스타일 === '자연')
console.log(`  일차별 서술 예: "${cd?.행사정보?.일정?.[0]?.내용?.slice(0, 50) ?? ''}…"`)

/* ── ③ 소개서 생성 ───────────────────────────────────────────── */
console.log('\n③ POST /brochure  (AI 1회)')
const r3 = await call('brochure')
console.log(`  ${r3.status} · ${(r3.ms / 1000).toFixed(1)}초`)
if (r3.status !== 200) console.log(`  본문: ${JSON.stringify(r3.body).slice(0, 400)}`)
check('200', r3.status === 200)

const p3 = await row()
const b = p3?.brochure_content
check('섹션 8개·순서 (§8.7)',
  JSON.stringify(b?.sections?.map((s: { id: string }) => s.id))
  === JSON.stringify(['b_title', 'b_overview', 'b_itinerary', 'b_accommodation',
    'b_flight', 'b_meal', 'b_price', 'b_shop']),
  b?.sections?.map((s: { id: string }) => s.id))
check('행사명 값 보존 (§16.1)',
  b?.sections?.[0]?.data?.text === '제주 올레 바람 여행', b?.sections?.[0]?.data?.text)
check('여행기간은 결합값 그대로',
  b?.sections?.[1]?.data?.여행기간 === '2026-03-14 ~ 2026-03-17')
check('source 맵 누락 0건 (§8.8)',
  (b?.sections ?? []).every((s: { data: Record<string, unknown>; source: Record<string, string> }) =>
    Object.keys(s.data).filter((k) => k !== 'days').every((k) => k in s.source)))
check('핵심일정만 source = generated (§8.7)',
  b?.sections?.[1]?.source?.핵심일정 === 'generated')
check('일정 섹션에 원문근거가 없다 (§11.1 — 0차의 몫)',
  (b?.sections?.[2]?.data?.days ?? []).every((d: object) => !('원문근거' in d)))
check('미치환 토큰 0건', !JSON.stringify(b).includes('{{'))
console.log(`  핵심일정: "${b?.sections?.[1]?.data?.핵심일정?.slice(0, 70) ?? ''}…"`)

/* ── ④ 1차 검증 ──────────────────────────────────────────────── */
console.log('\n④ POST /validate-brochure  (AI 1회)  ← B5 관문')
const r4 = await call('validate-brochure')
console.log(`  ${r4.status} · ${(r4.ms / 1000).toFixed(1)}초`)
check('200 (409 retry가 아니다)', r4.status === 200, { status: r4.status, body: r4.body })

const p4 = await row()
const axis1 = p4?.validation_snapshot?.axes?.axis_1
check('axis_1 = pass — 여행기간 결합이 허용 차이로 인정됨 (B5)',
  axis1?.verdict === 'pass', axis1?.items)
check('status = brochure_ready (§15.2)', p4?.status === 'brochure_ready', p4?.status)
check('최상위 verdict = pass', p4?.validation_snapshot?.verdict === 'pass')
check('brochure 카운터 미소모', p4?.retry_counts?.brochure === 0, p4?.retry_counts)

if (axis1?.verdict !== 'pass' && axis1?.items?.length) {
  console.log('\n  실패 항목:')
  for (const i of axis1.items) console.log(`    · ${i.검증영역}: ${i.기준값} → ${i.발견값} (${i.사유})`)
}

/* ── ⑤ 페이지 생성 ───────────────────────────────────────────── */
console.log('\n⑤ POST /page  (AI 1회)')
const r5 = await call('page')
console.log(`  ${r5.status} · ${(r5.ms / 1000).toFixed(1)}초`)
if (r5.status !== 200) console.log(`  본문: ${JSON.stringify(r5.body).slice(0, 400)}`)
check('200', r5.status === 200)

const p5 = await row()
const pc = p5?.page_content
check('섹션 9개·순서 (§9.3)',
  JSON.stringify(pc?.sections?.map((s: { id: string }) => s.id)) === JSON.stringify([
    'sec_hero', 'sec_summary', 'sec_itinerary', 'sec_accommodation',
    'sec_flight', 'sec_meal', 'sec_price', 'sec_shop', 'sec_apply']),
  pc?.sections?.map((s: { id: string }) => s.id))
check('order 1~9', JSON.stringify(pc?.sections?.map((s: { order: number }) => s.order))
  === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]))
check('7개 최상위 필드 (§9.2 — visible·locked 포함)',
  (pc?.sections ?? []).every((s: object) =>
    ['id', 'type', 'order', 'visible', 'locked', 'data', 'source'].every((k) => k in s)))
check('hero·apply만 locked (§10.2)',
  pc?.sections?.filter((s: { locked: boolean }) => s.locked).map((s: { id: string }) => s.id)
    .join(',') === 'sec_hero,sec_apply')
check('테마 nature (자연 → §9.4)', pc?.theme === 'nature', pc?.theme)
check('slug 발급 — 한글 행사명이라 무작위 (§12.1)',
  typeof p5?.slug === 'string' && /^p-[a-z0-9]{6}$/.test(p5.slug), p5?.slug)
check('hero.headline 값 보존 + 40자 이내 (§17.1)',
  pc?.sections?.[0]?.data?.headline === '제주 올레 바람 여행'
  && pc.sections[0].data.headline.length <= 40)
check('일차별 서술 200자 이내 (§17.1 생성 시 4종)',
  (pc?.sections?.[2]?.data?.days ?? []).every((d: { text: string }) => d.text.length <= 200),
  (pc?.sections?.[2]?.data?.days ?? []).map((d: { text: string }) => d.text.length))
check('image_slot에는 source가 없다 (사실정보 아님 §9.3)',
  !('image_slot' in (pc?.sections?.[0]?.source ?? {})))
check('apply에 신청 폼 필드 구성이 없다 (§13.1 고정 계약)',
  !['이름', '이메일', '연락처', '인원수', '동의'].some((k) => k in (pc?.sections?.[8]?.data ?? {})))
check('apply 가격요약이 price와 일치',
  pc?.sections?.[8]?.data?.가격요약?.성인 === pc?.sections?.[6]?.data?.성인)
console.log(`  확장 서술 1일차: "${pc?.sections?.[2]?.data?.days?.[0]?.text?.slice(0, 60) ?? ''}…"`)
console.log(`  신청 안내: "${pc?.sections?.[8]?.data?.안내문구?.slice(0, 50) ?? ''}…"`)

/* ── ⑥ 2차 검증 ──────────────────────────────────────────────── */
console.log('\n⑥ POST /validate-page  (AI 1회) — 주 검증')
const r6 = await call('validate-page')
console.log(`  ${r6.status} · ${(r6.ms / 1000).toFixed(1)}초`)
check('200', r6.status === 200, r6.body)
const p6 = await row()
const axis2 = p6?.validation_snapshot?.axes?.axis_2
check('axis_2 = pass', axis2?.verdict === 'pass', axis2?.items)
check('아직 draft가 아니다 (3차가 남았다)', p6?.status === 'generating', p6?.status)
if (axis2?.verdict !== 'pass' && axis2?.items?.length) {
  console.log('  실패 항목:')
  for (const i of axis2.items) console.log(`    · ${i.검증영역}: ${i.기준값} → ${i.발견값}`)
}

/* ── ⑦ 3차 검증 + draft 등록 ─────────────────────────────────── */
console.log('\n⑦ POST /validate-consistency  (AI 1회)')
const r7 = await call('validate-consistency')
console.log(`  ${r7.status} · ${(r7.ms / 1000).toFixed(1)}초`)
check('200', r7.status === 200, r7.body)
const p7 = await row()
const axis3 = p7?.validation_snapshot?.axes?.axis_3
check('axis_3 = pass', axis3?.verdict === 'pass', axis3?.items)
check('skipped = ["apply"] (§11.1)', JSON.stringify(axis3?.skipped) === '["apply"]', axis3?.skipped)
check('status = draft (§15.2)', p7?.status === 'draft', p7?.status)
check('최상위 verdict = pass — 4축 전부 통과',
  p7?.validation_snapshot?.verdict === 'pass')
check('content_hash 기록 (§11.3)',
  typeof p7?.validation_snapshot?.content_hash === 'string'
  && p7.validation_snapshot.content_hash.startsWith('sha256:'))
check('page·consistency 카운터 미소모',
  p7?.retry_counts?.page === 0 && p7?.retry_counts?.consistency === 0, p7?.retry_counts)

/* ── 로그 (§5.4) ─────────────────────────────────────────────── */
console.log('\n§5.4 execution_logs')
const { data: logs } = await db.from('execution_logs').select('*')
  .eq('execution_id', p4.execution_id).order('id')
const steps = logs?.map((l: { step: string }) => l.step) ?? []
check('단계 9행 순서대로 — draft_registered 포함 (§9.5)',
  JSON.stringify(steps) === JSON.stringify([
    'pipeline_started', 'itinerary_decomposed', 'normalization_validated',
    'brochure_generated', 'validation_1_completed', 'page_generated',
    'validation_2_completed', 'validation_3_completed', 'draft_registered']), steps)
check('verdict 전부 영어', (logs ?? []).every((l: { verdict: string }) => ['pass', 'fail', '-'].includes(l.verdict)))
check('AI 단계 output에 usage 기록 (§4.3)',
  !!logs?.find((l: { step: string; output: { usage?: unknown } }) =>
    l.step === 'brochure_generated' && l.output?.usage))

const { data: flags } = await db.from('abnormality_flags').select('type,detail').eq('execution_id', p4.execution_id)
console.log(`  이상 플래그: ${flags?.length ? flags.map((f: { type: string }) => f.type).join(', ') : '(없음)'}`)

/* ── 정리 ────────────────────────────────────────────────────── */
if (!process.env.KEEP) {
  await db.from('abnormality_flags').delete().eq('execution_id', p4.execution_id)
  await db.from('execution_logs').delete().eq('execution_id', p4.execution_id)
  await db.from('products').delete().eq('id', pid)
  console.log('\n임시 데이터 정리 완료. (KEEP=1로 보존 가능)')
}

console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
