import { db } from '@/lib/supabase'
import { loadProduct } from '@/lib/orchestrator'
import { ProductForm, type ExistingImage } from './form'

/**
 * §14.1 — `/new`(신규)와 `/new?product_id={id}`(입력 재제출) 두 경로.
 *
 * 폼 자체는 브라우저에서 돌아야 하지만(파일 선택·진행 표시), **이전 입력을 채우려면
 * DB를 읽어야 한다.** 그래서 바깥을 서버 컴포넌트로 감싸 값을 읽어 내려보낸다 —
 * 환경 변수가 서버 전용이라(§4) 브라우저에서 직접 조회할 수 없다.
 *
 * ## 왜 `input_error`가 아니면 빈 폼인가
 *
 * `form_input` 교체는 `input_error`에서만 허용된다(§14.4 #17). 다른 상태의 값을
 * 채워 보여주면 「고쳐서 내면 되겠구나」로 읽히는데, 실제 제출은 409로 거부된다.
 * 그럴 바에는 처음부터 신규 등록 폼으로 두는 편이 정직하다.
 */
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ product_id?: string }>
}) {
  const { product_id: id } = await searchParams
  if (!id) return <ProductForm />

  const p = await loadProduct(id).catch(() => null)
  if (!p || p.status !== 'input_error') return <ProductForm />

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
      failureReason={p.failure_reason}
      existing={existing}
    />
  )
}
