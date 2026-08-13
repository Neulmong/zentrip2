import Image from 'next/image'
import type { ReactNode } from 'react'
import type { BlockStyle, Tone } from '@/lib/pipeline/vocabulary'
import { Band, headlineClass, SectionHeading, type RenderTheme } from './theme'
import { Figure, RATIO, SlotGallery } from './media'
import {
  days, PLACEHOLDER_VALUES, rows, slotNames, text,
  type ImageIndex,
} from './types'

/**
 * 섹션 컴포넌트 (spec 2.8 §9.3) — **고정 React 컴포넌트**.
 *
 * AI는 `page_content` JSON만 만들고 HTML을 생성하지 않는다(§9.1). 이 파일이 그
 * JSON을 그리는 유일한 경로다. **기존 9종은 렌더 로직을 보존하되**(명령서 4-④),
 * `style.layout` 값에 따라 몇 가지 배치 변형을 갖는다 — 시각적 다양성의 대부분은
 * 공용 래퍼 `Band`(theme.tsx)가 처리하고, 여기서는 타입 고유의 변형만 둔다.
 *
 * ## 대비 규칙 (§17.2, 본문 4.5:1)
 *
 * **본문 텍스트에 투명도를 쓰지 않는다.** 위계는 크기·굵기로만 만든다. 예외는
 * 히어로의 흰 글자다(어두운 스크림 위라 90%로 낮춰도 12:1 이상).
 */

export interface SectionProps {
  data: Record<string, unknown>
  t: RenderTheme
  idx: ImageIndex
  /** 블록별 스타일 손잡이. 없으면 기본값 */
  style?: BlockStyle
  /** 다음 블록의 tone — edge 장식 색 */
  nextTone?: Tone
}

const layoutOf = (p: SectionProps) => p.style?.layout ?? ''

/* ── 공용 조각 ───────────────────────────────────────────────── */

function Value({ v }: { v: string }) {
  if (!v) return <span className="italic">-</span>
  if (PLACEHOLDER_VALUES.has(v)) return <span className="italic">{v}</span>
  return <span className="whitespace-pre-line">{v}</span>
}

function Fields({ items, cols = true }: { items: [string, string][]; cols?: boolean }) {
  return (
    <dl className={`mt-5 grid gap-x-8 gap-y-4 ${cols ? 'sm:grid-cols-2' : ''}`}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wider">{k}</dt>
          <dd className="mt-1 break-words text-[15px] leading-relaxed"><Value v={v} /></dd>
        </div>
      ))}
    </dl>
  )
}

/** 값 배열 1행 = 카드 1장. `cols`로 1·2·3열 변형 */
function CardList({ rows: list, 제목필드, 필드, 배지필드, cols = 2 }: {
  rows: Record<string, string>[]
  제목필드: string
  필드: readonly string[]
  배지필드?: string
  cols?: 1 | 2 | 3
}) {
  if (list.length === 0) return <p className="mt-5 text-[15px] italic">등록된 항목이 없습니다.</p>
  const grid = cols === 1 ? '' : cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'

  return (
    <ul className={`mt-5 grid gap-4 ${grid}`}>
      {list.map((row, i) => (
        <li key={`${i}-${row[제목필드]}`} className="min-w-0 rounded-xl border border-[var(--t-primary)] p-4">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug">
              <Value v={row[제목필드]} />
            </p>
            {배지필드 && row[배지필드] && (
              <span className="shrink-0 rounded-full bg-[var(--t-secondary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--t-text)]">
                {row[배지필드]}
              </span>
            )}
          </div>
          <dl className="mt-3 space-y-2.5">
            {필드.map((f) => (
              <div key={f} className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wider">{f}</dt>
                <dd className="mt-0.5 break-words text-sm leading-relaxed"><Value v={row[f]} /></dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  )
}

/* ── 1. hero (layout: classic·split·minimal) ─────────────────── */

export function Hero({ data, t, idx, style }: SectionProps) {
  const headline = text(data, 'headline')
  const subcopy = text(data, 'subcopy')
  const slot = text(data, 'image_slot')
  const image = slot ? idx.bySlot.get(slot)?.[0] : undefined
  const layout = style?.layout ?? 'classic'

  // minimal: 이미지 없이 테마 그라디언트 + 큰 제목 (분위기 전환)
  if (layout === 'minimal' || !image) {
    return (
      <section className={`relative w-full overflow-hidden ${image ? '' : ''} ${RATIO.hero}`}>
        {image ? (
          <Image src={image.url} alt={image.alt} fill sizes="100vw" priority className="object-cover" />
        ) : (
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-[var(--t-primary)] to-[var(--t-secondary)]" />
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/10" />
        <div className="absolute inset-x-0 bottom-0">
          <div className={`mx-auto max-w-3xl px-5 pb-7 md:px-8 md:pb-10 ${layout === 'split' ? '' : ''}`}>
            <h1 className={`text-2xl leading-tight text-white md:text-4xl ${headlineClass(t)}`}>{headline}</h1>
            {subcopy && <p className="mt-2 text-sm text-white/90 md:text-base">{subcopy}</p>}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className={`relative w-full overflow-hidden ${RATIO.hero}`}>
      <Image src={image.url} alt={image.alt} fill sizes="100vw" priority className="object-cover" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/10" />
      <div className={`absolute inset-x-0 ${layout === 'split' ? 'inset-y-0 flex items-center' : 'bottom-0'}`}>
        <div className="mx-auto max-w-3xl px-5 pb-7 md:px-8 md:pb-10">
          <h1 className={`text-2xl leading-tight text-white md:text-4xl ${headlineClass(t)}`}>{headline}</h1>
          {subcopy && <p className="mt-2 text-sm text-white/90 md:text-base">{subcopy}</p>}
        </div>
      </div>
    </section>
  )
}

/* ── 2. summary (layout: cards·list·inline) ──────────────────── */

export function Summary(p: SectionProps) {
  const { data, t } = p
  const 행사기간 = text(data, '행사기간')
  const items: [string, string][] = [
    ['여행기간', text(data, '여행기간')],
    ...(행사기간 ? [['행사 기간', 행사기간] as [string, string]] : []),
    ['여행지', text(data, '여행지')],
    ['여행주제', text(data, '여행주제')],
    ['타겟층', text(data, '타겟층')],
    ['여행스타일', text(data, '여행스타일')],
  ]
  const layout = layoutOf(p)
  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <SectionHeading t={t}>여행 개요</SectionHeading>
      <Fields items={items} cols={layout !== 'list'} />
    </Band>
  )
}

/* ── 3. itinerary (layout: stack·numbered·rail) ──────────────── */

export function Itinerary(p: SectionProps) {
  const { data, t, idx } = p
  const list = days(data)
  const rail = layoutOf(p) === 'rail'

  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <SectionHeading t={t}>일정</SectionHeading>
      <ol className={`mt-5 ${rail ? 'space-y-0 border-l-2 border-[var(--t-secondary)] pl-5' : 'space-y-6'}`}>
        {list.map((d) => {
          const image = d.image_slot ? idx.bySlot.get(d.image_slot)?.[0] : undefined
          return (
            <li key={d.day} className={rail ? 'relative pb-6' : 'grid gap-4 md:grid-cols-[1fr_15rem] md:items-start'}>
              {rail && <span aria-hidden className="absolute -left-[1.4rem] top-1 size-3 rounded-full bg-[var(--t-primary)]" />}
              <div className="min-w-0">
                <span className="inline-block rounded-full bg-[var(--t-secondary)] px-3 py-0.5 text-xs font-semibold text-[var(--t-text)]">
                  {d.day}일차
                </span>
                <p className="mt-2 break-words text-[15px] leading-relaxed">{d.text}</p>
              </div>
              {!rail && image && <Figure image={image} ratio="wide" sizes="(min-width: 768px) 240px, 100vw" />}
            </li>
          )
        })}
      </ol>
    </Band>
  )
}

/* ── 4. accommodation (layout: cards·rows) ───────────────────── */

export function Accommodation(p: SectionProps) {
  const { data, t, idx } = p
  const images = slotNames(data).flatMap((s) => idx.bySlot.get(s) ?? [])
  const list = rows(data, '숙소들', ['숙소명', '객실타입', '위치', '숙박일정'])
  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <SectionHeading t={t}>숙박</SectionHeading>
      <CardList rows={list} 제목필드="숙소명" 필드={['객실타입', '위치', '숙박일정']}
        cols={layoutOf(p) === 'rows' ? 1 : 2} />
      <SlotGallery images={images} className="mt-6" />
    </Band>
  )
}

/* ── 5. flight (layout: table·cards) ─────────────────────────── */

export function Flight(p: SectionProps) {
  const { data, t } = p
  const cols: [string, string][] = [
    ['공항', text(data, '공항')], ['항공사', text(data, '항공사')], ['편명', text(data, '편명')],
    ['출발시간', text(data, '출발시간')], ['도착시간', text(data, '도착시간')],
  ]
  if (layoutOf(p) === 'cards') {
    return (
      <Band style={p.style} nextTone={p.nextTone}>
        <SectionHeading t={t}>항공</SectionHeading>
        <Fields items={cols} />
      </Band>
    )
  }
  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <SectionHeading t={t}>항공</SectionHeading>
      <div className="mt-5 -mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
        <table className="w-full min-w-[34rem] border-collapse text-left text-[15px]">
          <thead>
            <tr className="border-b-2 border-[var(--t-primary)]">
              {cols.map(([k]) => (
                <th key={k} scope="col" className="py-2 pr-4 text-xs font-semibold uppercase tracking-wider">{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>{cols.map(([k, v]) => <td key={k} className="py-3 pr-4 align-top"><Value v={v} /></td>)}</tr>
          </tbody>
        </table>
      </div>
    </Band>
  )
}

/* ── 6. meal (layout: plain·panel) ───────────────────────────── */

export function Meal(p: SectionProps) {
  const { data, t } = p
  const body = <p className="break-words text-[15px] leading-relaxed"><Value v={text(data, '식사정보')} /></p>
  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <SectionHeading t={t}>식사</SectionHeading>
      {layoutOf(p) === 'panel'
        ? <div className="mt-5 rounded-xl border border-[var(--t-primary)]/25 px-4 py-3">{body}</div>
        : <div className="mt-5">{body}</div>}
    </Band>
  )
}

/* ── 7. price (layout: cards·table) ──────────────────────────── */

export function Price(p: SectionProps) {
  const { data, t } = p
  const etc = text(data, '기타')
  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <SectionHeading t={t}>가격</SectionHeading>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {([['성인', text(data, '성인')], ['아동', text(data, '아동')]] as [string, string][]).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-[var(--t-primary)]/25 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider">{k}</p>
            <p className="mt-1 break-words text-lg font-semibold"><Value v={v} /></p>
          </div>
        ))}
      </div>
      {etc && <p className="mt-4 break-words text-sm leading-relaxed"><Value v={etc} /></p>}
    </Band>
  )
}

/* ── 8. shop (layout: cards·rows·grid) ───────────────────────── */

export function Shop(p: SectionProps) {
  const { data, t, idx } = p
  const images = slotNames(data).flatMap((s) => idx.bySlot.get(s) ?? [])
  const list = rows(data, '상점들', ['상점명', '구분', '위치', '상점정보'])
  const layout = layoutOf(p)
  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <SectionHeading t={t}>제휴·추천 상점</SectionHeading>
      <CardList rows={list} 제목필드="상점명" 배지필드="구분" 필드={['위치', '상점정보']}
        cols={layout === 'rows' ? 1 : layout === 'grid' ? 3 : 2} />
      <SlotGallery images={images} className="mt-6" />
    </Band>
  )
}

/* ── 9. apply ────────────────────────────────────────────────── */

export function Apply({ data, t, style, nextTone, form }: SectionProps & { form?: ReactNode }) {
  const 가격요약 = (data.가격요약 ?? {}) as Record<string, unknown>
  const 행사정보요약 = (data.행사정보요약 ?? {}) as Record<string, unknown>
  return (
    <Band style={style} nextTone={nextTone} className="border-t border-[var(--t-primary)]/20">
      <SectionHeading t={t}>{text(data, '제목') || '신청'}</SectionHeading>
      <p className="mt-4 break-words text-[15px] leading-relaxed"><Value v={text(data, '안내문구')} /></p>
      <dl className="mt-5 grid gap-x-8 gap-y-3 rounded-xl bg-[var(--t-secondary)]/25 px-4 py-4 sm:grid-cols-2">
        {([
          ['행사명', text(행사정보요약, '행사명')],
          ['여행기간', text(행사정보요약, '여행기간')],
          ['성인 요금', text(가격요약, '성인')],
          ['아동 요금', text(가격요약, '아동')],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wider">{k}</dt>
            <dd className="mt-1 break-words text-[15px]"><Value v={v} /></dd>
          </div>
        ))}
      </dl>
      {form && <div className="mt-6">{form}</div>}
    </Band>
  )
}
