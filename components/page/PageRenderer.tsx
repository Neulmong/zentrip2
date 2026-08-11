import type { ReactNode } from 'react'
import type { PageContent, PageSection } from '@/lib/pipeline/page'
import { themeVars, tokensOf } from './theme'
import { indexImages, type PageImage } from './types'
import {
  Accommodation, Apply, Flight, Hero, Itinerary, Meal, Price, Shop, Summary,
  type SectionProps,
} from './sections'
import { FreeTextBlock, ImageBlock, NoticeBlock } from './blocks'

/**
 * `page_content` → 화면 (§9.1).
 *
 * **AI는 콘텐츠 모델(JSON)만 만들고 HTML을 만들지 않는다.** 이 컴포넌트가 그
 * JSON을 그리는 유일한 경로이고, 공개 페이지(`/p/{slug}`)와 편집기 미리보기가
 * 이것을 공유한다 — 미리보기와 실제 페이지가 어긋나면 미리보기의 의미가 없다.
 *
 * 서버 컴포넌트 트리와 클라이언트 컴포넌트 트리 양쪽에서 쓰이므로 React
 * context를 쓰지 않는다(서버 트리에는 provider를 둘 수 없다). 테마 토큰은
 * props로 내려보내고, 색만 CSS 변수로 상속시킨다.
 */

/** `type` → 컴포넌트. 표에 없는 `type`은 그리지 않는다(아래 주석 참조). */
const RENDERERS: Record<string, (p: SectionProps) => ReactNode> = {
  // §9.3 섹션 9종
  hero: Hero,
  summary: Summary,
  itinerary: Itinerary,
  accommodation: Accommodation,
  flight: Flight,
  meal: Meal,
  price: Price,
  shop: Shop,
  // apply는 `form` prop이 더 필요해 아래에서 따로 분기한다
  // §10.2 삽입 블록 3종
  free_text: FreeTextBlock,
  image: ImageBlock,
  notice: NoticeBlock,
}

export function PageRenderer({
  content, images, applyForm,
}: {
  content: PageContent
  images: PageImage[]
  /**
   * `apply` 섹션에 끼울 신청 폼(§13.1). 공개 페이지는 실제 폼을, 편집기
   * 미리보기는 비활성 안내를 넣는다 — 미리보기에서 신청이 접수되면 안 된다.
   */
  applyForm?: ReactNode
}) {
  const t = tokensOf(content.theme)
  const idx = indexImages(images)

  /**
   * `visible: false`는 편집기에서 삭제한 섹션이다 — 데이터는 남기고 화면에서만
   * 뺀다(§10.2). `order`로 정렬하는 이유는 삽입·순서변경 이후 배열 순서와
   * `order` 값이 어긋날 수 있기 때문이다. 저장 경로가 1부터 다시 번호를
   * 매기지만(§10.2), 렌더러가 그것에 의존하지 않는다.
   */
  const visible: PageSection[] = content.sections
    .filter((s) => s.visible !== false)
    .sort((a, b) => a.order - b.order)

  return (
    <div
      style={themeVars(content.theme)}
      className="min-h-screen w-full overflow-x-hidden bg-[var(--t-surface)] text-[var(--t-text)]"
    >
      {visible.map((s) => {
        const props: SectionProps = { data: s.data, t, idx }

        if (s.type === 'apply') {
          return <Apply key={s.id} {...props} form={applyForm} />
        }

        const Component = RENDERERS[s.type]
        /**
         * 모르는 `type`은 **조용히 생략한다.** 예외를 던지면 페이지 전체가
         * 500이 되는데, 게시된 상품이 알 수 없는 블록 하나 때문에 통째로
         * 열리지 않는 편이 더 나쁘다. 애초에 저장 경로가 걸러야 할 일이다.
         */
        if (!Component) return null
        return <Component key={s.id} {...props} />
      })}
    </div>
  )
}
