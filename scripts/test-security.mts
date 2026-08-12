/**
 * §16.2·§16.3 보안 실측 — 체크리스트 U 섹션(U-01 ~ U-08).
 *
 * 정책이 SQL에 적혀 있다는 것과 실제로 막힌다는 것은 다르다. 이 스크립트는
 * **익명 키로 직접 두드려** 확인한다.
 *
 * 익명 키(anon / publishable)는 브라우저에 노출되도록 설계된 공개 키다. RLS가
 * 유일한 방어선이므로 「키가 새는가」가 아니라 「키가 있어도 막히는가」를 본다.
 * 이 앱은 클라이언트에서 Supabase를 직접 호출하지 않으므로(§4) 앱 동작에는
 * 쓰이지 않으며, 이 스크립트 전용이다.
 *
 *   npm run test:security                       ← U-06·U-07·U-08만
 *   SUPABASE_ANON_KEY=... npm run test:security ← U-01 ~ U-05 포함
 *
 * 키는 Supabase 대시보드 > Project Settings > API Keys의 **anon / publishable**
 * 값이다(`service_role`이 아니다). `.env.local`에 `SUPABASE_ANON_KEY=`로 넣어
 * 두면 이후에는 인자 없이 돌아간다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.TEST_ANON_KEY ?? ''

const db = createClient(URL, SERVICE, { auth: { persistSession: false } })

let pass = 0, fail = 0, skip = 0
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${n}`) }
  else { fail++; console.log(`  ❌ ${n}${got !== undefined ? `\n       → ${JSON.stringify(got)}` : ''}`) }
}
const skipped = (n: string, why: string) => {
  skip++; console.log(`  ⏭  ${n}\n       → ${why}`)
}

const EXEC = `test-security-${process.pid}`

/* ════════════════════════════════════════════════════════════════
 * U-06 — service role 키가 클라이언트 번들에 없다
 * ════════════════════════════════════════════════════════════════ */
console.log('\nU-06 — service role 키가 클라이언트로 새지 않는다 (§16.3)')

function walk(dir: string): string[] {
  let out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else out.push(p)
  }
  return out
}

let bundles: string[] = []
try {
  bundles = walk('.next/static')
} catch {
  bundles = []
}

if (bundles.length === 0) {
  skipped('클라이언트 번들 검사', '`npm run build`를 먼저 실행해야 .next/static이 생긴다')
} else {
  // 값 자체로 찾는다. 변수명만 찾으면 번들러가 인라인한 경우를 놓친다.
  const leaks = bundles.filter((f) => {
    const s = readFileSync(f, 'utf8')
    return s.includes(SERVICE) || s.includes('sb_secret_') || s.includes('service_role')
  })
  check(`service role 키가 번들 ${bundles.length}개 어디에도 없다`,
    leaks.length === 0, leaks)

  const urlLeaks = bundles.filter((f) => readFileSync(f, 'utf8').includes(URL))
  check('Supabase URL도 번들에 없다 (클라이언트가 DB를 직접 부르지 않는다)',
    urlLeaks.length === 0, urlLeaks)
}

// CLAUDE.md·§4 — NEXT_PUBLIC_ 접두사 변수를 만들지 않는다
const envKeys = readFileSync('.env.local.example', 'utf8')
  .split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0])
check('NEXT_PUBLIC_ 접두사 환경 변수가 없다 (§4)',
  !envKeys.some((k) => k.startsWith('NEXT_PUBLIC_')), envKeys.filter((k) => k.startsWith('NEXT_PUBLIC_')))

/* ════════════════════════════════════════════════════════════════
 * U-07 — 동의 없는 신청 레코드 0건
 * ════════════════════════════════════════════════════════════════ */
console.log('\nU-07 — 동의 없이 접수된 신청이 없다 (§16.2)')
const { count: noConsent, error: consentError } = await db
  .from('applications').select('*', { count: 'exact', head: true }).is('consent_at', null)
check('consent_at IS NULL 0건', !consentError && noConsent === 0,
  consentError?.message ?? noConsent)

/* ════════════════════════════════════════════════════════════════
 * U-08 — Storage 읽기 공개의 한계가 문서화돼 있고, 콘텐츠는 새지 않는다
 * ════════════════════════════════════════════════════════════════ */
console.log('\nU-08 — Storage 읽기 공개의 한계 (§7.3·§16.2)')
const { data: buckets } = await db.storage.listBuckets()
const bucket = buckets?.find((b) => b.name === 'product-images')
check('product-images 버킷이 읽기 공개다', bucket?.public === true, bucket?.public)

const spec = readFileSync('spec.md', 'utf8')
check('§16.2에 이미지 파일 접근 가능성이 한계로 명시돼 있다',
  /임시저장|비공개/.test(spec) && /Storage/.test(spec)
  && /(한계|알려진)/.test(spec), true)
check('마이그레이션에도 같은 한계가 주석으로 남아 있다',
  // `s` 플래그는 target ES2017에서 쓸 수 없다 — [\s\S]로 같은 뜻을 쓴다
  /알려진 한계[\s\S]*§16\.2/.test(readFileSync('supabase/migrations/0001_init.sql', 'utf8')))

/* ════════════════════════════════════════════════════════════════
 * U-01 ~ U-05 — 익명 키 실측
 * ════════════════════════════════════════════════════════════════ */
console.log('\nU-01 ~ U-05 — 익명 키로 직접 두드린다 (§16.3)')

if (!ANON) {
  skipped('익명 키 실측 5종 (U-01·U-02·U-03·U-04·U-05)',
    'SUPABASE_ANON_KEY가 없다. 대시보드 > Project Settings > API Keys의 '
    + 'anon/publishable 값을 .env.local에 넣으면 실행된다')
} else {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } })

  /* 시드 — published 1건 + draft 1건. 정책이 상태로 가르는지 보려면 둘이 필요하다 */
  await db.from('products').delete().eq('execution_id', `${EXEC}-pub`)
  await db.from('products').delete().eq('execution_id', `${EXEC}-draft`)

  const formInput = {
    행사정보: {
      행사명: '보안 실측 상품', 여행지: '제주',
      여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
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

  const { data: pub } = await db.from('products').insert({
    execution_id: `${EXEC}-pub`, slug: `sec-pub-${process.pid}`, status: 'published',
    current_step: 'draft_registered', form_input: formInput,
    published_at: new Date().toISOString(),
  }).select().single()

  const { data: draft } = await db.from('products').insert({
    execution_id: `${EXEC}-draft`, slug: `sec-draft-${process.pid}`, status: 'draft',
    current_step: 'draft_registered', form_input: formInput,
  }).select().single()

  // `alt`는 NOT NULL이다(§5.2) — 빠지면 시드가 제약에서 죽는다
  await db.from('product_images').insert([
    { product_id: pub!.id, slot: 'hero', storage_path: `${pub!.id}/hero.jpg`, alt: '대표', sort_order: 0 },
    { product_id: draft!.id, slot: 'hero', storage_path: `${draft!.id}/hero.jpg`, alt: '대표', sort_order: 0 },
  ])

  const { data: app } = await db.from('applications').insert({
    product_id: pub!.id, name: '홍길동', email: 'sec@example.com', phone: '010-1111-2222',
    headcount: 1, consent_at: new Date().toISOString(),
    product_snapshot: { 행사명: '보안 실측 상품' },
  }).select().single()

  await db.from('execution_logs').insert({
    execution_id: `${EXEC}-pub`, product_id: pub!.id, category: 'pipeline',
    step: 'pipeline_started', attempt_no: 1, retry_index: 0, verdict: '-',
    status: 'generating', input: {}, output: {},
  })
  await db.from('abnormality_flags').insert({
    execution_id: `${EXEC}-pub`, product_id: pub!.id, attempt_no: 1,
    type: 'processing_delayed', step: 'page_generated', detail: '실측용',
  })

  /* ── U-01 · U-02 applications ──────────────────────────────── */
  console.log('  U-01 · U-02 — applications')
  const { data: anonApps, error: anonAppError } = await anon.from('applications').select('*')
  /*
   * RLS로 막힌 SELECT는 오류가 아니라 **빈 배열**이다. 「오류가 났다」로
   * 판정하면 정책이 열려 있어도 통과할 수 있으니 행 수로 본다.
   */
  check('익명 SELECT가 0건 (신청자 명단 노출 없음)',
    (anonApps ?? []).length === 0, { rows: anonApps?.length, error: anonAppError?.message })
  const { count: realCount } = await db.from('applications')
    .select('*', { count: 'exact', head: true }).eq('product_id', pub!.id)
  check('같은 조건에서 service role은 볼 수 있다 (빈 표가 아니다)',
    (realCount ?? 0) > 0, realCount)

  const { data: anonInsert, error: insertError } = await anon.from('applications').insert({
    product_id: pub!.id, name: '익명신청', email: 'anon@example.com', phone: '010-3333-4444',
    headcount: 1, consent_at: new Date().toISOString(),
    product_snapshot: { 행사명: '보안 실측 상품' },
  }).select()
  /*
   * INSERT는 허용이지만 `select()`로 되읽는 것은 SELECT 정책이 없어 막힌다 —
   * 행은 들어가고 반환은 비는 것이 정상이다. 실제 적재는 service role로 센다.
   */
  const { count: afterInsert } = await db.from('applications')
    .select('*', { count: 'exact', head: true }).eq('email', 'anon@example.com')
  check('익명 INSERT는 허용된다 (공개 신청 폼의 경로)',
    afterInsert === 1, { returned: anonInsert?.length, error: insertError?.message, stored: afterInsert })

  const { error: updError, count: updCount } = await anon.from('applications')
    .update({ name: '변경됨' }, { count: 'exact' }).eq('id', app!.id)
  check('익명 UPDATE가 차단된다', (updCount ?? 0) === 0,
    { count: updCount, error: updError?.message })
  const { data: notChanged } = await db.from('applications')
    .select('name').eq('id', app!.id).single()
  check('값이 실제로 바뀌지 않았다', notChanged?.name === '홍길동', notChanged?.name)

  const { count: delCount } = await anon.from('applications')
    .delete({ count: 'exact' }).eq('id', app!.id)
  check('익명 DELETE가 차단된다', (delCount ?? 0) === 0, delCount)
  const { data: stillThere } = await db.from('applications')
    .select('id').eq('id', app!.id).maybeSingle()
  check('행이 실제로 남아 있다', !!stillThere)

  /* ── U-03 products ─────────────────────────────────────────── */
  console.log('  U-03 — products')
  const { data: anonProducts } = await anon.from('products').select('id,status,form_input')
  const ids = (anonProducts ?? []).map((p: { id: string }) => p.id)
  check('published 상품은 보인다', ids.includes(pub!.id), ids.length)
  check('draft 상품은 보이지 않는다', !ids.includes(draft!.id), ids.length)
  check('보이는 행이 전부 published다',
    (anonProducts ?? []).every((p: { status: string }) => p.status === 'published'),
    [...new Set((anonProducts ?? []).map((p: { status: string }) => p.status))])

  /* ── U-04 로그·플래그·편집 이력 ─────────────────────────────── */
  console.log('  U-04 — execution_logs · abnormality_flags · edit_history')
  for (const table of ['execution_logs', 'abnormality_flags', 'edit_history']) {
    const { data } = await anon.from(table).select('*')
    check(`${table} 익명 SELECT 0건 (정책 없음 = 전면 거부)`, (data ?? []).length === 0,
      data?.length)
  }

  /* ── U-05 product_images ───────────────────────────────────── */
  console.log('  U-05 — product_images')
  const { data: anonImages } = await anon.from('product_images').select('id,product_id')
  const imgProducts = (anonImages ?? []).map((i: { product_id: string }) => i.product_id)
  check('게시된 상품의 이미지 행은 보인다', imgProducts.includes(pub!.id), imgProducts.length)
  check('임시저장 상품의 이미지 행은 보이지 않는다', !imgProducts.includes(draft!.id))

  const { error: imgInsertError } = await anon.from('product_images').insert({
    product_id: pub!.id, slot: 'hero', storage_path: 'anon/x.jpg', alt: 'x', sort_order: 9,
  })
  check('익명 INSERT가 차단된다 (업로드는 service role만)', !!imgInsertError,
    imgInsertError?.message)

  const { error: uploadError } = await anon.storage.from('product-images')
    .upload(`anon-${process.pid}.txt`, new Blob(['x']))
  check('Storage 업로드가 차단된다 (§16.3)', !!uploadError, uploadError?.message)

  /* 정리 */
  await db.from('applications').delete().eq('product_id', pub!.id)
  await db.from('execution_logs').delete().eq('execution_id', `${EXEC}-pub`)
  await db.from('abnormality_flags').delete().eq('execution_id', `${EXEC}-pub`)
  await db.from('products').delete().eq('execution_id', `${EXEC}-pub`)
  await db.from('products').delete().eq('execution_id', `${EXEC}-draft`)
  console.log('\n임시 데이터 정리 완료.')
}

console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}${skip ? ` · 건너뜀 ${skip}` : ''}`)
if (fail > 0) process.exit(1)
