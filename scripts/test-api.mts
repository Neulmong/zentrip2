/**
 * Step 01(§8.1) 통합 테스트 — 실제 dev 서버 + 실제 Supabase.
 *
 * curl 대신 Node로 보낸다. Windows Git Bash는 한글 인자를 CP949로 넘겨
 * 멀티파트 필드명이 깨진다 — 앱이 아니라 도구의 문제였다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:api
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

let pass = 0, fail = 0
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? `  → ${JSON.stringify(got)}` : ''}`) }
}

/* ── 로그인 ───────────────────────────────────────────────────── */
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
})
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
if (!login.ok) { console.error('로그인 실패 — dev 서버가 떠 있는지 확인하세요.'); process.exit(1) }

function makeForm(over: Record<string, string> = {}) {
  const fd = new FormData()
  const base: Record<string, string> = {
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
    식사정보: '조식 3회, 중식 2회, 석식 1회',
    여행스타일: '자연',
  }
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v)
  return fd
}

const post = (fd: FormData) =>
  fetch(`${BASE}/api/products`, { method: 'POST', headers: { cookie }, body: fd })

/* ── 1. 서버 재검증 (§7.1) ────────────────────────────────────── */
console.log('\n§8.1 ① 서버 재검증 — 위반 시 400, 행을 만들지 않는다')

const before = (await db.from('products').select('id', { count: 'exact', head: true })).count ?? 0

const bad = await post(makeForm({
  행사명: '가',
  여행기간_종료: '2026-03-30',
  일정원문: '제주도의 아름다운 풍경을 즐기는 여행입니다. 맛집도 많이 갑니다.',
}))
const badBody = await bad.json()
check('400 반환', bad.status === 400, bad.status)
check('행사명 2자 미만 거부', !!badBody.field_errors?.['행사정보.행사명'])
check('16일 거부 (§6.2.1 상한 15일)', !!badBody.field_errors?.['행사정보.여행기간_종료'])
check('일차 구분 없음 거부 (§6.3 임의 배분 금지)', !!badBody.field_errors?.['행사정보.일정원문'])

const afterBad = (await db.from('products').select('id', { count: 'exact', head: true })).count ?? 0
check('400일 때 products 행이 생기지 않는다', afterBad === before, { before, afterBad })

/* ── 2. 정상 등록 ─────────────────────────────────────────────── */
console.log('\n§8.1 ②③④⑤ 정상 등록')

const res = await post(makeForm())
const body = await res.json()
check('200 반환', res.status === 200, { status: res.status, body })
if (!res.ok) { console.log(`\n통과 ${pass} · 실패 ${fail}`); process.exit(1) }
check('product_id 반환', typeof body.product_id === 'string')
check('current_step = pipeline_started', body.current_step === 'pipeline_started')

const { data: row } = await db.from('products').select('*').eq('id', body.product_id).single()

check('status = generating', row.status === 'generating', row.status)
check('attempt_no = 1', row.attempt_no === 1)
check('retry_counts 4종 전부 0',
  ['normalization', 'brochure', 'page', 'consistency'].every((k) => row.retry_counts[k] === 0),
  row.retry_counts)
check('confirmed_data는 아직 없다 (Step 02의 산출물)', row.confirmed_data === null)
check('slug는 아직 없다 (Step 05에서 발급)', row.slug === null)

/* ── 3. form_input 구조 (§7.4) ────────────────────────────────── */
console.log('\n§7.4 form_input 구조')

const fi = row.form_input
check('최상위 키 6개',
  ['행사정보', '숙박', '상점', '가격', '식사', '항공편'].every((k) => k in fi),
  Object.keys(fi))
check('중첩 구조 — 평면 키 아님', fi.행사정보?.행사명 === '제주 올레 바람 여행' && !('행사명' in fi))
check('여행기간은 2필드 — 결합은 confirmed_data에서만 (§6.2.1)',
  fi.행사정보.여행기간_시작 === '2026-03-14'
  && fi.행사정보.여행기간_종료 === '2026-03-17'
  && !('여행기간' in fi.행사정보))
check('금액은 {숫자}원 (§6.2)', fi.가격.성인 === '120000원', fi.가격.성인)
check('아동 미운영은 `해당 없음` (§6.1)', fi.가격.아동 === '해당 없음')
check('미입력 선택 항목은 빈 문자열 — `추후 추가 예정`은 confirmed_data에서만 (§7.4)',
  fi.행사정보.타겟층 === '' && fi.숙박.숙박일정 === '' && fi.항공편.공항 === '',
  { 타겟층: fi.행사정보.타겟층, 숙박일정: fi.숙박.숙박일정, 공항: fi.항공편.공항 })
check('일정원문 원본 보존 (4개 일차)', (fi.행사정보.일정원문.match(/\d일:/g) ?? []).length === 4)

/* ── 4. 로그 (§5.4) ───────────────────────────────────────────── */
console.log('\n§5.4 execution_logs')

const { data: logs } = await db.from('execution_logs').select('*')
  .eq('execution_id', row.execution_id).order('id')
check('pipeline_started 1행', logs?.length === 1 && logs[0].step === 'pipeline_started',
  logs?.map((l: { step: string }) => l.step))
check('verdict는 영어로 저장 (§5.4)', logs?.[0]?.verdict === 'pass', logs?.[0]?.verdict)
check('category = pipeline', logs?.[0]?.category === 'pipeline')
check('retry_index = 0', logs?.[0]?.retry_index === 0)

/* ── 정리 ─────────────────────────────────────────────────────── */
await db.from('execution_logs').delete().eq('execution_id', row.execution_id)
await db.from('products').delete().eq('id', row.id)
console.log('\n임시 데이터 정리 완료.')

console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
