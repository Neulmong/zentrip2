import type { ReactNode } from 'react'
import type { PageContent, PageSection } from '@/lib/pipeline/page'
import type { BlockStyle, Tone } from '@/lib/pipeline/vocabulary'
import { Background, renderTheme, themeVars } from './theme'
import { indexImages, type PageImage } from './types'
import {
  Accommodation, Apply, Flight, Hero, isDining, Itinerary, Meal, Price, Shop, Summary,
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

  // 그라운딩 실측 정보(이름 → 장소) — 일정·숙박·상점 렌더러가 실제 설명을 위빙한다
  const enrich = new Map((content.enrichment?.places ?? []).map((p) => [p.이름, p]))

  const sorted: PageSection[] = content.sections
    .filter((s) => s.visible !== false)
    .sort((a, b) => a.order - b.order)

  // 여행 개요는 항상 여행 일정보다 위에 (사용자 요청 · 순수 렌더 재배치)
  const visible = summaryBeforeItinerary(sorted)

  // 식사/상점 분류 — 상점 목록을 식당·카페(dining) vs 리테일(retail)로 나눈다.
  // 값은 그대로이고 「어느 섹션에 보일지」만 정한다(순수 렌더 · 검증 계약 밖).
  const 상점들 = (visible.find((s) => s.type === 'shop')?.data.상점들 ?? []) as Record<string, string>[]
  const dining = 상점들.filter((r) => isDining(r.상점명, enrich))
  const retail = 상점들.filter((r) => !isDining(r.상점명, enrich))

  // 항공 정보 — 일정 1일차에 함께 보여 준다(12.png식). 항공 섹션 데이터를 그대로 넘긴다
  const fd = visible.find((s) => s.type === 'flight')?.data as Record<string, string> | undefined
  const flight = fd && {
    공항: fd.공항 ?? '', 항공사: fd.항공사 ?? '', 편명: fd.편명 ?? '',
    출발시간: fd.출발시간 ?? '', 도착시간: fd.도착시간 ?? '',
  }

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
        const props: SectionProps = { data: s.data, t, idx, style: s.style, nextTone, enrich }

        // id 앵커 — cta의 "신청하기"가 #sec_apply로 스크롤한다
        const anchor = s.type === 'apply' ? 'sec_apply' : undefined

        // 그라운딩 정보는 이제 일정·숙박·상점에 **위빙**된다(별도 섹션 없음)
        if (s.type === 'apply') {
          return <div key={s.id} id={anchor}><Apply {...props} form={applyForm} /></div>
        }
        // 식사 = 식당·카페 카드, 상점 = 리테일만 (분류를 넘긴다)
        if (s.type === 'meal') return <Meal key={s.id} {...props} dining={dining} />
        if (s.type === 'shop') return <Shop key={s.id} {...props} retail={retail} />
        // 일정 1일차에 항공 카드를 함께 보여 준다
        if (s.type === 'itinerary') return <Itinerary key={s.id} {...props} flight={flight || undefined} />

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

/**
 * 여행 개요(summary)를 여행 일정(itinerary·timeline) **앞으로** 옮긴다.
 * 저장 데이터의 `order`는 건드리지 않는다 — 표시 순서만 바꾸므로 편집·검증에 영향이 없고
 * 이미 게시된 페이지에도 즉시 적용된다. 둘 중 하나라도 없거나 이미 앞서면 그대로 둔다.
 */
function summaryBeforeItinerary(secs: PageSection[]): PageSection[] {
  const out = [...secs]
  const si = out.findIndex((s) => s.type === 'summary')
  const isItin = (s: PageSection) => s.type === 'itinerary' || s.type === 'timeline'
  const ii = out.findIndex(isItin)
  if (si === -1 || ii === -1 || si < ii) return out
  const [sum] = out.splice(si, 1)
  out.splice(out.findIndex(isItin), 0, sum)
  return out
}
