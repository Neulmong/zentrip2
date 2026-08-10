/**
 * 이미지 슬롯 규칙 (§7.3) — 순수 모듈.
 *
 * 슬롯 지정 주체는 **사용자**다. AI는 슬롯을 재배치하지 않는다(§2.3·§16.1).
 */

export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_BYTES = 5 * 1024 * 1024 // 장당 5MB

/** 슬롯별 상한 (§7.3). `itinerary_day_{n}`은 일차별 0~1. */
export const SLOT_MAX: Record<string, number> = {
  hero: 1, accommodation: 3, shop: 2,
}
export const ITINERARY_DAY_MAX = 1

/** 대체 텍스트 자동 채움용 한글명 (§7.3). */
const SLOT_LABEL: Record<string, string> = {
  hero: '대표 이미지', accommodation: '숙소 사진', shop: '제휴상점 사진',
}

export function slotLabel(slot: string): string {
  const m = slot.match(/^itinerary_day_(\d+)$/)
  return m ? `${m[1]}일차 사진` : (SLOT_LABEL[slot] ?? '사진')
}

/** 미입력 시 `{행사명} {슬롯 한글명}`으로 자동 채운다(§7.3). */
export function defaultAlt(eventName: string, slot: string): string {
  return `${eventName} ${slotLabel(slot)}`.trim()
}

export function extensionOf(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}

export interface SlotCheckInput {
  slot: string
  mime: string
  bytes: number
}

/**
 * 슬롯 이름·개수·용량·포맷을 검사한다.
 * 절대 상한 21장은 슬롯별 상한을 모두 지키면 자연히 만족된다 —
 * 실제 상한은 여행 일수에 따라 줄어든다(§7.3).
 */
export function validateImages(files: SlotCheckInput[], tripDays: number): string[] {
  const errors: string[] = []
  const counts = new Map<string, number>()

  for (const f of files) {
    if (!ALLOWED_MIME.has(f.mime)) {
      errors.push(`지원하지 않는 형식입니다 (${f.mime}). JPG·PNG·WebP만 올릴 수 있습니다.`)
      continue
    }
    if (f.bytes > MAX_BYTES) {
      errors.push(`파일이 5MB를 넘습니다 (${(f.bytes / 1024 / 1024).toFixed(1)}MB).`)
      continue
    }

    const day = f.slot.match(/^itinerary_day_(\d+)$/)
    if (day) {
      const n = Number(day[1])
      // 여행기간을 줄여 일차가 사라진 슬롯은 받지 않는다(§7.3).
      if (n < 1 || n > tripDays) {
        errors.push(`${n}일차 슬롯은 이 여행기간(${tripDays}일)에 없습니다.`)
        continue
      }
    } else if (!(f.slot in SLOT_MAX)) {
      errors.push(`알 수 없는 이미지 슬롯입니다: ${f.slot}`)
      continue
    }

    const next = (counts.get(f.slot) ?? 0) + 1
    counts.set(f.slot, next)
    const max = day ? ITINERARY_DAY_MAX : SLOT_MAX[f.slot]
    if (next > max) {
      errors.push(`${slotLabel(f.slot)}는 최대 ${max}장까지 올릴 수 있습니다.`)
    }
  }

  return [...new Set(errors)]
}
