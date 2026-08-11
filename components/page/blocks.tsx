import { SectionHeading } from './theme'
import { Figure } from './media'
import { text } from './types'
import { Band, type SectionProps } from './sections'

/**
 * 삽입 블록 3종 (§10.2) — 편집기에서 사람이 끼워 넣는 블록.
 *
 * 섹션 9종과 같은 `{id, type, order, visible, locked, data, source}` 7개 필드를
 * 가지며, 다른 점은 `id` 접두사가 `blk_`이고 `source`가 `"generated"`(또는 없음)라는 것뿐이다.
 * 따라서 렌더러 입장에서는 `type`만 다른 같은 원소다 — 별도 배열로 두지 않는다.
 *
 * | 규정 | 위치 |
 * |---|---|
 * | 검증 대상이 아니다. 정확성은 기획자 책임 | §10.2·§10.4 |
 * | `hero`와 `apply` **사이에만** 삽입 | §10.2 (배치는 저장 시 강제, 렌더러는 `order`만 따른다) |
 * | 길이 상한 `free_text` 500자 · `notice` 300자 | §17.1 (**편집 저장 시** 강제. 렌더링은 자르지 않는다) |
 *
 * 렌더러가 길이를 자르지 않는 이유: 값을 잘라내는 것은 §16.1의 값 변형 금지에
 * 걸린다. 상한은 저장 경로에서 400으로 거부해 애초에 들어오지 못하게 막는다.
 */

/** `free_text` — 제목(선택) + 본문. 전 필드 `source: "generated"`. */
export function FreeTextBlock({ data, t }: SectionProps) {
  const 제목 = text(data, '제목')
  const 본문 = text(data, '본문')

  return (
    <Band>
      {제목 && <SectionHeading t={t}>{제목}</SectionHeading>}
      <p className={`break-words text-[15px] leading-relaxed whitespace-pre-line ${제목 ? 'mt-5' : ''}`}>
        {본문}
      </p>
    </Band>
  )
}

/**
 * `image` — 이미 업로드된 사진 1장.
 *
 * **`image_id`는 슬롯 이름이 아니라 `product_images.id`다**(§10.2). 슬롯은
 * 「대표」·「숙소」처럼 자리를 가리키는 이름이라 특정 사진 1장을 지목할 수 없다.
 * 편집기에서 새 업로드를 하지 않으므로(§7.3) 참조가 깨지는 경우는 상품 삭제뿐이고,
 * 그때는 페이지도 함께 사라진다.
 */
export function ImageBlock({ data, idx }: SectionProps) {
  const image = idx.byId.get(text(data, 'image_id'))
  // 참조가 끊긴 블록은 조용히 생략한다 — 깨진 이미지 아이콘보다 낫다.
  if (!image) return null

  return (
    <Band>
      <Figure
        image={image}
        ratio="wide"
        sizes="(min-width: 768px) 720px, 100vw"
        caption={text(data, '캡션') || undefined}
      />
    </Band>
  )
}

/** `notice` — 안내 문구. 본문 1개 필드뿐이며 시각적으로만 구분한다. */
export function NoticeBlock({ data }: SectionProps) {
  return (
    <Band>
      <div className="rounded-xl border-l-4 border-[var(--t-primary)] bg-[var(--t-secondary)]/25 px-4 py-3">
        <p className="break-words text-[15px] leading-relaxed whitespace-pre-line">
          {text(data, '본문')}
        </p>
      </div>
    </Band>
  )
}
