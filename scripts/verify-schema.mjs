import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) { console.error('환경변수 누락'); process.exit(1) }
console.log(`키 종류: ${key.startsWith('sb_secret_') ? '✅ sb_secret_ (서버 전용)'
  : key.startsWith('eyJ') ? '✅ JWT (legacy service_role 추정)'
  : `❌ ${key.slice(0, 15)}… — 잘못된 키`}`)

const db = createClient(url, key, { auth: { persistSession: false } })

console.log('\n=== spec §5 테이블 6종 ===')
const tables = ['products', 'product_images', 'applications',
                'execution_logs', 'abnormality_flags', 'edit_history']
let missing = 0
for (const t of tables) {
  // head:true는 테이블이 없어도 error를 안 내는 경우가 있어 실제 select로 확인한다
  const { data, error } = await db.from(t).select('*').limit(1)
  if (error) { console.log(`  ❌ ${t.padEnd(20)} ${error.message}`); missing++ }
  else console.log(`  ✅ ${t.padEnd(20)} 존재 (표본 ${data.length}행)`)
}

console.log('\n=== Storage 버킷 (§7.3) ===')
const { data: buckets, error: bErr } = await db.storage.listBuckets()
if (bErr) console.log(`  ❌ ${bErr.message}`)
else {
  const b = buckets.find(x => x.id === 'product-images')
  console.log(b ? `  ✅ product-images (public: ${b.public})` : '  ❌ product-images 버킷 없음')
}

if (missing) { console.log('\n→ 0001_init.sql 미실행. SQL Editor에서 실행하세요.'); process.exit(1) }

console.log('\n=== 제약·기본값 동작 검증 (임시 행 생성 후 삭제) ===')
const exec = `verify-${Date.now()}`
const { data: row, error: insErr } = await db.from('products')
  .insert({ execution_id: exec, form_input: { 행사정보: { 행사명: '검증용' } } })
  .select().single()

if (insErr) { console.log(`  ❌ INSERT 실패: ${insErr.message}`); process.exit(1) }

const rc = row.retry_counts
const checks = [
  ['retry_counts 4종 (§11.6)',
    ['normalization','brochure','page','consistency'].every(k => rc?.[k] === 0),
    JSON.stringify(rc)],
  ['status 기본값 generating', row.status === 'generating', row.status],
  ['attempt_no 기본값 1', row.attempt_no === 1, row.attempt_no],
  ['current_step 기본값', row.current_step === 'pipeline_started', row.current_step],
  ['human_edited 기본값 false', row.human_edited === false, row.human_edited],
  ['updated_at 밀리초 절단', /\.\d{3}(\+|Z)/.test(row.updated_at) || !/\.\d{4,}/.test(row.updated_at), row.updated_at],
]
for (const [name, ok, got] of checks) console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(28)} ${got}`)

// CHECK 제약이 실제로 막는지
const { error: badStatus } = await db.from('products')
  .update({ status: 'nonsense' }).eq('id', row.id)
console.log(`  ${badStatus ? '✅' : '❌'} status CHECK 위반 차단      ${badStatus ? '거부됨' : '⚠ 통과됨(제약 없음)'}`)

const { error: dupFlag } = await db.from('abnormality_flags').insert([
  { execution_id: exec, attempt_no: 1, type: 'itinerary_partial', step: 's', detail: 'd' },
  { execution_id: exec, attempt_no: 1, type: 'itinerary_partial', step: 's', detail: 'd' },
])
console.log(`  ${dupFlag ? '✅' : '❌'} 플래그 중복 차단 (§5.5)     ${dupFlag ? '거부됨' : '⚠ 중복 허용됨'}`)

await db.from('abnormality_flags').delete().eq('execution_id', exec)
await db.from('products').delete().eq('id', row.id)
console.log('\n임시 데이터 정리 완료.')
