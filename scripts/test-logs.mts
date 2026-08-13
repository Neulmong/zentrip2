/**
 * §14.3 실행 로그 뷰 통합 테스트 — 실제 dev 서버 + 실제 Supabase. **AI 0회.**
 *
 * 화면이 산출물이라 HTML을 직접 본다. 로그·플래그를 직접 심고 렌더링 결과를
 * 대조한다 — 파이프라인을 돌리면 이상 플래그 5종을 의도적으로 만들 수 없다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:logs
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

const EXEC = `test-logs-${process.pid}`
const 행사명 = '로그 뷰 테스트 상품'

/* ── 시드 ─────────────────────────────────────────────────────── */
await db.from('abnormality_flags').delete().eq('execution_id', EXEC)
await db.from('execution_logs').delete().eq('execution_id', EXEC)
await db.from('products').delete().eq('execution_id', EXEC)

const { data: prod, error: seedError } = await db.from('products').insert({
  execution_id: EXEC,
  status: 'draft',
  current_step: 'draft_registered',
  attempt_no: 2,
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

/** 3개 category를 섞어 심는다 — 탭이 실제로 걸러 내는지 보려면 섞여 있어야 한다. */
const seedLogs = [
  { category: 'pipeline', step: 'pipeline_started', retry_index: 0, verdict: '-',
    status: 'generating', input: { 행사명 }, output: { product_id: prod.id } },
  { category: 'pipeline', step: 'brochure_generated', retry_index: 0, verdict: 'fail',
    status: 'generating', input: { attempt: 1 }, output: { items: [{ 검증영역: '가격.성인' }] } },
  { category: 'pipeline', step: 'brochure_generated', retry_index: 1, verdict: 'pass',
    status: 'generating', input: { attempt: 2 }, output: { usage: { total: 1234 } } },
  { category: 'lifecycle', step: 'published', retry_index: 0, verdict: '-',
    status: 'published', input: { from: 'draft' }, output: { slug: 'log-view-test' } },
  { category: 'application', step: 'application_received', retry_index: 0, verdict: '-',
    status: 'published',
    // 저장 시점에 이미 마스킹된 형태다(§5.4). 화면은 이 값을 그대로 그린다.
    input: { name: '홍*동', email: 'ho***@example.com', phone: '010-****-5678', headcount: 2 },
    output: { application_id: 'app-1' } },
]
const { error: logError } = await db.from('execution_logs').insert(
  seedLogs.map((l) => ({ ...l, execution_id: EXEC, product_id: prod.id, attempt_no: 2 })),
)
if (logError) { console.error('로그 시드 실패:', logError.message); process.exit(1) }

const { error: flagError } = await db.from('abnormality_flags').insert([
  { execution_id: EXEC, product_id: prod.id, attempt_no: 2, type: 'retry_accumulated',
    step: 'brochure_generated', detail: 'brochure 카운터가 2에 도달했습니다.' },
  { execution_id: EXEC, product_id: prod.id, attempt_no: 2, type: 'processing_delayed',
    step: 'page_generated', detail: '요청 소요 22.4초.' },
])
if (flagError) { console.error('플래그 시드 실패:', flagError.message); process.exit(1) }

const get = (qs = '') => fetch(`${BASE}/admin/logs/${EXEC}${qs}`, {
  headers: { cookie }, redirect: 'manual',
})

/* ── §14.2 인증 ────────────────────────────────────────────────── */
console.log('\n§14.2 — 인증 필요')
const anon = await fetch(`${BASE}/admin/logs/${EXEC}`, { redirect: 'manual' })
check('비로그인은 로그인 화면으로 리다이렉트',
  anon.status === 307 || anon.status === 302, anon.status)
check('next 파라미터에 원래 경로가 실린다',
  (anon.headers.get('location') ?? '').includes('%2Fadmin%2Flogs'),
  anon.headers.get('location'))

/* ── 단일 화면 · 헤더 ─────────────────────────────────────────── */
console.log('\n§14.3 — 단일 화면 (전체 이력 + 이상 플래그)')
const res = await get()
const html = await res.text()
check('200 반환', res.status === 200, res.status)
check('실행 ID 표시', html.includes(EXEC))
check('행사명 표시', html.includes(행사명))
check('전체 행 수 표시 (5행)', html.includes('5행'), true)

/* ── 컬럼 순서 (§14.3) ────────────────────────────────────────── */
console.log('§14.3 — 표 컬럼 순서')
const COLUMNS = ['타임스탬프', '시도', '재시도', '단계명', '판정', '상태', '입력', '출력']
const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'))
const positions = COLUMNS.map((c) => head.indexOf(c))
check('8개 컬럼이 전부 있다', positions.every((p) => p >= 0),
  COLUMNS.filter((_, i) => positions[i] < 0))
check('순서가 규정과 일치한다 (타임스탬프 → … → 출력)',
  positions.every((p, i) => i === 0 || p > positions[i - 1]), positions)

/* ── 탭 (§14.3) ───────────────────────────────────────────────── */
console.log('§14.3 — category 탭 3종 (파이프라인 기본)')
check('파이프라인 탭이 기본 — 파이프라인 행이 보인다', html.includes('소개서 생성'))
check('기본 탭에 상태변경 행이 섞이지 않는다', !html.includes('>게시<'), true)
check('기본 탭에 신청 행이 섞이지 않는다', !html.includes('신청 접수'), true)
check('탭 3개 이름 표시',
  ['파이프라인', '상태변경', '신청·메일'].every((t) => html.includes(t)))

const lifecycle = await (await get('?tab=lifecycle')).text()
check('상태변경 탭 — published 행', lifecycle.includes('published'))
check('상태변경 탭에 파이프라인 행이 없다', !lifecycle.includes('소개서 생성'), true)

const application = await (await get('?tab=application')).text()
check('신청·메일 탭 — application_received 행', application.includes('신청 접수'))

const garbage = await (await get('?tab=nope'))
const garbageHtml = await garbage.text()
check('알 수 없는 탭은 기본 탭으로 떨어진다',
  garbage.status === 200 && garbageHtml.includes('소개서 생성'), garbage.status)

/* ── 판정 열 (§5.4·§14.3) ─────────────────────────────────────── */
console.log('§14.3 — 판정 열은 저장값을 표시값으로 바꾼다')
check('통과 표시', html.includes('통과'))
check('반려 표시', html.includes('반려'))
const { data: stored } = await db.from('execution_logs').select('verdict').eq('execution_id', EXEC)
check('DB에는 영어로만 저장돼 있다 (표시 문자열을 저장하지 않는다)',
  (stored ?? []).every((r: { verdict: string }) => ['pass', 'fail', '-'].includes(r.verdict)),
  stored)

/* ── 시도·재시도 구분 (§14.3) ─────────────────────────────────── */
console.log('§14.3 — 시도와 재시도를 구분해 표시')
/*
 * `tbody` 안에서만 센다. App Router는 RSC 페이로드를 같은 HTML에 함께 실어
 * 보내므로 문서 전체를 세면 같은 문자열이 여러 번 잡힌다 — 화면에 몇 행이
 * 그려졌는지를 보려면 표 본문으로 범위를 좁혀야 한다.
 */
const tbody = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'))
check('같은 단계가 retry_index 0·1로 2행 누적',
  (tbody.match(/brochure_generated/g) ?? []).length === 2,
  (tbody.match(/brochure_generated/g) ?? []).length)
check('파이프라인 탭에 3행이 그려진다', (tbody.match(/<tr /g) ?? []).length === 3,
  (tbody.match(/<tr /g) ?? []).length)

/* ── 타임스탬프 (§14.3) ───────────────────────────────────────── */
console.log('§14.3 — UTC ISO 8601')
const { data: first } = await db.from('execution_logs').select('created_at')
  .eq('execution_id', EXEC).order('id').limit(1).single()
const firstStamp = first ? new Date(first.created_at).toISOString() : ''
check('저장된 시각이 ISO 8601 UTC로 표시된다',
  !!firstStamp && html.includes(firstStamp), firstStamp)

/* ── 입력·출력 원본 (§14.3) ───────────────────────────────────── */
console.log('§14.3 — 입력·출력은 가공·요약 없이 원본 JSON')
check('입력 원본이 그대로 있다', html.includes('1234') && html.includes(행사명))
check('출력 원본이 그대로 있다', html.includes('검증영역'))

/* ── 마스킹 (§5.4) ────────────────────────────────────────────── */
console.log('§5.4 — application 행의 개인정보를 화면에서 복원하지 않는다')
check('마스킹된 이름이 그대로 표시된다', application.includes('홍*동'))
check('마스킹된 이메일이 그대로 표시된다', application.includes('ho***@example.com'))
check('마스킹된 연락처가 그대로 표시된다', application.includes('010-****-5678'))

/* ── 이상 플래그 (§5.5) ───────────────────────────────────────── */
console.log('§14.3·§5.5 — 이상 플래그는 같은 화면 하단에, 감지된 것만')
check('2건 표시', html.includes('2건'), true)
check('재시도 누적 (한글 표기)', html.includes('재시도 누적'))
check('처리 지연 (한글 표기)', html.includes('처리 지연'))
check('detail 원문 표시', html.includes('요청 소요 22.4초.'))
check('감지되지 않은 유형은 나열하지 않는다',
  !html.includes('일정 부분 채움') && !html.includes('중단 확정'), true)
check('플래그는 탭과 무관하게 보인다', application.includes('재시도 누적'))

/* ── 없는 실행 ────────────────────────────────────────────────── */
console.log('없는 execution_id')
const missing = await fetch(`${BASE}/admin/logs/does-not-exist-${process.pid}`, {
  headers: { cookie }, redirect: 'manual',
})
check('404 반환', missing.status === 404, missing.status)

/* ── 정리 ─────────────────────────────────────────────────────── */
if (!process.env.KEEP) {
  await db.from('abnormality_flags').delete().eq('execution_id', EXEC)
  await db.from('execution_logs').delete().eq('execution_id', EXEC)
  await db.from('products').delete().eq('execution_id', EXEC)
  console.log('\n임시 데이터 정리 완료. (KEEP=1로 보존 가능)')
}

console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
