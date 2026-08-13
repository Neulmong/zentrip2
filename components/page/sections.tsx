import Image from 'next/image'
import type { ReactNode } from 'react'
import type { BlockStyle, Tone } from '@/lib/pipeline/vocabulary'
import type { EnrichmentPlace } from '@/lib/pipeline/enrichment'
import { Band, headlineClass, SectionHeading, type RenderTheme } from './theme'
import { Figure, SlotGallery } from './media'
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
  /** 그라운딩 실측 정보 (이름 → 장소). 일정·숙박·상점에 실제 설명을 위빙한다 */
  enrich?: Map<string, EnrichmentPlace>
}

/** 위빙용 — 이름·요약·출처를 짧게. 실제 웹 검색 근거 표시 */
function PlaceNote({ place }: { place: EnrichmentPlace }) {
  return (
    <div className="rounded-2xl border border-black/[0.05] bg-white/85 p-4 shadow-[0_2px_16px_-10px_rgba(0,0,0,0.25)]">
      <p className="break-keep text-sm font-semibold">{place.이름}</p>
      <p className="mt-1 break-keep text-[13px] leading-relaxed opacity-90">{place.요약}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-55">출처</span>
        {place.출처.slice(0, 2).map((src, k) => (
          <a key={k} href={src.uri} target="_blank" rel="noopener noreferrer nofollow"
            className="max-w-full truncate text-[11px] font-medium text-[var(--t-primary)] underline-offset-2 hover:underline"
            title={src.title}>{src.title}</a>
        ))}
      </div>
    </div>
  )
}

const layoutOf = (p: SectionProps) => p.style?.layout ?? ''

/* ── 공용 조각 ───────────────────────────────────────────────── */

/**
 * 실제 값이 있는가 — 빈 값과 「추후 추가 예정」 플레이스홀더를 **없는 것으로 본다**.
 * 고객 페이지에는 플레이스홀더를 아예 노출하지 않는다(빈 자리는 그라운딩이 채우거나
 * 생략한다). 이 판정이 렌더 전반의 「채워졌나」 기준이다.
 */
function hasVal(v: string | undefined): v is string {
  return !!v && !!v.trim() && !PLACEHOLDER_VALUES.has(v)
}

function Value({ v }: { v: string }) {
  if (!hasVal(v)) return null
  return <span className="whitespace-pre-line">{v}</span>
}

/** 빈·플레이스홀더 항목은 통째로 생략한다 — 빈 라벨만 남지 않게 */
function Fields({ items, cols = true }: { items: [string, string][]; cols?: boolean }) {
  const shown = items.filter(([, v]) => hasVal(v))
  if (shown.length === 0) return null
  return (
    <dl className={`mt-5 grid gap-x-8 gap-y-4 ${cols ? 'sm:grid-cols-2' : ''}`}>
      {shown.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wider">{k}</dt>
          <dd className="mt-1 break-words text-[15px] leading-relaxed">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * 값 배열 1행 = 카드 1장. **그라운딩 실측 설명을 위빙한다.**
 *
 * 각 행의 이름을 `enrich`에서 찾아 실제 웹 검색 요약을 본문으로 싣는다(출처 표기).
 * 짧은 사실 필드(위치·객실타입 등)는 **실제 값이 있을 때만** 칩으로 붙인다 —
 * 「추후 추가 예정」은 렌더에서 아예 뺀다(`hasVal`). 요약도 사실 필드도 없으면
 * 이름만 남지만, 자동 그라운딩이 요약을 채우므로 삭막해지지 않는다.
 */
function CardList({ rows: list, 제목필드, 필드, 배지필드, cols = 2, enrich }: {
  rows: Record<string, string>[]
  제목필드: string
  필드: readonly string[]
  배지필드?: string
  cols?: 1 | 2 | 3
  enrich?: Map<string, EnrichmentPlace>
}) {
  if (list.length === 0) return null
  const grid = cols === 1 ? '' : cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'

  return (
    <ul className={`mt-6 grid gap-5 ${grid}`}>
      {list.map((row, i) => {
        const place = enrich?.get(row[제목필드])
        const 사실필드 = 필드.filter((f) => hasVal(row[f]))
        return (
          <li key={`${i}-${row[제목필드]}`} className="flex min-w-0 flex-col rounded-3xl border border-black/[0.05] bg-white p-6 shadow-[0_6px_28px_-14px_rgba(0,0,0,0.22)] transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_20px_44px_-18px_rgba(0,0,0,0.28)]">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 break-keep text-lg font-bold leading-snug tracking-tight">{row[제목필드]}</p>
              {배지필드 && row[배지필드] && (
                <span className="shrink-0 rounded-full bg-[var(--t-secondary)] px-3 py-1 text-[11px] font-semibold text-[var(--t-text)]">
                  {row[배지필드]}
                </span>
              )}
            </div>

            {/* 실제 웹 검색 요약 (자동 그라운딩) */}
            {place?.요약 && <p className="mt-3 flex-1 break-keep text-sm leading-relaxed opacity-90">{place.요약}</p>}

            {/* 짧은 사실 필드 — 실제 값만 (플레이스홀더 제외) */}
            {사실필드.length > 0 && (
              <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
                {사실필드.map((f) => (
                  <div key={f} className="min-w-0"><dt className="inline opacity-55">{f} </dt><dd className="inline font-medium">{row[f]}</dd></div>
                ))}
              </dl>
            )}

            {/* 출처 표기 */}
            {place && place.출처.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--t-primary)]/15 pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-55">출처</span>
                {place.출처.slice(0, 2).map((s, k) => (
                  <a key={k} href={s.uri} target="_blank" rel="noopener noreferrer nofollow"
                    className="max-w-full truncate text-[11px] font-medium text-[var(--t-primary)] hover:underline"
                    title={s.title}>{s.title}</a>
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ── 1. hero (layout: classic·split·minimal) ─────────────────── */

/**
 * 시네마틱 히어로 — **감성 카피가 크게, 행사명은 공식 명칭 키커로** (재설계).
 *
 * `headline`은 AI 감성 카피(source: generated), `행사명`은 사실값이다. 큰 제목은
 * 여행의 결을 말하고, 위 키커가 정식 명칭을 밝힌다. 이미지가 없으면 테마
 * 그라디언트로 떨어진다. 흰 글자는 어두운 스크림 위라 대비 예외가 허용된다(§17.2).
 */
export function Hero({ data, t, idx }: SectionProps) {
  const headline = text(data, 'headline')
  const subcopy = text(data, 'subcopy')
  const 행사명 = text(data, '행사명')
  const slot = text(data, 'image_slot')
  const image = slot ? idx.bySlot.get(slot)?.[0] : undefined

  return (
    <section className="zt-reveal relative flex min-h-[82svh] w-full flex-col justify-end overflow-hidden">
      {image ? (
        <Image src={image.url} alt={image.alt} fill sizes="100vw" priority className="object-cover" />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-[var(--t-primary)] to-[var(--t-secondary)]" />
      )}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
      <div className="relative mx-auto w-full max-w-5xl px-5 pb-14 md:px-8 md:pb-20">
        {행사명 && (
          <p className="mb-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/85">
            <span aria-hidden className="inline-block h-px w-8 bg-white/50" />
            {행사명}
          </p>
        )}
        <h1 className={`max-w-[15ch] break-keep text-[2.6rem] font-extrabold leading-[0.98] tracking-tight text-white [text-shadow:0_2px_28px_rgb(0_0_0/0.5)] md:text-6xl lg:text-7xl ${headlineClass(t)}`}>
          {headline}
        </h1>
        {subcopy && (
          <p className="mt-6 max-w-2xl break-keep text-base leading-relaxed text-white/90 [text-shadow:0_1px_14px_rgb(0_0_0/0.55)] md:text-xl">
            {subcopy}
          </p>
        )}
      </div>
    </section>
  )
}

/* ── 2. summary (layout: cards·list·inline) ──────────────────── */

export function Summary(p: SectionProps) {
  const { data, t } = p
  const 행사명 = text(data, '행사명')
  const 여행주제 = text(data, '여행주제')
  const 행사기간 = text(data, '행사기간')
  const items: [string, string][] = [
    ['여행기간', text(data, '여행기간')],
    ...(행사기간 ? [['행사 기간', 행사기간] as [string, string]] : []),
    ['여행지', text(data, '여행지')],
    ['타겟층', text(data, '타겟층')],
    ['여행스타일', text(data, '여행스타일')],
  ]
  const layout = layoutOf(p)
  return (
    <Band style={p.style} nextTone={p.nextTone}>
      {/* 정식 명칭 — 상세 본문에 행사명을 그대로 싣는 자리(재설계 · 사실값) */}
      {행사명 && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] opacity-70">{행사명}</p>
      )}
      <SectionHeading t={t}>여행 개요</SectionHeading>
      {여행주제 && (
        <p className="mt-4 max-w-2xl break-keep text-lg leading-relaxed md:text-xl">{여행주제}</p>
      )}
      <Fields items={items} cols={layout !== 'list'} />
    </Band>
  )
}

/* ── 3. itinerary (layout: stack·numbered·rail) ──────────────── */

export function Itinerary(p: SectionProps) {
  const { data, t, idx, enrich } = p
  const list = days(data)
  const notesFor = (dayText: string): EnrichmentPlace[] =>
    enrich ? [...enrich.values()].filter((pl) => dayText.includes(pl.이름)) : []

  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <div className="mb-8 flex items-end justify-between gap-4 border-b-2 border-current pb-5">
        <div>
          <p className="font-serif text-[15px] italic text-[var(--t-primary)]">닷새의 길</p>
          <SectionHeading t={t}>여행 일정</SectionHeading>
        </div>
        <p className="hidden shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-60 sm:block">
          Day 01 &mdash; {String(list.length).padStart(2, '0')}
        </p>
      </div>
      <ol>
        {list.map((d, i) => {
          const image = d.image_slot ? idx.bySlot.get(d.image_slot)?.[0] : undefined
          const notes = notesFor(d.text)
          return (
            <li key={d.day}
              className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-4 border-b border-[var(--t-primary)]/12 py-8 last:border-0 md:grid-cols-[5rem_1fr] md:gap-x-10">
              <div className="relative">
                <span className={`block font-serif text-4xl leading-none tabular-nums text-[var(--t-primary)] md:text-6xl ${headlineClass(t)}`}>
                  {String(d.day).padStart(2, '0')}
                </span>
                {i < list.length - 1 && (
                  <span aria-hidden
                    className="absolute left-3 top-12 -bottom-8 w-px bg-[var(--t-primary)]/20 md:left-4 md:top-16" />
                )}
              </div>
              <div className="min-w-0">
                <div className={image ? 'grid gap-5 md:grid-cols-[1fr_15rem] md:items-start' : ''}>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-60">{d.day}일차</p>
                    <p className="mt-2 break-keep text-[15px] leading-relaxed md:text-base">{d.text}</p>
                  </div>
                  {image && <Figure image={image} ratio="wide" sizes="(min-width: 768px) 240px, 100vw" />}
                </div>
                {/* 이 날 가는 장소의 실제 정보(웹 검색 근거) — 위빙 */}
                {notes.length > 0 && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {notes.map((pl) => <PlaceNote key={pl.이름} place={pl} />)}
                  </div>
                )}
              </div>
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
        cols={layoutOf(p) === 'rows' ? 1 : 2} enrich={p.enrich} />
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
  // 표를 없앤다 — 편집물처럼 필드를 흘려 배치. 실제 값이 있는 것만, 없으면 섹션 생략
  const shown = cols.filter(([, v]) => hasVal(v))
  if (shown.length === 0) return null
  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <SectionHeading t={t}>항공</SectionHeading>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 md:grid-cols-5">
        {shown.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-60">{k}</dt>
            <dd className="mt-1.5 break-words text-[15px] font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Band>
  )
}

/* ── 6. meal (layout: plain·panel) ───────────────────────────── */

export function Meal(p: SectionProps) {
  const { data, t } = p
  return (
    <Band style={p.style} nextTone={p.nextTone}>
      <SectionHeading t={t}>식사</SectionHeading>
      <p className="mt-5 max-w-2xl break-keep text-lg leading-relaxed"><Value v={text(data, '식사정보')} /></p>
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
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {([['성인', text(data, '성인')], ['아동', text(data, '아동')]] as [string, string][]).map(([k, v]) => (
          <div key={k} className="rounded-3xl border border-black/[0.05] bg-white p-6 shadow-[0_6px_28px_-16px_rgba(0,0,0,0.2)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.26)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-60">{k}</p>
            <p className={`mt-2 break-all font-serif text-3xl font-medium tabular-nums md:text-4xl ${headlineClass(t)}`}><Value v={v} /></p>
          </div>
        ))}
      </div>
      {hasVal(etc) && <p className="mt-5 max-w-2xl break-keep text-[15px] leading-relaxed opacity-90">{etc}</p>}
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
      <CardList rows={list} 제목필드="상점명" 배지필드="구분" 필드={['위치']}
        cols={layout === 'rows' ? 1 : layout === 'grid' ? 3 : 2} enrich={p.enrich} />
      <SlotGallery images={images} className="mt-6" />
    </Band>
  )
}

/* ── 9. apply ────────────────────────────────────────────────── */

export function Apply({ data, t, style, nextTone, form }: SectionProps & { form?: ReactNode }) {
  const 가격요약 = (data.가격요약 ?? {}) as Record<string, unknown>
  const 행사정보요약 = (data.행사정보요약 ?? {}) as Record<string, unknown>
  const 성인 = text(가격요약, '성인')
  const 아동 = text(가격요약, '아동')
  const 아동노출 = 아동 && !PLACEHOLDER_VALUES.has(아동) && 아동 !== '해당 없음'
  return (
    <Band style={style} nextTone={nextTone}>
      {/* 매거진식 예약 배너 — 감성 헤드라인으로 끌고, 세리프 요금으로 닫는다 */}
      <div className="overflow-hidden rounded-[2rem] bg-[var(--t-primary)] text-white shadow-[0_20px_50px_-20px_rgba(0,0,0,0.4)]">
        <div className="grid gap-8 p-7 md:grid-cols-[1.15fr_.85fr] md:items-center md:p-12">
          <div className="min-w-0">
            <p className="font-serif text-[15px] italic text-white/80">신청</p>
            <h2 className={`mt-1 break-keep text-2xl font-extrabold tracking-tight md:text-4xl ${headlineClass(t)}`}>
              {text(data, '제목') || '이 여행, 함께하시겠어요?'}
            </h2>
            <p className="mt-4 max-w-[34em] break-keep text-[15px] leading-relaxed text-white/90">
              <Value v={text(data, '안내문구')} />
            </p>
            <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-white/85">
              <div className="min-w-0"><dt className="inline text-white/60">행사 </dt><dd className="inline"><Value v={text(행사정보요약, '행사명')} /></dd></div>
              <div className="min-w-0"><dt className="inline text-white/60">기간 </dt><dd className="inline"><Value v={text(행사정보요약, '여행기간')} /></dd></div>
            </dl>
          </div>
          <div className="rounded-2xl bg-white/10 p-6 text-center md:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">1인 요금</p>
            <p className="mt-2 break-all font-serif text-4xl font-medium tabular-nums md:text-5xl"><Value v={성인} /></p>
            {아동노출 && <p className="mt-1 text-sm text-white/70">아동 <Value v={아동} /></p>}
          </div>
        </div>
      </div>
      {form && <div className="mt-8">{form}</div>}
    </Band>
  )
}
