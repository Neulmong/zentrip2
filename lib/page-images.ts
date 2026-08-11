import 'server-only'
import { db, STORAGE_BUCKET } from './supabase'
import type { PageImage } from '@/components/page/types'

/**
 * `product_images` → 렌더러가 쓰는 `PageImage[]` (§7.3·§9.3).
 *
 * URL 해석을 **서버에서 끝내는** 이유: `components/page/`는 편집기 미리보기가
 * 클라이언트 번들로 끌어가므로 `SUPABASE_URL`(서버 전용 환경 변수, §4)에
 * 접근할 수 없다. 여기서 절대 URL로 바꿔 props로 내려보낸다 —
 * `NEXT_PUBLIC_` 변수를 만들지 않고도 이미지가 표시된다.
 *
 * 버킷은 읽기 공개이고 경로에 UUID가 들어간다(§16.2의 알려진 한계).
 */
export async function loadPageImages(productId: string): Promise<PageImage[]> {
  const { data, error } = await db()
    .from('product_images')
    .select('id, slot, storage_path, alt, sort_order')
    .eq('product_id', productId)
    // 같은 슬롯 안의 표시 순서는 sort_order가 정한다(§9.3)
    .order('slot', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) throw new Error(`이미지 조회 실패: ${error.message}`)

  const storage = db().storage.from(STORAGE_BUCKET)

  return (data ?? []).map((row) => ({
    id: row.id as string,
    slot: row.slot as string,
    // getPublicUrl은 네트워크 호출 없이 문자열만 조립한다.
    url: storage.getPublicUrl(row.storage_path as string).data.publicUrl,
    alt: row.alt as string,
    sort_order: row.sort_order as number,
  }))
}
