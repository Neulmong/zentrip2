import { type NextRequest } from 'next/server'
import { db, STORAGE_BUCKET } from '@/lib/supabase'
import { loadProduct, updateProduct } from '@/lib/orchestrator'
import { checkPrecondition, RESET_ON, RESUBMIT_PLAN, resetCounters } from '@/lib/policy'
import { discardAxes } from '@/lib/validation'
import { appendLog } from '@/lib/logging'
import { badRequest, conflict, notFound, ok, serverError } from '@/lib/http'
import { buildFormInput, tripDays, validateFormInput } from '@/lib/form-validation'
import { defaultAlt, extensionOf, validateImages } from '@/lib/images'
import type { ProductRow } from '@/lib/types'

export const maxDuration = 60

/**
 * §14.4 #17 — `PATCH /api/products/{id}/form-input`. **AI 0회.**
 *
 * ## `form_input`을 바꿀 수 있는 유일한 경로다
 *
 * `form_input`은 **같은 `attempt_no` 안에서 불변**이다(§14.4 #17). 검증의 기준값이
 * `form_input`이므로(§11.1), 시도 도중에 바뀌면 이미 끝난 축의 판정 근거가 사라진다.
 * 그래서 교체는 `attempt_no`를 올릴 때만 허용하고 그 경로를 여기 하나로 좁혔다.
 *
 * ## 허용 상태는 `input_error`뿐
 *
 * 다른 상태에서 부르면 409 `precondition`. 산출물이 이미 나온 상품의 입력을
 * 갈아끼우면 그 산출물이 무엇에서 나왔는지 추적할 수 없게 된다.
 *
 * ## 부수 효과 (§14.4 #17)
 *
 *   교체: `form_input` · 요청에 포함된 이미지 슬롯
 *   비움: `confirmed_data` · `brochure_content` · `page_content` · 4개 축 · `failure_reason`
 *   보존: `execution_id` · `slug` · **요청에 없는 슬롯의 이미지**
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let p: ProductRow | null
  try {
    p = await loadProduct(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')

  const detail = checkPrecondition('form-input', p)
  if (detail) return conflict({ reason: 'precondition', detail })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return badRequest({ _: '폼 데이터를 읽을 수 없습니다.' })
  }

  /* ── ① 재검증 — 위반 시 400, 행은 **그대로 둔다** (§14.4 #17) ── */
  const raw: Record<string, string> = {}
  for (const [k, v] of form.entries()) if (typeof v === 'string') raw[k] = v

  const formInput = buildFormInput(raw)
  const errors = validateFormInput(formInput)
  if (Object.keys(errors).length > 0) return badRequest(errors)

  const days = tripDays(formInput.행사정보.여행기간_시작, formInput.행사정보.여행기간_종료)!

  /* ── ② 교체할 이미지 수집 ─────────────────────────────────────
   * 「**교체된 슬롯만** `product_images`를 갱신한다」(§14.4 #17).
   * 요청에 없는 슬롯은 손대지 않는다 — 사진을 다시 올리게 만들지 않는다.
   * ──────────────────────────────────────────────────────────── */
  const uploads: { slot: string; file: File; alt: string }[] = []
  const altCounter = new Map<string, number>()
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('image:') || !(value instanceof File) || value.size === 0) continue
    const slot = key.slice('image:'.length)
    const i = altCounter.get(slot) ?? 0
    altCounter.set(slot, i + 1)
    const alt = (raw[`alt:${slot}:${i}`] ?? '').trim()
    uploads.push({ slot, file: value, alt: alt || defaultAlt(formInput.행사정보.행사명, slot) })
  }

  const imageErrors = validateImages(
    uploads.map((u) => ({ slot: u.slot, mime: u.file.type, bytes: u.file.size })),
    days,
  )
  if (imageErrors.length > 0) return badRequest({ images: imageErrors.join(' ') })

  const replacedSlots = [...new Set(uploads.map((u) => u.slot))]

  /* ── ③ 새 파일을 먼저 올린다 ───────────────────────────────────
   * 되돌릴 수 없는 삭제(헌 파일)를 **맨 마지막**에 둔다. 여기서 실패하면
   * 올라간 것만 지우면 되고 기존 데이터는 하나도 건드리지 않은 상태다.
   * ──────────────────────────────────────────────────────────── */
  const newPaths: string[] = []
  const newRows: {
    product_id: string; slot: string; storage_path: string
    alt: string; sort_order: number; bytes: number
  }[] = []
  const perSlotIndex = new Map<string, number>()

  try {
    for (const u of uploads) {
      const path = `${p.id}/${crypto.randomUUID()}.${extensionOf(u.file.type)}`
      const { error } = await db().storage
        .from(STORAGE_BUCKET)
        .upload(path, u.file, { contentType: u.file.type, upsert: false })
      if (error) throw new Error(`이미지 업로드 실패: ${error.message}`)
      newPaths.push(path)

      const n = perSlotIndex.get(u.slot) ?? 0
      perSlotIndex.set(u.slot, n + 1)
      newRows.push({
        product_id: p.id, slot: u.slot, storage_path: path,
        alt: u.alt, sort_order: n, bytes: u.file.size,
      })
    }
  } catch (e) {
    if (newPaths.length > 0) {
      await db().storage.from(STORAGE_BUCKET).remove(newPaths).catch(() => {})
    }
    return badRequest({ images: (e as Error).message })
  }

  const cleanupNew = async () => {
    if (newPaths.length > 0) {
      await db().storage.from(STORAGE_BUCKET).remove(newPaths).catch(() => {})
    }
  }

  /* ── ④ products 교체 — §16.1.1 조건부 갱신 ─────────────────── */
  const attempt_no = p.attempt_no + 1
  const patch: Partial<ProductRow> = {
    form_input: formInput,
    attempt_no,
    status: 'generating',
    current_step: RESUBMIT_PLAN.currentStep,
    retry_counts: resetCounters(p.retry_counts, RESET_ON['form-resubmit']),
    // `form_input`이 바뀌었으므로 그것에서 나온 판정은 전부 무효다
    validation_snapshot: discardAxes(p.validation_snapshot, attempt_no, RESUBMIT_PLAN.discard),
    failure_reason: null,
    // 편집분은 page_content와 함께 사라진다 — 배지가 거짓말하지 않게 한다(§10.4)
    human_edited: false,
  }
  for (const col of RESUBMIT_PLAN.clear) patch[col] = null

  let updated
  try {
    updated = await updateProduct(p, patch)
  } catch (e) {
    await cleanupNew()
    return serverError((e as Error).message)
  }
  if (!updated.ok) {
    // 아직 아무것도 지우지 않았다 — 올린 것만 되돌리면 원상복구다
    await cleanupNew()
    return conflict({ reason: 'stale' })
  }

  /* ── ⑤ 교체된 슬롯만 갱신 ─────────────────────────────────────
   * 여기부터의 실패는 되돌리지 않는다. 폼 교체는 이미 확정됐고,
   * 이미지가 옛것으로 남는 것은 재제출로 회복할 수 있다.
   * 대신 **조용히 넘기지 않고** 응답과 로그에 남긴다.
   * ──────────────────────────────────────────────────────────── */
  let imageWarning: string | null = null
  const stalePaths: string[] = []

  if (replacedSlots.length > 0) {
    try {
      const { data: old, error: selErr } = await db()
        .from('product_images')
        .select('id, storage_path')
        .eq('product_id', p.id)
        .in('slot', replacedSlots)
      if (selErr) throw new Error(selErr.message)
      for (const r of old ?? []) stalePaths.push(r.storage_path as string)

      const { error: delErr } = await db()
        .from('product_images').delete().eq('product_id', p.id).in('slot', replacedSlots)
      if (delErr) throw new Error(delErr.message)

      const { error: insErr } = await db().from('product_images').insert(newRows)
      if (insErr) throw new Error(insErr.message)
    } catch (e) {
      imageWarning = `이미지 교체에 실패해 이전 사진이 유지됐습니다: ${(e as Error).message}`
      await cleanupNew()
    }
  }

  /* ── ⑥ 헌 파일 정리 — 실패해도 요청은 성공이다 (§16.2 고아 파일 허용) ── */
  if (!imageWarning && stalePaths.length > 0) {
    await db().storage.from(STORAGE_BUCKET).remove(stalePaths).catch(() => {})
  }

  /**
   * 여행기간을 줄여 사라진 일차의 사진은 **지우지 않는다.**
   * 요청에 없는 슬롯은 손대지 않는다는 원칙이 우선이고, 기간을 되돌리면
   * 그 사진이 다시 쓰인다. 참조되지 않을 뿐 손해가 없다.
   */
  const { data: remaining } = await db()
    .from('product_images').select('slot').eq('product_id', p.id)

  const orphanDaySlots = [...new Set((remaining ?? [])
    .map((r) => String(r.slot))
    .filter((s) => {
      const n = s.match(/^itinerary_day_(\d+)$/)?.[1]
      return n !== undefined && Number(n) > days
    }))]

  await appendLog({
    execution_id: p.execution_id,
    product_id: p.id,
    category: 'pipeline',
    step: 'form_input_resubmitted',
    attempt_no,
    retry_index: 0,
    verdict: '-',
    status: 'generating',
    input: { form_input: formInput, replaced_slots: replacedSlots, image_count: uploads.length },
    output: {
      current_step: RESUBMIT_PLAN.currentStep,
      restart_from: RESUBMIT_PLAN.from,
      trip_days: days,
      ...(imageWarning ? { image_warning: imageWarning } : {}),
      // 참조되지 않게 된 일차 슬롯 — 지우지 않고 기록만 남긴다
      ...(orphanDaySlots.length > 0 ? { orphan_day_slots: orphanDaySlots } : {}),
    },
  })

  return ok({
    current_step: RESUBMIT_PLAN.currentStep,
    restart_from: RESUBMIT_PLAN.from,
    ...(imageWarning ? { image_warning: imageWarning } : {}),
  })
}
