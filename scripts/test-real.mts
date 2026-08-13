/**
 * **실제 기획 메모 하나를 자연어 초안부터 게시까지 §20 순서대로 통째로 관통한다.**
 *
 * 관건은 **입력의 크기**다. 소규모 픽스처는 숙소 2행·상점 3행이지만 실제 메모는
 * **숙소 2곳 + 카페·음식점 13곳 + 여행지 포인트 7곳**이다.
 * 검증 2종(`fact-check`)은 `form_input`을 통째로 프롬프트에 싣기 때문에(§11.1)
 * 그 크기가 25~40초 예산에 그대로 얹힌다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:real
 *
 * **AI 6회**를 쓴다 (초안 1 + 파이프라인 5).
 *
 * ## 데이터를 지우지 않는다
 *
 * 이 스크립트의 목적은 **사람이 브라우저로 열어 보는 것**이다. 끝나면 관리 화면과
 * 공개 페이지 주소를 출력한다. 지우려면 `/admin`에서 삭제한다(§12.4).
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

let pass = 0, fail = 0
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${n}`) }
  else { fail++; console.log(`  ❌ ${n}${got !== undefined ? `\n       → ${JSON.stringify(got, null, 2)}` : ''}`) }
}
const section = (t: string) => console.log(`\n${t}`)
const T0 = Date.now()
const at = () => `${((Date.now() - T0) / 1000).toFixed(0)}초`

/** 기획자가 실제로 준 메모. 손대지 않는다 */
const MEMO = `-여행일정: 4박5일 (11.04~11.08)
-여행주제: 제주걷기와 로컬분위기 맛집과 카페에서의 휴식
-여행객 페르소나:
긍뮹권에서 일하는 동기생 A, B는 혼자서 하기에는 부담되는 걷기 축제를 함께가서 제주의 가을을 제대로 만끽하고 싶어한다. 회사에서의 스트레스는 제주의 맛집과 카페에서 날려버리고 재충전하는 시간을 기대하는 29세와 31세의 연령의 여성이다. 2곳의 숙소에서 1곳은 고가의 제주구옥에서 다른 한곳은 마을안에 있는 타운하우스에서 숙박을 하며 마을 속 에서 머물고자 한다.
-행사: 제주올레걷기축제 (11.05~11.07) (관련기사: https://www.yna.co.kr/view/AKR20260708117400056)
-숙박:
 조금불편해도괜잖아 (구좌읍 김녕로1길 35-24), 고요한하루 (북선로 241)
-카페 및 음식점:
 시간을담다 (구좌읍 평대7길)
 마레1440 (구좌읍 해맞이해안로 1440)
 더모먼트김녕 (구좌읍 김녕로22길3)
 종달달 (구좌읍 종달로 60-12)
 카페술도가제주바당 (구좌읍 한동로27)
 보롬창고 구좌읍 종달항길3)
 so much more (조천읍 북촌11길25)
 공든 (조천읍 신북로 267)
 자드부팡 (조천읍 선흘리 954)
 터치우드 (조천읍 함대로 160)
 프레투스 (구좌읍 중산간동로 1875)
 아끈식당 (조천읍 신촌북2길 31-3)
 함덕골목해장국 (조천읍 조천북길62)
-여행지 포인트
 함덕해수욕장
 닭머르 (노을뷰)
 김녕해수욕장, 세기알
 선흘리마을
 송당리마을
 아부오름
 서우봉`

const 상호 = [
  '조금불편해도괜잖아', '고요한하루',
  '시간을담다', '마레1440', '더모먼트김녕', '종달달', '카페술도가제주바당', '보롬창고',
  'so much more', '공든', '자드부팡', '터치우드', '프레투스', '아끈식당', '함덕골목해장국',
]

/* ══ 로그인 ═══════════════════════════════════════════════════════ */
section('0. 로그인')
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
})
check('로그인 200', login.ok, login.status)
if (!login.ok) { console.error('\ndev 서버와 ADMIN_PASSWORD를 확인한다.'); process.exit(1) }
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

/* ══ 1. 자연어 초안 (#20 · AI 1회) ══════════════════════════════ */
section('1. 자연어 메모 → 폼 초안 (#20 · AI 1회)')
const t1 = Date.now()
const draftRes = await fetch(`${BASE}/api/plan-draft`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie },
  // 메모에 연도가 없으므로 사람이 고른 날짜를 함께 보낸다(§7.5)
  body: JSON.stringify({ text: MEMO, 여행기간_시작: '2026-11-04', 여행기간_종료: '2026-11-08' }),
})
const draftBody = await draftRes.json().catch(() => ({}))
check(`200 반환 (${((Date.now() - t1) / 1000).toFixed(1)}초)`, draftRes.status === 200,
  { status: draftRes.status, body: draftBody })
if (draftRes.status !== 200) { console.error('\n409면 AI 실패다. 다시 실행한다.'); process.exit(1) }

const d = draftBody.draft
console.log(`\n  숙박 ${d.숙박.length}행 · 상점 ${d.상점.length}행`)
console.log(d.행사정보.일정원문.split('\n').map((l: string) => `    ${l}`).join('\n'))

const haystack = [
  d.행사정보.일정원문,
  ...d.숙박.map((s: { 숙소명: string }) => s.숙소명),
  ...d.상점.map((s: { 상점명: string }) => s.상점명),
].join(' ')
check(`상호 ${상호.length}곳이 초안에 전부 있다`,
  상호.every((n) => haystack.includes(n)), 상호.filter((n) => !haystack.includes(n)))

/* ══ 2. 상품 등록 (#1 · AI 0회) ═════════════════════════════════ */
section('2. 초안 → 상품 등록 (#1) — 사람이 가격만 채운다')
const fd = new FormData()
const g = d.행사정보
for (const [k, v] of Object.entries({
  행사명: g.행사명, 여행지: g.여행지,
  여행기간_시작: g.여행기간_시작, 여행기간_종료: g.여행기간_종료,
  일정원문: g.일정원문, 타겟층: g.타겟층, 여행스타일: g.여행스타일,
  여행주제: g.여행주제, 기획메모: g.기획메모,
  식사정보: d.식사.식사정보,
  // 초안이 비워 둔 칸 — 기획자가 채우는 값이다(§7.5 ③)
  가격_성인: '390000', 가격_아동: '해당 없음', 가격_기타: '항공료 별도 · 숙박 2곳 이동',
})) fd.set(k, String(v ?? ''))

d.숙박.forEach((st: Record<string, string>, i: number) => {
  for (const f of ['숙소명', '위치', '객실타입', '숙박일정']) fd.set(`숙박[${i}].${f}`, st[f] ?? '')
})
d.상점.forEach((sh: Record<string, string>, i: number) => {
  for (const f of ['상점명', '구분', '위치', '상점정보']) fd.set(`상점[${i}].${f}`, sh[f] ?? '')
})
// 카페 한 곳만 사람이 제휴로 올린다 — AI는 이 값을 올리지 않는다(§6.1)
fd.set('상점[0].구분', '제휴')

const created = await (await fetch(`${BASE}/api/products`, {
  method: 'POST', headers: { cookie }, body: fd,
})).json()
check('등록 200 + product_id', typeof created.product_id === 'string', created)
if (!created.product_id) process.exit(1)
const pid: string = created.product_id

const saved = (await db.from('products').select('form_input').eq('id', pid).single())
  .data?.form_input as { 숙박: { 숙소명: string }[]; 상점: { 상점명: string; 구분: string }[] }
check(`숙박 ${saved.숙박.length}행 · 상점 ${saved.상점.length}행이 그대로 저장된다`,
  saved.숙박.length === d.숙박.length && saved.상점.length === d.상점.length,
  { 숙박: saved.숙박.length, 상점: saved.상점.length })
console.log(`     form_input 크기: ${JSON.stringify(saved).length}자`)

/* ══ 3. 파이프라인 7요청 (AI 5회) ═══════════════════════════════ */
section('3. 소개서 4요청 + 상품 3요청 (AI 5회) — 검증 2종이 이 입력을 통째로 싣는다')

let updatedAt: string | undefined = await (async () => {
  const r = await fetch(`${BASE}/api/products/${pid}`, { headers: { cookie } })
  const seen = await r.json().catch(() => ({}))
  return typeof seen?.updated_at === 'string' ? seen.updated_at : undefined
})()

const post = async (path: string, body?: unknown) => {
  const r = await fetch(`${BASE}/api/products/${pid}/${path}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ ...(updatedAt ? { updated_at: updatedAt } : {}), ...(body ?? {}) }),
  })
  const parsed = { status: r.status, body: await r.json().catch(() => ({})) }
  const next = (parsed.body as { updated_at?: unknown })?.updated_at
  if (typeof next === 'string') updatedAt = next
  return parsed
}

/** 실제 클라이언트처럼 409 `retry`를 재시도한다(§4.2 · `lib/client/run-pipeline.ts`) */
async function step(path: string, tries = 3) {
  for (let n = 1; n <= tries; n++) {
    const t = Date.now()
    const r = await post(path)
    const 초 = ((Date.now() - t) / 1000).toFixed(1)
    if (r.status === 200) { console.log(`     ${path} 200 · ${초}초`); return r }
    if (r.status === 409 && r.body?.reason === 'retry') {
      const waitMs = Number(r.body.retry_after_ms ?? 2000)
      console.log(`     ↻ ${path} 409 retry · ${초}초 — ${Math.round(waitMs / 1000)}초 대기 (${n}/${tries})`)
      await new Promise((res) => setTimeout(res, waitMs))
      continue
    }
    console.log(`     ${path} ${r.status} · ${초}초`)
    return r
  }
  return post(path)
}

const 실패축 = (body: unknown): string | null => {
  const axes = (body as { axes?: Record<string, { verdict?: string } | null> })?.axes
  for (const [name, r] of Object.entries(axes ?? {})) if (r?.verdict === 'fail') return name
  return null
}

for (const path of ['decompose', 'brochure', 'validate-brochure', 'page', 'validate-page', 'validate-consistency']) {
  const r = await step(path)
  const 실패 = 실패축(r.body)
  check(`${path} 완료 (축 fail 없음)`, r.status === 200 && !실패,
    실패 ? { 실패축: 실패, items: (r.body as { items?: unknown }).items } : r.body)
  if (r.status !== 200) break
}

const row = (await db.from('products').select('*').eq('id', pid).single()).data as {
  status: string; slug: string | null; execution_id: string
  validation_snapshot: { axes?: Record<string, { verdict?: string } | null> } | null
  page_content: { sections: { id: string; data: Record<string, unknown> }[] } | null
}
check('status = draft (§15.2)', row.status === 'draft', row.status)
check('검증 4축 전부 pass',
  ['axis_0', 'axis_1', 'axis_2', 'axis_3']
    .every((a) => row.validation_snapshot?.axes?.[a]?.verdict === 'pass'),
  row.validation_snapshot?.axes)

/* ══ 4. 배열이 페이지까지 온전히 갔는가 ═════════════════════════ */
section('4. 상점 13곳이 page_content까지 온전히 갔는가 (§9.3)')
const 상점들 = row.page_content?.sections.find((s) => s.id === 'sec_shop')
  ?.data.상점들 as { 상점명: string; 구분: string }[] | undefined
const 숙소들 = row.page_content?.sections.find((s) => s.id === 'sec_accommodation')
  ?.data.숙소들 as { 숙소명: string }[] | undefined

check(`페이지 상점 ${상점들?.length}행 = 입력 ${saved.상점.length}행`,
  상점들?.length === saved.상점.length, 상점들?.map((s) => s.상점명))
check(`페이지 숙소 ${숙소들?.length}행 = 입력 ${saved.숙박.length}행`,
  숙소들?.length === saved.숙박.length, 숙소들?.map((s) => s.숙소명))
check('사람이 올린 `제휴`가 페이지까지 유지된다', 상점들?.[0].구분 === '제휴', 상점들?.[0])

/* ══ 5. 게시 — 브라우저로 볼 수 있게 ═══════════════════════════ */
section('5. 게시 (§12.2)')
const SLUG = `jeju-olle-${Date.now().toString(36)}`
const slugRes = await fetch(`${BASE}/api/products/${pid}/slug`, {
  method: 'PATCH', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ slug: SLUG, updated_at: row.slug ? undefined : undefined }),
})
if (slugRes.status !== 200) {
  const fresh = (await db.from('products').select('updated_at').eq('id', pid).single()).data!
  await fetch(`${BASE}/api/products/${pid}/slug`, {
    method: 'PATCH', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: SLUG, updated_at: fresh.updated_at }),
  })
}
const beforePublish = (await db.from('products').select('updated_at').eq('id', pid).single()).data!
const published = await fetch(`${BASE}/api/products/${pid}/publish`, {
  method: 'POST', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ updated_at: beforePublish.updated_at }),
})
check('게시 200', published.status === 200, await published.clone().text())

const publicHtml = await (await fetch(`${BASE}/p/${SLUG}`)).text()
const 빠진것 = 상호.filter((n) => !publicHtml.includes(n))
check(`공개 페이지에 상호 ${상호.length}곳이 전부 보인다`, 빠진것.length === 0, 빠진것)

/* ══ 결과 ═══════════════════════════════════════════════════════ */
console.log(`\n${'─'.repeat(64)}`)
console.log(`통과 ${pass} · 실패 ${fail} · 총 ${at()}`)
console.log(`\n브라우저로 열어 보세요 (데이터를 남겼습니다):`)
console.log(`  공개 페이지   ${BASE}/p/${SLUG}`)
console.log(`  편집기        ${BASE}/admin/products/${pid}/edit`)
console.log(`  검토 화면     ${BASE}/admin/products/${pid}`)
console.log(`  실행 로그     ${BASE}/admin/logs/${row.execution_id}`)
console.log(`  폼 재현       ${BASE}/new   ← 「자연어로 입력」에 메모를 붙여넣어 직접 확인`)
if (fail > 0) process.exit(1)
