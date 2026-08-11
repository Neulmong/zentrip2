/**
 * 낙관적 잠금 전 라우트 실측 (§16.1.1 · AA-01·AA-02). **AI 0회.**
 *
 * ## 왜 필요한가
 *
 * §16.1.1은 「**모든 쓰기 라우트**가 클라이언트가 읽은 시점의 `updated_at`을
 * 받아 조건부로 갱신하고, 어긋나면 409 `stale`」이라고 규정한다.
 * 적용 대상은 §14.4의 **#2~8 · #10~13 · #18**이다.
 *
 * 그런데 실측은 `publish`·`DELETE` 2건에만 있었다. 나머지 11개는
 * 「구현했다고 믿고 있을 뿐」이었다 — 낙관적 잠금은 **빠져 있어도 평소에는
 * 아무 증상이 없다.** 두 사람이 동시에 조작할 때만 조용히 덮어쓴다.
 *
 * ## 재는 방법
 *
 * 일부러 **낡은 `updated_at`**을 보낸다. 라우트가 그것을 받아 대조한다면
 * 409 `stale`이 나와야 한다. 무시한다면 다른 코드가 나온다 —
 * 그 자체가 「이 라우트에는 잠금이 없다」는 증거다.
 *
 * AI를 부르지 않는다: 잠금 검사는 **작업 전에** 끝나야 하기 때문이다.
 * 25초짜리 AI 호출을 태운 뒤에 「낡았습니다」라고 하는 것은 낭비다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:stale
 */
import { createClient } from '@supabase/supabase-js'
import { FIXTURE_PAGE } from '../components/page/fixture'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const STALE = '2020-01-01T00:00:00.000Z'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? `  → ${JSON.stringify(got)}` : ''}`) }
}

const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
})
if (!login.ok) { console.error('로그인 실패 — dev 서버가 떠 있는지 확인하세요.'); process.exit(1) }
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

/* ── 상태 만들기 ──────────────────────────────────────────────────
 * 각 라우트의 시작 조건(§14.5)을 충족시켜야 잠금 검사에 도달한다.
 * 조건에서 막히면 409 precondition이 나와 잠금 여부를 잴 수 없다.
 * ───────────────────────────────────────────────────────────────── */
const axis = (v: 'pass' | 'fail') => ({ verdict: v, items: [] })
const snapshot = (axes: Record<string, unknown>) => ({
  attempt_no: 1, verdict: 'pass', validated_at: new Date().toISOString(),
  content_hash: null,
  axes: { axis_0: null, axis_1: null, axis_2: null, axis_3: null, ...axes },
})

/** 폼 필드는 §7.4의 실제 이름을 쓴다 — `test-api.mts`와 같은 값이다. */
const FORM_FIELDS: Record<string, string> = {
  행사명: '동시성 검증용', 여행지: '제주',
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
  여행스타일: '자연', 여행주제: '제주 걷기와 로컬 맛집 휴식',
  기획메모: '',
}

const BROCHURE = { sections: [], schema_version: 1 }

const created: string[] = []

/**
 * **실제 라우트로 만든 뒤** 필요한 상태만 DB로 덧칠한다.
 *
 * `form_input`을 손으로 쓰면 §7.4 구조가 조금만 어긋나도 라우트가 500으로
 * 죽고, 그게 「잠금이 없다」로 잘못 읽힌다. 실제로 `숙박.숙박일정`을 빠뜨려
 * 그 일이 있었다. 만드는 것은 진짜 경로에 맡긴다.
 */
async function seed(patch: Record<string, unknown>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(FORM_FIELDS)) fd.set(k, v)
  const res = await fetch(`${BASE}/api/products`, { method: 'POST', headers: { cookie }, body: fd })
  const body = await res.json().catch(() => ({}))
  if (!body.product_id) { console.error('시드 실패:', body); process.exit(1) }
  created.push(body.product_id)

  const row = (await db.from('products').select('*').eq('id', body.product_id).single()).data!
  if (Object.keys(patch).length === 0) return row

  // confirmed_data가 필요한 상태는 form_input에서 파생시킨다 — 값을 지어내지 않는다.
  const { data, error } = await db.from('products')
    .update(patch).eq('id', body.product_id).select().single()
  if (error) { console.error('시드 상태 설정 실패:', error.message); process.exit(1) }
  return data
}

/** `form_input`을 그대로 승계한 최소 확정 데이터표. 값을 새로 만들지 않는다. */
function confirmedFrom(row: { form_input: Record<string, never> }) {
  const fi = row.form_input as unknown as {
    행사정보: Record<string, string>; 숙박: Record<string, string>
    항공: Record<string, string>; 식사: Record<string, string>
    가격: Record<string, string>; 상점: Record<string, string>
  }
  return {
    ...fi,
    행사정보: {
      ...fi.행사정보,
      여행기간: `${fi.행사정보.여행기간_시작} ~ ${fi.행사정보.여행기간_종료}`,
      일정: [{ day: '1', 원문근거: '1일: 김해공항 출발', 내용: '김해공항에서 출발합니다.' }],
    },
  }
}

/** confirmed_data가 필요한 상태 — form_input에서 파생시켜 덧칠한다. */
async function seedWithConfirmed(patch: Record<string, unknown>) {
  const base = await seed({})
  const { data, error } = await db.from('products')
    .update({ confirmed_data: confirmedFrom(base), ...patch })
    .eq('id', base.id).select().single()
  if (error) { console.error('시드 실패:', error.message); process.exit(1) }
  return data
}

async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

/** 낡은 updated_at을 보내면 409 stale이어야 한다(§16.1.1). */
async function expectStale(
  num: number, name: string,
  make: () => Promise<{ id: string }>,
  call: (id: string) => Promise<{ status: number; body: Record<string, unknown> }>,
) {
  const p = await make()
  const r = await call(p.id)
  const ok = r.status === 409 && r.body?.reason === 'stale'
  check(`#${num} ${name}`, ok, ok ? undefined : { 받은응답: r.status, body: r.body })
}

console.log('\n§16.1.1 — 낡은 updated_at을 보내면 409 stale이다')
console.log('  (적용 대상: §14.4의 #2~8 · #10~13 · #18)\n')

/* ── 파이프라인 계열 #2~7 ────────────────────────────────────────── */
await expectStale(2, 'POST /decompose',
  () => seed({}),
  (id) => send(`/api/products/${id}/decompose`, 'POST', { updated_at: STALE }))

await expectStale(3, 'POST /brochure',
  () => seedWithConfirmed({ validation_snapshot: snapshot({ axis_0: axis('pass') }) }),
  (id) => send(`/api/products/${id}/brochure`, 'POST', { updated_at: STALE }))

await expectStale(4, 'POST /validate-brochure',
  () => seedWithConfirmed({ brochure_content: BROCHURE,
    validation_snapshot: snapshot({ axis_0: axis('pass') }) }),
  (id) => send(`/api/products/${id}/validate-brochure`, 'POST', { updated_at: STALE }))

await expectStale(5, 'POST /page',
  () => seedWithConfirmed({ status: 'brochure_ready', brochure_content: BROCHURE,
    validation_snapshot: snapshot({ axis_0: axis('pass'), axis_1: axis('pass') }) }),
  (id) => send(`/api/products/${id}/page`, 'POST', { updated_at: STALE }))

await expectStale(6, 'POST /validate-page',
  () => seedWithConfirmed({ brochure_content: BROCHURE, page_content: FIXTURE_PAGE,
    validation_snapshot: snapshot({ axis_0: axis('pass'), axis_1: axis('pass') }) }),
  (id) => send(`/api/products/${id}/validate-page`, 'POST', { updated_at: STALE }))

await expectStale(7, 'POST /validate-consistency',
  () => seedWithConfirmed({ brochure_content: BROCHURE, page_content: FIXTURE_PAGE,
    validation_snapshot: snapshot({
      axis_0: axis('pass'), axis_1: axis('pass'), axis_2: axis('pass') }) }),
  (id) => send(`/api/products/${id}/validate-consistency`, 'POST', { updated_at: STALE }))

/* ── 사람이 누르는 계열 #8 · #17 ─────────────────────────────────── */
await expectStale(8, 'POST /regenerate',
  () => seedWithConfirmed({ status: 'brochure_ready', brochure_content: BROCHURE,
    validation_snapshot: snapshot({ axis_0: axis('pass'), axis_1: axis('pass') }) }),
  (id) => send(`/api/products/${id}/regenerate`, 'POST', { updated_at: STALE }))

await expectStale(17, 'PATCH /form-input',
  () => seed({ status: 'input_error', failure_reason: '테스트' }),
  async (id) => {
    // #17은 multipart다 — 이미지를 함께 받기 때문이다(§14.4 #17).
    const fd = new FormData()
    for (const [k, v] of Object.entries({
      행사명: '동시성 검증용', 여행지: '제주',
      여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
      일정원문: '1일: 도착\n2일: 관광\n3일: 자유\n4일: 귀국',
      숙소명: '롯데호텔 제주', 객실타입: '디럭스룸', 위치: '중문',
      상점명: '제주 로컬 기념품 숍', 상점정보: '10% 할인',
      가격_성인: '120000', 가격_아동: '해당 없음', 가격_기타: '항공료 별도',
      식사정보: '조식 3회', 여행스타일: '자연', 여행주제: '제주 걷기와 로컬 맛집 휴식', updated_at: STALE,
    })) fd.set(k, v)
    const r = await fetch(`${BASE}/api/products/${id}/form-input`, {
      method: 'PATCH', headers: { cookie }, body: fd,
    })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  })

/* ── 편집·게시 계열 #10~13 · #18 ─────────────────────────────────── */
await expectStale(10, 'PATCH /content',
  () => seed({ status: 'draft', page_content: FIXTURE_PAGE,
    validation_snapshot: snapshot({ axis_0: axis('pass') }) }),
  (id) => send(`/api/products/${id}/content`, 'PATCH',
    { updated_at: STALE, page_content: FIXTURE_PAGE }))

await expectStale(11, 'PATCH /slug',
  () => seed({ status: 'draft', page_content: FIXTURE_PAGE, slug: `st-${Date.now() % 100000}` }),
  (id) => send(`/api/products/${id}/slug`, 'PATCH', { updated_at: STALE, slug: 'new-slug-here' }))

await expectStale(12, 'POST /publish',
  () => seed({ status: 'draft', page_content: FIXTURE_PAGE, slug: `sp-${Date.now() % 100000}`,
    validation_snapshot: snapshot({
      axis_0: axis('pass'), axis_1: axis('pass'), axis_2: axis('pass'), axis_3: axis('pass') }) }),
  (id) => send(`/api/products/${id}/publish`, 'POST', { updated_at: STALE }))

await expectStale(13, 'POST /unpublish',
  () => seed({ status: 'published', page_content: FIXTURE_PAGE,
    slug: `su-${Date.now() % 100000}`, published_at: new Date().toISOString() }),
  (id) => send(`/api/products/${id}/unpublish`, 'POST', { updated_at: STALE }))

await expectStale(18, 'DELETE /api/products/{id}',
  () => seed({ status: 'draft', page_content: FIXTURE_PAGE }),
  (id) => send(`/api/products/${id}`, 'DELETE', { updated_at: STALE }))

/* ── 정상 흐름 — 잠금이 **일을 막지는 않는다** ───────────────────── */
console.log('\n§16.1.1 — 맞는 updated_at은 통과하고, 새 값을 돌려준다')
{
  const p = await seedWithConfirmed({
    status: 'brochure_ready', brochure_content: BROCHURE,
    validation_snapshot: snapshot({ axis_0: axis('pass'), axis_1: axis('pass') }),
  })
  const r = await send(`/api/products/${p.id}/regenerate`, 'POST', { updated_at: p.updated_at })
  check('맞는 값이면 200이다', r.status === 200, r)
  check('응답이 **새** updated_at을 준다 (다음 단계가 이어서 쓴다)',
    typeof r.body?.updated_at === 'string' && r.body.updated_at !== p.updated_at,
    { 보낸값: p.updated_at, 받은값: r.body?.updated_at })

  // 같은 값을 두 번 쓰면 두 번째는 낡은 값이다 — 잠금이 실제로 작동한다는 증거.
  const again = await send(`/api/products/${p.id}/regenerate`, 'POST', { updated_at: p.updated_at })
  check('같은 값을 재사용하면 409 stale이다 (덮어쓰기가 막힌다)',
    again.status === 409 && again.body?.reason === 'stale', again)

  // 서버가 준 새 값으로는 다시 통과해야 한다 — 잠금이 진행을 막으면 안 된다.
  const next = await send(`/api/products/${p.id}/regenerate`, 'POST',
    { updated_at: r.body.updated_at })
  check('서버가 준 새 값으로는 다시 통과한다', next.status === 200, next)
}

/* ── 값을 안 보내는 호출부는 400으로 죽지 않는다 ─────────────────── */
console.log('\n하위 호환 — updated_at을 안 보내도 400으로 죽지 않는다')
{
  const p = await seedWithConfirmed({
    status: 'brochure_ready', brochure_content: BROCHURE,
    validation_snapshot: snapshot({ axis_0: axis('pass'), axis_1: axis('pass') }),
  })
  const r = await send(`/api/products/${p.id}/regenerate`, 'POST', {})
  check('#8 값 없이도 동작한다 (조건부 갱신이 뒤에서 막는다)', r.status === 200, r)
}

/* ── 미적용 대상이 정말 미적용인지 (§16.1.1) ─────────────────────── */
console.log('\n§16.1.1 — 미적용 대상은 잠금을 요구하지 않는다')
{
  const r = await fetch(`${BASE}/api/products`, {
    method: 'GET', headers: { cookie },
  })
  check('조회 라우트는 updated_at 없이도 동작한다', r.status !== 400, r.status)
}

/* ── 정리 ─────────────────────────────────────────────────────────── */
if (process.env.KEEP !== '1') {
  for (const id of created) await db.from('products').delete().eq('id', id)
  console.log('\n임시 데이터 정리 완료. (KEEP=1로 보존 가능)')
}

console.log('\n' + '─'.repeat(52))
console.log(`통과 ${pass} · 실패 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
