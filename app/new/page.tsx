import { db } from '@/lib/supabase'
import { loadProduct } from '@/lib/orchestrator'
import { checkPrecondition } from '@/lib/policy'
import { ProductForm, type ExistingImage } from './form'

/**
 * §14.1 — `/new`(신규)와 `/new?product_id={id}`(입력 재제출) 두 경로.
 *
 * 폼 자체는 브라우저에서 돌아야 하지만(파일 선택·진행 표시), **이전 입력을 채우려면
 * DB를 읽어야 한다.** 그래서 바깥을 서버 컴포넌트로 감싸 값을 읽어 내려보낸다 —
 * 환경 변수가 서버 전용이라(§4) 브라우저에서 직접 조회할 수 없다.
 *
 * ## 값을 채우는 상태 = #17이 허용하는 상태
 *
 * `form_input` 교체가 허용되는 상태에서만 값을 채운다(§14.4 #17 — `input_error` ·
 * `brochure_ready`). 허용되지 않는 상태의 값을 채워 보여주면 「고쳐서 내면
 * 되겠구나」로 읽히는데 실제 제출은 409로 거부되므로, 그때는 신규 등록 폼으로 둔다.
 *
 * ⚠️ **두 목록이 어긋나면 조용히 망가진다.** 이전에는 여기가 `input_error`만
 * 허용했고, 그래서 §15.1이 규정한 `brochure_ready`의 [입력 수정]이 **빈 폼**으로
 * 떨어졌다. 게다가 `productId`가 없으니 제출이 #17이 아니라 신규 등록(#1)으로
 * 가서 **원래 상품은 그대로 두고 다른 상품이 하나 더 만들어졌다.**
 * 그래서 판정을 여기서 다시 쓰지 않고 `checkPrecondition`(단일 출처)에 묻는다.
 */
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ product_id?: string }>
}) {
  const { product_id: id } = await searchParams
  if (!id) return <ProductForm />

  const p = await loadProduct(id).catch(() => null)
  if (!p || checkPrecondition('form-input', p) !== null) return <ProductForm />

  // 이미 올라간 사진 — 교체하지 않은 슬롯은 그대로 유지된다(§14.4 #17)
  const { data } = await db()
    .from('product_images').select('slot').eq('product_id', p.id)

  const counts = new Map<string, number>()
  for (const r of (data ?? []) as { slot: string }[]) {
    counts.set(r.slot, (counts.get(r.slot) ?? 0) + 1)
  }
  const existing: ExistingImage[] = [...counts.entries()]
    .map(([slot, count]) => ({ slot, count }))
    .sort((a, b) => a.slot.localeCompare(b.slot))

  return (
    <ProductForm
      productId={p.id}
      initial={p.form_input}
      updatedAt={p.updated_at}
      failureReason={p.failure_reason}
      existing={existing}
    />
  )
}
