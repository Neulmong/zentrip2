import type { ReactNode } from 'react'
import type { PageContent, PageSection } from '@/lib/pipeline/page'
import type { BlockStyle, Tone } from '@/lib/pipeline/vocabulary'
import { Background, renderTheme, themeVars } from './theme'
import { indexImages, type PageImage } from './types'
import {
  Accommodation, Apply, Flight, Hero, Itinerary, Meal, Price, Shop, Summary,
  type SectionProps,
} from './sections'
import {
  Cta, Divider, FreeTextBlock, Gallery, Highlight, ImageBlock, NoticeBlock,
  Spotlight, Stat, Timeline,
} from './blocks'

/**
 * `page_content` → 화면 (spec 2.8 §9.1).
 *
 * **AI는 콘텐츠 모델(JSON)만 만들고 HTML을 만들지 않는다.** 렌더러는 이미 구성에
 * 무관하다 — `sections`를 `order`로 정렬하고 `type → 컴포넌트` 맵으로 그린다.
 * 개수·순서·반복·생략이 **이미 데이터가 정한다**(§8.1). 2.8에서 어휘가 넓어져
 * 이 표만 늘었다.
 */

/** `type` → 컴포넌트. 표에 없는 `type`은 그리지 않는다(아래 주석 참조). */
const RENDERERS: Record<string, (p: SectionProps) => ReactNode> = {
  // 기존 9종 (apply는 form prop 때문에 아래에서 따로 분기)
  hero: Hero, summary: Summary, itinerary: Itinerary, accommodation: Accommodation,
  flight: Flight, meal: Meal, price: Price, shop: Shop,
  // 삽입 3종 (§10.2)
  free_text: FreeTextBlock, image: ImageBlock, notice: NoticeBlock,
  // 추가 7종
  gallery: Gallery, highlight: Highlight, spotlight: Spotlight, timeline: Timeline,
  cta: Cta, stat: Stat, divider: Divider,
}

export function PageRenderer({
  content, images, applyForm,
}: {
  content: PageContent
  images: PageImage[]
  applyForm?: ReactNode
}) {
  const t = renderTheme(content.theme)
  const idx = indexImages(images)

  const visible: PageSection[] = content.sections
    .filter((s) => s.visible !== false)
    .sort((a, b) => a.order - b.order)

  return (
    <div
      style={themeVars(content.theme)}
      className="relative min-h-screen w-full overflow-x-hidden text-[var(--t-text)]"
    >
      {/* 배경 레이어 — surface → surfaceDeep. bare tone 블록이 이 위에 뜬다 */}
      <Background background={t.background} />

      {visible.map((s, i) => {
        // edge 장식이 칠할 색 — 다음 블록의 tone (명령서 4-③)
        const nextTone: Tone | undefined = (visible[i + 1]?.style as BlockStyle | undefined)?.tone
        const props: SectionProps = { data: s.data, t, idx, style: s.style, nextTone }

        // id 앵커 — cta의 "신청하기"가 #sec_apply로 스크롤한다
        const anchor = s.type === 'apply' ? 'sec_apply' : undefined

        if (s.type === 'apply') {
          return <div key={s.id} id={anchor}><Apply {...props} form={applyForm} /></div>
        }

        const Component = RENDERERS[s.type]
        /**
         * 모르는 `type`은 **조용히 생략한다.** 예외를 던지면 페이지 전체가 500이
         * 되는데, 게시된 상품이 알 수 없는 블록 하나 때문에 통째로 열리지 않는
         * 편이 더 나쁘다. 애초에 저장 경로가 걸러야 할 일이다.
         */
        if (!Component) return null
        return <Component key={s.id} {...props} />
      })}
    </div>
  )
}
