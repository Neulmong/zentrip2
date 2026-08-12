/**
 * §12.4 상품 삭제 (#18) 통합 테스트 — 실제 dev 서버 + 실제 Supabase + Storage.
 * **AI 0회.**
 *
 * 삭제 범위가 규정의 핵심이다. 지워지는 것과 **남는 것**을 둘 다 확인한다 —
 * 로그가 함께 지워지면 사후 추적이 끊긴다(§12.4).
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:delete
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const BUCKET = 'product-images'
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

const EXEC = `test-delete-${process.pid}`
const 행사명 = '삭제 테스트 상품'

const formInput = {
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
}

/** 상품 1건 + 이미지 행·파일 + 편집 이력 + 로그 + 플래그를 한 벌로 심는다. */
async function seed(status: string, opts: { withApplication?: boolean } = {}) {
  const exec = `${EXEC}-${status}${opts.withApplication ? '-app' : ''}`
  {
    const { data: old } = await db.from('products').select('id')
      .eq('execution_id', exec).maybeSingle()
    if (old) await db.from('applications').delete().eq('product_id', old.id)
  }
  await db.from('execution_logs').delete().eq('execution_id', exec)
  await db.from('abnormality_flags').delete().eq('execution_id', exec)
  await db.from('products').delete().eq('execution_id', exec)

  const { data: p, error } = await db.from('products').insert({
    execution_id: exec, slug: `del-${status}-${process.pid}`, status,
    current_step: 'draft_registered', form_input: formInput,
    ...(status === 'published' ? { published_at: new Date().toISOString() } : {}),
  }).select().single()
  if (error) { console.error('시드 실패:', error.message); process.exit(1) }

  const path = `${p.id}/hero.txt`
  await db.storage.from(BUCKET).upload(path, new Blob(['test image bytes']), {
    contentType: 'text/plain', upsert: true,
  })
  await db.from('product_images').insert({
    product_id: p.id, slot: 'hero', storage_path: path, alt: '대표 이미지', sort_order: 0,
  })
  await db.from('edit_history').insert({
    product_id: p.id, action: 'update', section_id: 'sec_hero',
    before: { headline: 'a' }, after: { headline: 'b' },
  })
  await db.from('execution_logs').insert({
    execution_id: exec, product_id: p.id, category: 'pipeline', step: 'pipeline_started',
    attempt_no: 1, retry_index: 0, verdict: '-', status, input: {}, output: {},
  })
  await db.from('abnormality_flags').insert({
    execution_id: exec, product_id: p.id, attempt_no: 1,
    type: 'processing_delayed', step: 'page_generated', detail: '삭제 테스트용',
  })
  if (opts.withApplication) {
    await db.from('applications').insert({
      product_id: p.id, name: '홍길동', email: 'del@example.com', phone: '010-1111-2222',
      headcount: 1, consent_at: new Date().toISOString(),
      product_snapshot: { 행사명 },
    })
  }
  return { p, exec, path }
}

const del = (id: string, body?: unknown) => fetch(`${BASE}/api/products/${id}`, {
  method: 'DELETE',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
})

/* ── 금지 상태 (§12.4) ────────────────────────────────────────── */
console.log('\n§12.4 — published는 삭제할 수 없다')
const pub = await seed('published')
const pubRes = await del(pub.p.id, { updated_at: pub.p.updated_at })
const pubBody = await pubRes.json()
check('409 반환', pubRes.status === 409, pubRes.status)
check('reason = precondition (§14.6)', pubBody.reason === 'precondition', pubBody)
check('사유에 [게시 중단] 안내가 있다', /게시 중단/.test(pubBody.detail ?? ''), pubBody.detail)
const { data: stillPub } = await db.from('products').select('id').eq('id', pub.p.id).maybeSingle()
check('행이 남아 있다', !!stillPub)

/* ── 금지 조건 — 신청 존재 (§12.4) ────────────────────────────── */
console.log('\n§12.4 — 신청이 있으면 삭제할 수 없다 (고아 신청 방지 · AB-03)')
const withApp = await seed('draft', { withApplication: true })
const appRes = await del(withApp.p.id, { updated_at: withApp.p.updated_at })
const appBody = await appRes.json()
check('409 precondition', appRes.status === 409 && appBody.reason === 'precondition', appBody)
check('사유에 신청 내역 안내가 있다', /신청 내역/.test(appBody.detail ?? ''), appBody.detail)

// §12.4 「먼저 관리 화면에서 해당 신청 내역을 삭제한다」 — 그 경로가 실제로 길을 연다
const { data: apps } = await db.from('applications').select('id').eq('product_id', withApp.p.id)
await fetch(`${BASE}/api/applications/${apps![0].id}`, { method: 'DELETE', headers: { cookie } })
const { data: fresh } = await db.from('products').select('updated_at').eq('id', withApp.p.id).single()
const afterAppDel = await del(withApp.p.id, { updated_at: fresh!.updated_at })
check('신청을 지운 뒤에는 삭제된다 (§12.4가 안내한 순서)', afterAppDel.status === 200,
  await afterAppDel.clone().text())

/* ── §16.1.1 동시성 ─────────────────────────────────────────────── */
console.log('\n§16.1.1 — 조회 시점 검사')
const stale = await seed('draft')
const staleRes = await del(stale.p.id, { updated_at: '2020-01-01T00:00:00.000Z' })
check('낡은 updated_at은 409 stale', staleRes.status === 409, staleRes.status)
check('reason = stale', (await staleRes.json()).reason === 'stale')

/* ── 삭제 범위 (§12.4) ──────────────────────────────────────────── */
console.log('\n§12.4 — 삭제 범위: 지워지는 것과 남는 것')
const t = await seed('draft')
const { data: before } = await db.storage.from(BUCKET).list(t.p.id)
check('시드 파일이 Storage에 있다', (before ?? []).length === 1, before?.length)

const res = await del(t.p.id, { updated_at: t.p.updated_at })
const body = await res.json()
check('200 반환', res.status === 200, body)
check('execution_id를 응답에 담는다 (로그 화면으로 갈 수 있다)', body.execution_id === t.exec, body)
check('삭제한 이미지 수 보고', body.images_removed === 1, body)
check('storage_error 없음', body.storage_error === null, body.storage_error)

const { data: goneProduct } = await db.from('products').select('id').eq('id', t.p.id).maybeSingle()
check('products 행이 삭제됐다', goneProduct === null)
const { count: goneImages } = await db.from('product_images')
  .select('*', { count: 'exact', head: true }).eq('product_id', t.p.id)
check('product_images가 CASCADE로 함께 삭제됐다', goneImages === 0, goneImages)
const { count: goneEdits } = await db.from('edit_history')
  .select('*', { count: 'exact', head: true }).eq('product_id', t.p.id)
check('edit_history가 CASCADE로 함께 삭제됐다', goneEdits === 0, goneEdits)

const { data: keptLogs } = await db.from('execution_logs').select('*').eq('execution_id', t.exec)
check('execution_logs는 남는다 (사후 추적)', (keptLogs ?? []).length >= 1, keptLogs?.length)
check('로그의 product_id가 NULL로 바뀌었다 (§5.4)',
  (keptLogs ?? []).every((l: { product_id: string | null }) => l.product_id === null),
  keptLogs?.map((l: { product_id: string | null }) => l.product_id))

const { data: keptFlags } = await db.from('abnormality_flags').select('*').eq('execution_id', t.exec)
check('abnormality_flags도 남고 product_id만 NULL이다 (§5.5)',
  (keptFlags ?? []).length === 1 && keptFlags![0].product_id === null, keptFlags)

const deletedLog = (keptLogs ?? []).find((l: { step: string }) => l.step === 'product_deleted')
check('product_deleted 로그가 기록됐다', !!deletedLog, keptLogs?.map((l: { step: string }) => l.step))
check('category = lifecycle', deletedLog?.category === 'lifecycle', deletedLog?.category)
check('행사명을 남긴다 (상품 행이 사라진 뒤 유일한 단서)',
  deletedLog?.input?.행사명 === 행사명, deletedLog?.input)

const { data: afterFiles } = await db.storage.from(BUCKET).list(t.p.id)
check('Storage 파일이 삭제됐다', (afterFiles ?? []).length === 0, afterFiles?.length)

/* ── generating 삭제 (§15.1.1 정리 용도) ───────────────────────── */
console.log('\n§12.4 · §15.1.1 — generating도 지울 수 있다')
const gen = await seed('generating')
const genRes = await del(gen.p.id, { updated_at: gen.p.updated_at })
check('200 반환 (버려진 상품 정리가 주 용도)', genRes.status === 200, await genRes.clone().text())

/* ── 없는 상품 ─────────────────────────────────────────────────── */
console.log('\n없는 상품')
const missing = await del('00000000-0000-0000-0000-000000000000')
check('404 반환 (409가 아니다)', missing.status === 404, missing.status)

/* ── 화면 (§12.4 확인 요건) ────────────────────────────────────── */
console.log('\n§12.4 — 상세 화면의 삭제 영역')
const pubDetail = await (await fetch(`${BASE}/admin/products/${pub.p.id}`, { headers: { cookie } })).text()
check('삭제 영역이 있다', pubDetail.includes('상품 삭제'))
check('published는 비활성 + 사유 표시', pubDetail.includes('게시 중인 상품은 삭제할 수 없습니다'))
check('로그는 남는다는 안내', pubDetail.includes('실행 로그와 이상 플래그는 남습니다'))
check('확인 모달용 행사명이 전달된다', pubDetail.includes(행사명))

/* ── 정리 ─────────────────────────────────────────────────────── */
if (!process.env.KEEP) {
  for (const exec of [`${EXEC}-published`, `${EXEC}-draft`, `${EXEC}-draft-app`, `${EXEC}-generating`]) {
    const { data: p } = await db.from('products').select('id').eq('execution_id', exec).maybeSingle()
    if (p) {
      await db.from('applications').delete().eq('product_id', p.id)
      await db.storage.from(BUCKET).remove([`${p.id}/hero.txt`])
    }
    await db.from('execution_logs').delete().eq('execution_id', exec)
    await db.from('abnormality_flags').delete().eq('execution_id', exec)
    await db.from('products').delete().eq('execution_id', exec)
  }
  console.log('\n임시 데이터 정리 완료. (KEEP=1로 보존 가능)')
}

console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
