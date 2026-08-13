import Image from 'next/image'
import type { PageImage } from './types'

/**
 * 이미지 계약 (§17.1·§17.2) — **순수 모듈**.
 *
 * | 규정 | 구현 |
 * |---|---|
 * | 고정 종횡비 컨테이너 + `object-fit: cover` | `aspect-*` 래퍼 + `fill` + `object-cover` |
 * | `max-width: 100%` | `fill`은 부모를 넘지 않는다. 부모는 항상 블록 요소다 |
 * | 대체 텍스트 필수 | `alt`는 업로드 시 자동 채움까지 마쳐 항상 비어 있지 않다(§7.3) |
 * | `hero`는 `priority`, 나머지는 lazy | `priority` prop. `next/image` 기본이 lazy다 |
 *
 * ## 왜 `fill`인가
 *
 * `product_images`의 `width`·`height`는 nullable이고 업로드 라우트가 채우지
 * 않는다(§7.3에 측정 규정이 없다). `next/image`는 원격 이미지에 치수를 요구하므로
 * 남은 선택지는 `fill`뿐이다. 종횡비를 컨테이너가 고정하므로 레이아웃 시프트도
 * 함께 막힌다 — 치수를 알 때와 결과가 같다.
 */

/** 종횡비 3종. 값을 늘리기 전에 §17.1의 375/768/1280 검증을 다시 한다. */
export const RATIO = {
  /** 대표 이미지 — 모바일은 세로 여유를 두고, 넓은 화면에서 배너가 된다 */
  hero: 'aspect-[4/3] md:aspect-[21/9]',
  /** 일차·상점 등 본문 이미지 */
  wide: 'aspect-[16/9]',
  /** 숙소 갤러리처럼 여러 장이 격자로 놓이는 경우 */
  tile: 'aspect-[4/3]',
} as const

export function Figure({
  image, ratio = 'wide', priority = false, sizes = '100vw', caption, className = '',
}: {
  image: PageImage
  ratio?: keyof typeof RATIO
  priority?: boolean
  sizes?: string
  caption?: string
  className?: string
}) {
  return (
    <figure className={className}>
      <div className={`relative w-full overflow-hidden rounded-2xl bg-black/5 ${RATIO[ratio]}`}>
        <Image
          src={image.url}
          alt={image.alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      </div>
      {/* 캡션도 본문이므로 색을 흐리지 않는다 — 대비 4.5:1 유지(§17.2). 크기로만 구분한다 */}
      {caption && <figcaption className="mt-2 text-sm">{caption}</figcaption>}
    </figure>
  )
}

/**
 * 슬롯 하나에 담긴 이미지 전부를 격자로 놓는다.
 *
 * **슬롯이 비어 있으면 아무것도 그리지 않는다** — 섹션은 그대로 두고 이미지
 * 영역만 생략한다(§9.3). 자리표시자를 넣으면 사진을 올리지 않은 상품이
 * 깨진 것처럼 보인다.
 */
export function SlotGallery({
  images, ratio = 'tile', className = '',
}: {
  images: PageImage[]
  ratio?: keyof typeof RATIO
  className?: string
}) {
  if (images.length === 0) return null

  // 1장이면 넓게, 2장 이상이면 격자. 3장까지가 상한이다(§7.3 accommodation 3 / shop 2).
  if (images.length === 1) {
    return (
      <Figure
        image={images[0]}
        ratio="wide"
        sizes="(min-width: 768px) 720px, 100vw"
        className={className}
      />
    )
  }

  return (
    <div className={`grid grid-cols-2 gap-3 ${className}`}>
      {images.map((im) => (
        <Figure key={im.id} image={im} ratio={ratio} sizes="(min-width: 768px) 360px, 50vw" />
      ))}
    </div>
  )
}
