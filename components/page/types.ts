/**
 * 렌더링 계층의 공용 타입 (§9.1) — **순수 모듈**.
 *
 * 이 디렉터리(`components/page/`)의 어떤 파일도 `server-only` 모듈을 import하지
 * 않는다. 공개 페이지(서버 컴포넌트)와 편집기 미리보기(클라이언트 컴포넌트)가
 * **같은 컴포넌트를 공유**해야 하기 때문이다 — 미리보기가 입력에 따라 즉시
 * 갱신되려면 클라이언트 번들에 들어가야 하고, 그때 `lib/env`·`lib/supabase`가
 * 딸려 오면 빌드가 깨진다.
 *
 * 그래서 이미지 URL은 **서버에서 미리 해석해** props로 내려받는다(`lib/page-images.ts`).
 */

/** `product_images` 1행 + 해석이 끝난 공개 URL. */
export interface PageImage {
  id: string
  slot: string
  url: string
  /** 대체 텍스트는 업로드 시 필수로 채워진다(§7.3·§17.2). */
  alt: string
  sort_order: number
}

export interface ImageIndex {
  /** 슬롯 이름 → 이미지 목록. `sort_order` 오름차순이 실제 표시 순서다(§9.3). */
  bySlot: Map<string, PageImage[]>
  /** `product_images.id` → 이미지. `image` 삽입 블록이 슬롯이 아니라 id로 참조한다(§10.2). */
  byId: Map<string, PageImage>
}

export function indexImages(images: PageImage[]): ImageIndex {
  const bySlot = new Map<string, PageImage[]>()
  const byId = new Map<string, PageImage>()

  for (const im of [...images].sort((a, b) => a.sort_order - b.sort_order)) {
    byId.set(im.id, im)
    const arr = bySlot.get(im.slot)
    if (arr) arr.push(im)
    else bySlot.set(im.slot, [im])
  }

  return { bySlot, byId }
}

/**
 * 미입력·미운영 표기 2종 (§6.1이 단일 출처).
 * 렌더링은 이 값을 **지우지 않는다** — 흐리게 표시할 뿐이다.
 * 섹션을 삭제하지 않는 것과 같은 이유로, 값이 비어 보이면 기획자가 입력 누락을
 * 알아차릴 수 없다.
 */
export const PLACEHOLDER_VALUES = new Set(['추후 추가 예정', '해당 없음'])

/** `data`는 `Record<string, unknown>`이므로 읽을 때 좁힌다. */
export function text(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
}

export interface DayEntry {
  day: string
  text: string
  image_slot: string
}

export function days(data: Record<string, unknown>): DayEntry[] {
  const v = data.days
  if (!Array.isArray(v)) return []
  return v.map((d) => ({
    day: String((d as DayEntry)?.day ?? ''),
    text: String((d as DayEntry)?.text ?? ''),
    image_slot: String((d as DayEntry)?.image_slot ?? ''),
  }))
}

/** `image_slots`(복수)는 슬롯 **이름**의 배열이다. 장수·순서는 `sort_order`가 정한다(§9.3). */
export function slotNames(data: Record<string, unknown>): string[] {
  const v = data.image_slots
  return Array.isArray(v) ? v.map(String).filter(Boolean) : []
}
