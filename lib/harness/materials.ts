import 'server-only'
import { db } from '@/lib/supabase'
import type { ProductRow } from '@/lib/types'
import type { Materials } from './context'

/**
 * 스킬 실행 **전에** DB 재료를 적재한다.
 *
 * 스킬이 직접 DB를 읽지 않게 하려고 분리했다 — 그러면 스킬이 순수 함수로
 * 남아 `npm run test:policy`에서 단독으로 검증된다. 무엇을 적재할지는
 * 매니페스트의 `materials`가 선언한다(배선의 유일한 출처).
 */

const EMPTY: Materials = { imageSlots: [], usedSlugs: new Set() }

export async function loadMaterials(
  declared: readonly string[] | undefined, p: ProductRow,
): Promise<Materials> {
  if (!declared?.length) return EMPTY

  const out: Materials = { imageSlots: [], usedSlugs: new Set() }

  if (declared.includes('image_slots')) {
    const { data } = await db()
      .from('product_images').select('slot,alt').eq('product_id', p.id)
    out.imageSlots = (data ?? []) as { slot: string; alt: string | null }[]
  }

  /*
   * slug가 이미 있으면 조회하지 않는다 — §12.1이 재발급을 금지하므로
   * 충돌 검사를 할 이유가 없고, 쓸데없는 전체 스캔만 남는다.
   */
  if (declared.includes('used_slugs') && !p.slug) {
    const { data } = await db().from('products').select('slug').not('slug', 'is', null)
    out.usedSlugs = new Set<string>((data ?? []).map((r: { slug: string }) => r.slug))
  }

  return out
}
