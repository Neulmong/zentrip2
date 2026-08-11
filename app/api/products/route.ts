import { NextResponse, type NextRequest } from 'next/server'
import { db, STORAGE_BUCKET } from '@/lib/supabase'
import { appendLog } from '@/lib/logging'
import { ZERO_COUNTS } from '@/lib/policy'
import { badRequest, serverError } from '@/lib/http'
import { buildFormInput, tripDays, validateFormInput } from '@/lib/form-validation'
import { defaultAlt, extensionOf, validateImages } from '@/lib/images'

/** spec §4.2 — 서버리스 실행 시간 상한. AI를 쓰지 않는 라우트지만 함께 맞춘다. */
export const maxDuration = 60

/**
 * Step 01 — 상품 등록 (§8.1). **AI 호출 0회.**
 *
 *   ① 서버 재검증(§7.1·§7.2) → 위반 시 400, 행을 만들지 않는다
 *   ② products 행 생성 (form_input, execution_id, attempt_no=1,
 *      retry_counts 4종 0, status=generating, current_step=pipeline_started)
 *   ③ 이미지를 Storage에 올리고 product_images에 슬롯별로 기록
 *   ④ execution_logs에 pipeline_started 기록
 *   ⑤ 200 + {product_id}
 */
export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return badRequest({ _: '폼 데이터를 읽을 수 없습니다.' })
  }

  /* ── ① 서버 재검증 ─────────────────────────────────────────── */
  const raw: Record<string, string> = {}
  for (const [k, v] of form.entries()) if (typeof v === 'string') raw[k] = v

  const formInput = buildFormInput(raw)
  const errors = validateFormInput(formInput)
  if (Object.keys(errors).length > 0) return badRequest(errors)

  const days = tripDays(formInput.행사정보.여행기간_시작, formInput.행사정보.여행기간_종료)!

  // 이미지는 `image:{slot}` 이름으로 온다. 대체 텍스트는 `alt:{slot}:{index}`.
  const uploads: { slot: string; file: File; alt: string }[] = []
  const altCounter = new Map<string, number>()
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('image:') || !(value instanceof File) || value.size === 0) continue
    const slot = key.slice('image:'.length)
    const i = altCounter.get(slot) ?? 0
    altCounter.set(slot, i + 1)
    const alt = (raw[`alt:${slot}:${i}`] ?? '').trim()
    uploads.push({
      slot, file: value,
      alt: alt || defaultAlt(formInput.행사정보.행사명, slot),
    })
  }

  const imageErrors = validateImages(
    uploads.map((u) => ({ slot: u.slot, mime: u.file.type, bytes: u.file.size })),
    days,
  )
  if (imageErrors.length > 0) return badRequest({ images: imageErrors.join(' ') })

  /* ── ② products 행 생성 ────────────────────────────────────── */
  const executionId = `run-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
    + `-${crypto.randomUUID().slice(0, 8)}`

  const { data: product, error: insertError } = await db()
    .from('products')
    .insert({
      execution_id: executionId,
      attempt_no: 1,
      status: 'generating',
      current_step: 'pipeline_started',
      form_input: formInput,
      retry_counts: ZERO_COUNTS,
    })
    .select()
    .single()

  if (insertError || !product) {
    return serverError(`상품 등록 실패: ${insertError?.message ?? '알 수 없음'}`)
  }

  /* ── ③ Storage 업로드 + product_images ─────────────────────────
   * §16.1.1은 ②③을 단일 트랜잭션으로 요구한다. PostgREST로는 다중 문장
   * 트랜잭션을 열 수 없으므로 **보상 삭제**로 동일한 결과를 보장한다 —
   * 어느 단계든 실패하면 올라간 파일과 만든 행을 되돌리고 400을 반환한다.
   * 되돌리기가 실패해도 요청은 실패로 확정하고 고아 파일로 남긴다(§16.2).
   * ─────────────────────────────────────────────────────────── */
  const storagePaths: string[] = []
  try {
    const rows = []
    for (const [i, u] of uploads.entries()) {
      const path = `${product.id}/${crypto.randomUUID()}.${extensionOf(u.file.type)}`
      const { error } = await db().storage
        .from(STORAGE_BUCKET)
        .upload(path, u.file, { contentType: u.file.type, upsert: false })
      if (error) throw new Error(`이미지 업로드 실패: ${error.message}`)
      storagePaths.push(path)
      rows.push({
        product_id: product.id, slot: u.slot, storage_path: path,
        alt: u.alt, sort_order: i, bytes: u.file.size,
      })
    }

    if (rows.length > 0) {
      const { error } = await db().from('product_images').insert(rows)
      if (error) throw new Error(`이미지 기록 실패: ${error.message}`)
    }
  } catch (e) {
    if (storagePaths.length > 0) {
      await db().storage.from(STORAGE_BUCKET).remove(storagePaths).catch(() => {})
    }
    await db().from('products').delete().eq('id', product.id)
    return badRequest({ images: (e as Error).message })
  }

  /* ── ④ 로그 (트랜잭션 밖 — 실패해도 본 동작을 되돌리지 않는다) ── */
  await appendLog({
    execution_id: executionId,
    product_id: product.id,
    category: 'pipeline',
    step: 'pipeline_started',
    attempt_no: 1,
    retry_index: 0,
    verdict: 'pass',
    status: 'generating',
    input: { form_input: formInput, image_count: uploads.length },
    output: { product_id: product.id, trip_days: days },
  })

  /* ── ⑤ ─────────────────────────────────────────────────────── */
  return NextResponse.json(
    { product_id: product.id, execution_id: executionId, current_step: 'pipeline_started' },
    { status: 200 },
  )
}
