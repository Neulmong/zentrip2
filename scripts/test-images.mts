/**
 * F 섹션 — 이미지 슬롯·업로드 실측 (§7.3·§5.2·§16.1.1). **AI 0회.**
 *
 * 체크리스트 F 섹션은 [필수] 12개인데 실제로 **파일을 올리는 테스트가 없었다.**
 * `lib/images.ts`가 순수 모듈이라 규칙은 읽어서 확인할 수 있지만, F-01·F-11·F-13은
 * 「저장된 결과」가 판정 대상이라 실제 업로드 없이는 잴 수 없다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:images
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})
const STORAGE_BUCKET = 'product-images'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? `  → ${JSON.stringify(got)}` : ''}`) }
}
const section = (t: string) => console.log(`\n${t}`)

/* ── 로그인 ───────────────────────────────────────────────────── */
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
})
if (!login.ok) { console.error('로그인 실패 — dev 서버가 떠 있는지 확인하세요.'); process.exit(1) }
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

/* ── 시험용 파일 ───────────────────────────────────────────────
 * 1x1 PNG. 실제 이미지 바이트를 쓴다 — Storage가 받아 주는지까지 재려면
 * 껍데기 바이트로는 부족하다.
 * ───────────────────────────────────────────────────────────── */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const img = (name = 'a.png', type = 'image/png', bytes: Buffer = PNG_1X1) =>
  new File([new Uint8Array(bytes)], name, { type })

/** 4일 여행. itinerary_day_1~4가 존재하는 기간이다. */
function makeForm(over: Record<string, string> = {}) {
  const fd = new FormData()
  const base: Record<string, string> = {
    행사명: '이미지 검증용 상품', 여행지: '제주',
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
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v)
  return fd
}

const post = (fd: FormData) =>
  fetch(`${BASE}/api/products`, { method: 'POST', headers: { cookie }, body: fd })

const created: string[] = []
async function createWith(build: (fd: FormData) => void) {
  const fd = makeForm()
  build(fd)
  const res = await post(fd)
  const body = await res.json().catch(() => ({}))
  if (body.product_id) created.push(body.product_id)
  return { status: res.status, body }
}

const countProducts = async () =>
  (await db.from('products').select('id', { count: 'exact', head: true })).count ?? 0

/* ══ F-04 · F-02 — 거부되어야 하는 것들 ═══════════════════════ */
section('F-04 허용 포맷 (JPG/PNG/WebP)')
{
  const before = await countProducts()
  const r = await createWith((fd) => {
    fd.append('image:hero', img('doc.pdf', 'application/pdf', Buffer.from('%PDF-1.4')))
  })
  check('PDF 업로드가 400으로 거부된다', r.status === 400, r)
  check('사유에 형식이 적힌다', /형식/.test(r.body?.field_errors?.images ?? ''), r.body)
  check('거부 시 products 행이 생기지 않는다 (F-13 보상 삭제)',
    (await countProducts()) === before)
}

section('F-02 슬롯별 개수 상한')
for (const [slot, max, over] of [
  ['hero', 1, 2], ['accommodation', 3, 4], ['shop', 2, 3],
] as [string, number, number][]) {
  const r = await createWith((fd) => {
    for (let i = 0; i < over; i++) fd.append(`image:${slot}`, img(`${slot}${i}.png`))
  })
  check(`${slot} ${over}장은 거부된다 (상한 ${max})`, r.status === 400, r.status)
}
{
  const r = await createWith((fd) => {
    fd.append('image:itinerary_day_1', img('d1a.png'))
    fd.append('image:itinerary_day_1', img('d1b.png'))
  })
  check('itinerary_day_1 2장은 거부된다 (일차별 1장)', r.status === 400, r.status)
}

section('F-02 gallery 슬롯이 존재하지 않는다')
{
  const r = await createWith((fd) => fd.append('image:gallery', img()))
  check('gallery 슬롯이 거부된다', r.status === 400, r.status)
  check('사유가 "알 수 없는 슬롯"이다',
    /알 수 없는/.test(r.body?.field_errors?.images ?? ''), r.body)
}

section('F-03 itinerary_day_{n}은 여행 일수만큼만')
{
  const r = await createWith((fd) => fd.append('image:itinerary_day_5', img()))
  check('4일 여행에서 5일차 슬롯이 거부된다', r.status === 400, r.status)
}

section('F-02 장당 5MB')
{
  const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 1)
  const r = await createWith((fd) => fd.append('image:hero', img('big.png', 'image/png', big)))
  check('5MB 초과가 거부된다', r.status === 400, r.status)
  check('사유에 5MB가 적힌다', /5MB/.test(r.body?.field_errors?.images ?? ''), r.body)
}

/* ══ F-01 · F-05 · F-11 — 정상 업로드의 저장 결과 ═════════════ */
section('F-01 · F-05 · F-11 정상 업로드')
const ok = await createWith((fd) => {
  fd.append('image:hero', img('hero.png'))
  fd.append('image:accommodation', img('acc1.png'))
  fd.append('image:accommodation', img('acc2.jpg', 'image/jpeg'))
  fd.append('image:itinerary_day_2', img('day2.webp', 'image/webp'))
  fd.append('image:shop', img('shop.png'))
  // alt는 `alt:{slot}:{index}`. hero만 직접 넣고 나머지는 자동 채움을 본다.
  fd.set('alt:hero:0', '중문 해변의 일몰')
})
check('200 반환', ok.status === 200, ok)
const pid = ok.body?.product_id as string

if (!pid) {
  console.log('\n정상 업로드가 실패해 이후 검사를 진행할 수 없다.')
} else {
  const { data: rows } = await db
    .from('product_images').select('*').eq('product_id', pid)
    .order('slot').order('sort_order')
  const bySlot = new Map<string, typeof rows>()
  for (const r of rows ?? []) {
    if (!bySlot.has(r.slot)) bySlot.set(r.slot, [])
    bySlot.get(r.slot)!.push(r)
  }

  check('5장이 저장된다', rows?.length === 5, rows?.length)
  check('F-01 지정한 슬롯 그대로다 (AI 재배치 0건)',
    ['hero', 'accommodation', 'itinerary_day_2', 'shop'].every((s) => bySlot.has(s))
    && bySlot.get('accommodation')?.length === 2,
    [...bySlot.keys()])

  check('F-05 alt 입력분이 그대로 저장된다',
    bySlot.get('hero')?.[0]?.alt === '중문 해변의 일몰', bySlot.get('hero')?.[0]?.alt)
  check('F-05 alt 미입력분이 자동 채워진다 (빈 alt 0건)',
    (rows ?? []).every((r) => typeof r.alt === 'string' && r.alt.trim().length > 0),
    (rows ?? []).map((r) => r.alt))
  check('F-05 자동 채움이 `{행사명} {슬롯 한글명}` 형식이다',
    bySlot.get('itinerary_day_2')?.[0]?.alt === '이미지 검증용 상품 2일차 사진',
    bySlot.get('itinerary_day_2')?.[0]?.alt)

  check('F-11 경로가 {product_id}/{uuid}.{ext}다',
    (rows ?? []).every((r) => new RegExp(
      `^${pid}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp)$`,
    ).test(r.storage_path)),
    (rows ?? []).map((r) => r.storage_path))
  check('F-11 추측 가능한 순번 경로가 0건이다',
    !(rows ?? []).some((r) => /\/\d+\.(png|jpg|webp)$/.test(r.storage_path)))
  check('확장자가 MIME과 맞는다',
    bySlot.get('itinerary_day_2')?.[0]?.storage_path.endsWith('.webp') === true,
    bySlot.get('itinerary_day_2')?.[0]?.storage_path)

  // §5.2 — `sort_order`는 「**같은 슬롯 내** 순서」다.
  const accOrders = bySlot.get('accommodation')?.map((r) => r.sort_order) ?? []
  check('§5.2 sort_order가 같은 슬롯 안에서 0부터 매겨진다',
    JSON.stringify(accOrders) === JSON.stringify([0, 1]), accOrders)
  check('§5.2 단일 슬롯의 sort_order가 0이다',
    bySlot.get('shop')?.[0]?.sort_order === 0, bySlot.get('shop')?.[0]?.sort_order)

  section('Storage에 실제 파일이 올라갔다')
  const first = rows?.[0]
  if (first) {
    const { data: blob } = await db.storage.from(STORAGE_BUCKET).download(first.storage_path)
    check('저장 경로에서 파일을 내려받을 수 있다', (blob?.size ?? 0) > 0, blob?.size)
  }
  check('bytes가 기록된다', (rows ?? []).every((r) => r.bytes > 0))
}

/* ══ F-12 — 절대 상한 ═════════════════════════════════════════ */
section('F-12 절대 상한 21장 (15일 여행 전 슬롯 만재)')
{
  // 4일 여행의 만재는 1+3+4+2 = 10장이다. 슬롯 상한을 지키면 자연히 만족한다.
  const r = await createWith((fd) => {
    fd.append('image:hero', img())
    for (let i = 0; i < 3; i++) fd.append('image:accommodation', img(`a${i}.png`))
    for (let d = 1; d <= 4; d++) fd.append(`image:itinerary_day_${d}`, img(`d${d}.png`))
    for (let i = 0; i < 2; i++) fd.append('image:shop', img(`s${i}.png`))
  })
  check('4일 여행 만재 10장이 통과한다 (1+3+4+2)', r.status === 200, r)
  if (r.body?.product_id) {
    const { count } = await db.from('product_images')
      .select('id', { count: 'exact', head: true }).eq('product_id', r.body.product_id)
    check('10장이 모두 저장된다', count === 10, count)
  }
}

/* ══ F-06 — 편집기에서 새 업로드 경로가 없다 ══════════════════ */
section('F-06 이미지 업로드는 /new 폼에서만')
if (pid) {
  const fd = new FormData()
  fd.append('image:hero', img())
  const r = await fetch(`${BASE}/api/products/${pid}/content`, {
    method: 'PATCH', headers: { cookie }, body: fd,
  })
  check('편집 저장 라우트는 multipart 업로드를 받지 않는다', r.status !== 200, r.status)
}

/* ── 정리 ─────────────────────────────────────────────────────── */
if (process.env.KEEP !== '1') {
  for (const id of created) {
    const { data: imgs } = await db.from('product_images')
      .select('storage_path').eq('product_id', id)
    const paths = (imgs ?? []).map((r) => r.storage_path as string)
    if (paths.length > 0) await db.storage.from(STORAGE_BUCKET).remove(paths).catch(() => {})
    await db.from('products').delete().eq('id', id)
  }
  console.log('\n임시 데이터 정리 완료. (KEEP=1로 보존 가능)')
}

console.log('\n' + '─'.repeat(52))
console.log(`통과 ${pass} · 실패 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
