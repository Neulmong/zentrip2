import Image from 'next/image'
import type { ReactNode } from 'react'
import type { ThemeTokens } from '@/lib/pipeline/theme'
import { headlineClass, SectionHeading } from './theme'
import { Figure, RATIO, SlotGallery } from './media'
import {
  days, PLACEHOLDER_VALUES, slotNames, text,
  type ImageIndex,
} from './types'

/**
 * 섹션 컴포넌트 9종 (§9.3) — **고정 React 컴포넌트**.
 *
 * AI는 `page_content` JSON만 만들고 HTML을 생성하지 않는다(§9.1). 이 파일이
 * 그 JSON을 그리는 유일한 경로이며, `data` 키는 §9.3 표가 단일 출처다 —
 * 여기서 키를 늘리거나 이름을 바꾸지 않는다.
 *
 * ## 대비 규칙 (§17.2, 본문 4.5:1)
 *
 * **본문 텍스트에 투명도를 쓰지 않는다.** Tailwind의 `/60` 같은 불투명도는
 * `color-mix`로 배경색을 섞어 실효 대비를 떨어뜨린다 — 어두운 글자를 밝은
 * 배경 위에서 65%로 낮추면 2.5:1까지 내려가 기준 미달이다. 위계는 크기·굵기·
 * 대문자·이탤릭으로만 만든다. 투명도는 테두리·배경 같은 비텍스트에만 쓴다.
 *
 * 예외는 히어로의 흰 글자다 — 어두운 스크림 위라 90%로 낮춰도 12:1 이상이다.
 */

export interface SectionProps {
  data: Record<string, unknown>
  t: ThemeTokens
  idx: ImageIndex
}

/* ── 공용 조각 ───────────────────────────────────────────────── */

/** 본문 폭. 히어로만 이 밖으로 나간다(전면 이미지). */
export function Band({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`mx-auto w-full max-w-3xl px-5 py-8 md:px-8 md:py-10 ${className}`}>
      {children}
    </section>
  )
}

/**
 * 미입력·미운영 표기는 **지우지 않고 그대로 보여준다**(§6.1·§9.3).
 * 색을 흐리는 대신 이탤릭으로 구분해 대비를 유지한다.
 */
function Value({ v }: { v: string }) {
  if (!v) return <span className="italic">-</span>
  if (PLACEHOLDER_VALUES.has(v)) return <span className="italic">{v}</span>
  return <span className="whitespace-pre-line">{v}</span>
}

function Fields({ items }: { items: [string, string][] }) {
  return (
    <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wider">{k}</dt>
          <dd className="mt-1 break-words text-[15px] leading-relaxed"><Value v={v} /></dd>
        </div>
      ))}
    </dl>
  )
}

/* ── 1. hero ─────────────────────────────────────────────────── */

/**
 * 대표 이미지 위에 행사명·여행기간을 얹는다.
 * **미업로드 시에만 테마 그라디언트로 폴백한다**(§9.3) — 다른 섹션은 폴백 없이
 * 이미지 영역만 생략하지만, 히어로는 영역 자체가 화면의 첫 인상이라 비워둘 수 없다.
 */
export function Hero({ data, t, idx }: SectionProps) {
  const headline = text(data, 'headline')
  const subcopy = text(data, 'subcopy')
  const slot = text(data, 'image_slot')
  const image = slot ? idx.bySlot.get(slot)?.[0] : undefined

  return (
    <section className={`relative w-full overflow-hidden ${RATIO.hero}`}>
      {image ? (
        <Image
          src={image.url}
          alt={image.alt}
          fill
          sizes="100vw"
          priority /* LCP 대상 (§17.2) */
          className="object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-[var(--t-primary)] to-[var(--t-secondary)]"
        />
      )}

      {/* 스크림 — 어떤 사진이 와도 흰 글자가 읽히게 한다 */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/10" />

      <div className="absolute inset-x-0 bottom-0">
        <div className="mx-auto max-w-3xl px-5 pb-7 md:px-8 md:pb-10">
          <h1 className={`text-2xl leading-tight text-white md:text-4xl ${headlineClass(t)}`}>
            {headline}
          </h1>
          {subcopy && <p className="mt-2 text-sm text-white/90 md:text-base">{subcopy}</p>}
        </div>
      </div>
    </section>
  )
}

/* ── 2. summary ──────────────────────────────────────────────── */

export function Summary({ data, t }: SectionProps) {
  return (
    <Band>
      <SectionHeading t={t}>여행 개요</SectionHeading>
      <Fields items={[
        ['여행기간', text(data, '여행기간')],
        ['여행지', text(data, '여행지')],
        ['여행주제', text(data, '여행주제')],
        ['타겟층', text(data, '타겟층')],
        ['여행스타일', text(data, '여행스타일')],
      ]} />
    </Band>
  )
}

/* ── 3. itinerary ────────────────────────────────────────────── */

/**
 * 일차별 서술 + 일차 이미지. 일차 이미지는 `days[].image_slot`으로 참조한다 —
 * 이 필드가 없으면 §11.2의 이미지 검증이 대상을 찾을 수 없다(§9.2).
 */
export function Itinerary({ data, t, idx }: SectionProps) {
  const list = days(data)

  return (
    <Band>
      <SectionHeading t={t}>일정</SectionHeading>
      <ol className="mt-5 space-y-6">
        {list.map((d) => {
          const image = d.image_slot ? idx.bySlot.get(d.image_slot)?.[0] : undefined
          return (
            <li key={d.day} className="grid gap-4 md:grid-cols-[1fr_15rem] md:items-start">
              <div className="min-w-0">
                <span className="inline-block rounded-full bg-[var(--t-secondary)] px-3 py-0.5
                                 text-xs font-semibold text-[var(--t-text)]">
                  {d.day}일차
                </span>
                <p className="mt-2 break-words text-[15px] leading-relaxed">{d.text}</p>
              </div>
              {/* 슬롯이 비면 이미지 열만 사라진다 — 일차 자체는 남는다(§9.3) */}
              {image && (
                <Figure image={image} ratio="wide" sizes="(min-width: 768px) 240px, 100vw" />
              )}
            </li>
          )
        })}
      </ol>
    </Band>
  )
}

/* ── 4. accommodation ────────────────────────────────────────── */

export function Accommodation({ data, t, idx }: SectionProps) {
  const images = slotNames(data).flatMap((s) => idx.bySlot.get(s) ?? [])

  return (
    <Band>
      <SectionHeading t={t}>숙박</SectionHeading>
      <Fields items={[
        ['숙소명', text(data, '숙소명')],
        ['객실타입', text(data, '객실타입')],
        ['위치', text(data, '위치')],
        ['숙박일정', text(data, '숙박일정')],
      ]} />
      <SlotGallery images={images} className="mt-6" />
    </Band>
  )
}

/* ── 5. flight ───────────────────────────────────────────────── */

/**
 * 5개 값을 한 줄 표로 보여준다. 375px에서는 열이 좁아지므로
 * **자체 `overflow-x-auto` 컨테이너 안에서만** 가로 스크롤한다 —
 * 페이지 본문에는 가로 스크롤이 생기지 않는다(§17.1).
 */
export function Flight({ data, t }: SectionProps) {
  const cols: [string, string][] = [
    ['공항', text(data, '공항')],
    ['항공사', text(data, '항공사')],
    ['편명', text(data, '편명')],
    ['출발시간', text(data, '출발시간')],
    ['도착시간', text(data, '도착시간')],
  ]

  return (
    <Band>
      <SectionHeading t={t}>항공</SectionHeading>
      <div className="mt-5 -mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
        <table className="w-full min-w-[34rem] border-collapse text-left text-[15px]">
          <thead>
            <tr className="border-b-2 border-[var(--t-primary)]">
              {cols.map(([k]) => (
                <th key={k} scope="col" className="py-2 pr-4 text-xs font-semibold uppercase tracking-wider">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {cols.map(([k, v]) => (
                <td key={k} className="py-3 pr-4 align-top"><Value v={v} /></td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Band>
  )
}

/* ── 6. meal ─────────────────────────────────────────────────── */

export function Meal({ data, t }: SectionProps) {
  return (
    <Band>
      <SectionHeading t={t}>식사</SectionHeading>
      <p className="mt-5 break-words text-[15px] leading-relaxed">
        <Value v={text(data, '식사정보')} />
      </p>
    </Band>
  )
}

/* ── 7. price ────────────────────────────────────────────────── */

/**
 * 성인·아동은 카드로, 기타는 주석으로 놓는다.
 * **총액을 계산하지 않는다** — 인원수 × 가격 표기는 금지다(§13.3). 여기서는
 * 인원수 자체가 없지만, 같은 원칙으로 입력된 값만 그대로 옮긴다.
 */
export function Price({ data, t }: SectionProps) {
  const etc = text(data, '기타')

  return (
    <Band>
      <SectionHeading t={t}>가격</SectionHeading>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {([['성인', text(data, '성인')], ['아동', text(data, '아동')]] as [string, string][])
          .map(([k, v]) => (
            <div key={k} className="rounded-xl border border-[var(--t-primary)]/25 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider">{k}</p>
              <p className="mt-1 break-words text-lg font-semibold"><Value v={v} /></p>
            </div>
          ))}
      </div>
      {etc && (
        <p className="mt-4 break-words text-sm leading-relaxed"><Value v={etc} /></p>
      )}
    </Band>
  )
}

/* ── 8. shop ─────────────────────────────────────────────────── */

export function Shop({ data, t, idx }: SectionProps) {
  const images = slotNames(data).flatMap((s) => idx.bySlot.get(s) ?? [])

  return (
    <Band>
      <SectionHeading t={t}>제휴상점</SectionHeading>
      <Fields items={[
        ['상점명', text(data, '상점명')],
        ['상점정보', text(data, '상점정보')],
      ]} />
      <SlotGallery images={images} className="mt-6" />
    </Band>
  )
}

/* ── 9. apply ────────────────────────────────────────────────── */

/**
 * 신청 섹션. `data`에는 문구와 요약값만 있고 **폼 필드 구성은 없다** —
 * 이름·이메일·연락처·인원수·동의 5개는 고정 계약이라 편집기에서 바꿀 수 없고,
 * `data`가 아니라 고정 컴포넌트가 렌더링한다(§9.3·§13.1).
 *
 * 그 폼 자체는 `form` prop으로 주입한다. 공개 페이지는 실제 신청 폼을,
 * 편집기 미리보기는 비활성 안내를 넣는다 — 미리보기에서 제출되면 안 되기 때문이다.
 */
export function Apply({ data, t, form }: SectionProps & { form?: ReactNode }) {
  const 가격요약 = (data.가격요약 ?? {}) as Record<string, unknown>
  const 행사정보요약 = (data.행사정보요약 ?? {}) as Record<string, unknown>

  return (
    <Band className="border-t border-[var(--t-primary)]/20">
      <SectionHeading t={t}>{text(data, '제목') || '신청'}</SectionHeading>

      <p className="mt-4 break-words text-[15px] leading-relaxed">
        <Value v={text(data, '안내문구')} />
      </p>

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
