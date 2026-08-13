import { Band, SectionHeading, headlineClass } from './theme'
import { Figure } from './media'
import { days, text } from './types'
import type { SectionProps } from './sections'

/**
 * 삽입 블록 3종(§10.2) + 추가 블록 7종 (spec 2.8 · 명령서 4-④).
 *
 * 섹션 컴포넌트와 같은 `{data, t, idx, style, nextTone}`를 받는다 — 렌더러
 * 입장에서는 `type`만 다른 같은 원소다. 시각적 변화의 대부분은 공용 래퍼 `Band`
 * (theme.tsx)가 tone·width·pad·align·edge로 처리하고, 여기서는 타입 고유의
 * 내부 배치만 둔다.
 *
 * `quote`(후기·인용)는 **없다.** 입력에 없는 값이라 만들면 §16.1 위반이다 —
 * 어휘에서 빼는 것으로 막는다(명령서 4-④).
 */

/* ════════ 삽입 3종 (§10.2) — 편집기 전용 ════════ */

export function FreeTextBlock({ data, t, style, nextTone }: SectionProps) {
  const 제목 = text(data, '제목')
  const 본문 = text(data, '본문')
  return (
    <Band style={style} nextTone={nextTone}>
      {제목 && <SectionHeading t={t}>{제목}</SectionHeading>}
      <p className={`break-words whitespace-pre-line text-[15px] leading-relaxed ${제목 ? 'mt-5' : ''}`}>{본문}</p>
    </Band>
  )
}

export function ImageBlock({ data, idx, style, nextTone }: SectionProps) {
  const image = idx.byId.get(text(data, 'image_id'))
  if (!image) return null
  return (
    <Band style={style} nextTone={nextTone}>
      <Figure image={image} ratio="wide" sizes="(min-width: 768px) 720px, 100vw" caption={text(data, '캡션') || undefined} />
    </Band>
  )
}

export function NoticeBlock({ data, style, nextTone }: SectionProps) {
  return (
    <Band style={style} nextTone={nextTone}>
      <div className="rounded-xl border-l-4 border-[var(--t-primary)] bg-[var(--t-secondary)]/25 px-4 py-3">
        <p className="break-words whitespace-pre-line text-[15px] leading-relaxed">{text(data, '본문')}</p>
      </div>
    </Band>
  )
}

/* ════════ 추가 7종 ════════ */

/** gallery — 슬롯 사진 묶음 (layout: grid·mosaic) */
export function Gallery({ data, idx, style, nextTone }: SectionProps) {
  const slots = Array.isArray(data.image_slots) ? (data.image_slots as string[]) : []
  const images = slots.flatMap((s) => idx.bySlot.get(s) ?? [])
  if (images.length === 0) return null
  const mosaic = (style?.layout ?? 'grid') === 'mosaic'
  return (
    <Band style={style} nextTone={nextTone}>
      <div className={`grid gap-3 ${mosaic ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3'}`}>
        {images.map((im, i) => (
          <div key={im.id} className={mosaic && i % 5 === 0 ? 'col-span-2 row-span-2' : ''}>
            <Figure image={im} ratio="tile" sizes="(min-width: 768px) 240px, 45vw" />
          </div>
        ))}
      </div>
    </Band>
  )
}

/** highlight — 강조 문구 여러 개. source: generated (layout: banner·stack) */
export function Highlight({ data, t, style, nextTone }: SectionProps) {
  const 문구들 = Array.isArray(data.문구들) ? (data.문구들 as string[]).filter(Boolean) : []
  if (문구들.length === 0) return null
  const banner = (style?.layout ?? 'banner') === 'banner'
  return (
    <Band style={style} nextTone={nextTone}>
      <ul className={banner ? 'flex flex-wrap gap-3' : 'space-y-3'}>
        {문구들.map((line, i) => (
          <li key={i} className={`break-words text-lg font-semibold leading-snug ${headlineClass(t)} ${banner ? 'rounded-full border border-current px-4 py-1.5 text-[15px]' : ''}`}>
            {line}
          </li>
        ))}
      </ul>
    </Band>
  )
}

/** spotlight — 한 곳 집중 소개. 숙박[i]/상점[i] 이름·위치(기계) + 본문(AI) (layout: side·stacked) */
export function Spotlight({ data, t, idx, style, nextTone }: SectionProps) {
  const 이름 = text(data, '이름')
  const 위치 = text(data, '위치')
  const 본문 = text(data, '본문')
  const slot = text(data, 'image_slot')
  const image = slot ? idx.bySlot.get(slot)?.[0] : undefined
  const side = (style?.layout ?? 'side') === 'side' && image
  return (
    <Band style={style} nextTone={nextTone}>
      <div className={side ? 'grid gap-5 md:grid-cols-[18rem_1fr] md:items-center' : ''}>
        {image && <Figure image={image} ratio="wide" sizes="(min-width: 768px) 288px, 100vw" />}
        <div className="min-w-0">
          <SectionHeading t={t}>{이름}</SectionHeading>
          {위치 && <p className="mt-1 text-sm">{위치}</p>}
          {본문 && <p className="mt-3 break-words text-[15px] leading-relaxed">{본문}</p>}
        </div>
      </div>
    </Band>
  )
}

/** timeline — 일정의 다른 표현. itinerary와 같은 재료 (layout: rail·alternating) */
export function Timeline({ data, t, style, nextTone }: SectionProps) {
  const list = days(data)
  const alt = (style?.layout ?? 'rail') === 'alternating'
  return (
    <Band style={style} nextTone={nextTone}>
      <SectionHeading t={t}>일정</SectionHeading>
      <ol className="mt-6 border-l-2 border-[var(--t-primary)] pl-6">
        {list.map((d, i) => (
          <li key={d.day} className={`relative pb-7 ${alt && i % 2 ? 'md:ml-8' : ''}`}>
            <span aria-hidden className="absolute -left-[1.72rem] top-0.5 flex size-6 items-center justify-center rounded-full bg-[var(--t-primary)] text-[11px] font-bold text-white">
              {d.day}
            </span>
            <p className="break-words text-[15px] leading-relaxed">{d.text}</p>
          </li>
        ))}
      </ol>
    </Band>
  )
}

/** cta — 중간 신청 유도. source: generated (layout: bar·panel) */
export function Cta({ data, t, style, nextTone }: SectionProps) {
  const 제목 = text(data, '제목')
  const 본문 = text(data, '본문')
  const bar = (style?.layout ?? 'bar') === 'bar'
  return (
    <Band style={style} nextTone={nextTone}>
      <div className={`rounded-2xl bg-[var(--t-primary)] px-6 py-6 text-white ${bar ? 'flex flex-wrap items-center justify-between gap-4' : 'text-center'}`}>
        <div className="min-w-0">
          {제목 && <p className={`break-words text-xl font-bold ${headlineClass(t)}`}>{제목}</p>}
          {본문 && <p className="mt-1 break-words text-sm text-white/90">{본문}</p>}
        </div>
        <a href="#sec_apply" className="shrink-0 rounded-full bg-white px-5 py-2 text-sm font-semibold text-[var(--t-primary)]">
          신청하기
        </a>
      </div>
    </Band>
  )
}

/** stat — 숫자 요약. **기계가 세는 값만** (layout: row·grid) */
export function Stat({ data, t, style, nextTone }: SectionProps) {
  const items = Array.isArray(data.items) ? (data.items as { label: string; value: string }[]) : []
  if (items.length === 0) return null
  const grid = (style?.layout ?? 'row') === 'grid'
  return (
    <Band style={style} nextTone={nextTone}>
      <dl className={`grid gap-4 ${grid ? 'grid-cols-2 md:grid-cols-3' : `grid-cols-${Math.min(items.length, 3)}`} text-center`}>
        {items.map((it) => (
          <div key={it.label} className="rounded-xl border border-[var(--t-primary)]/25 px-3 py-4">
            <dd className={`text-2xl font-bold ${headlineClass(t)}`}>{it.value}</dd>
            <dt className="mt-1 text-xs font-semibold uppercase tracking-wider">{it.label}</dt>
          </div>
        ))}
      </dl>
    </Band>
  )
}

/** divider — 분위기 전환용 장식. 값이 없다 (layout: plain·wave·diagonal) */
export function Divider({ style, nextTone }: SectionProps) {
  const layout = style?.layout ?? 'plain'
  if (layout === 'wave') {
    return <div aria-hidden className="h-10 w-full bg-[var(--t-secondary)]/30" style={{ clipPath: 'ellipse(75% 100% at 50% 0%)' }} />
  }
  if (layout === 'diagonal') {
    return <div aria-hidden className="h-10 w-full bg-[var(--t-secondary)]/30" style={{ clipPath: 'polygon(0 0, 100% 40%, 100% 100%, 0 60%)' }} />
  }
  return (
    <Band style={style} nextTone={nextTone} className="py-6">
      <div className="mx-auto h-1 w-16 rounded-full bg-[var(--t-primary)]" />
    </Band>
  )
}
