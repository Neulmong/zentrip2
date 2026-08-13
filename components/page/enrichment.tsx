import type { Enrichment, EnrichmentPlace } from '@/lib/pipeline/enrichment'
import type { BlockStyle, Tone } from '@/lib/pipeline/vocabulary'
import { Band, headlineClass, type RenderTheme } from './theme'

/**
 * place-enrichment 렌더 (매거진 재설계) — **이 길 위의 가게들**.
 *
 * 그라운딩 웹 검색으로 얻은 실제 장소 이야기를 편집물처럼 싣는다. 앞 두 곳은
 * 대형 피처, 나머지는 그리드. 각 항목에 **인용 출처 링크**를 붙여 값이 실제
 * 출처에 근거함을 화면이 증명한다(§8.8). `page_content.sections` 밖의 부가
 * 데이터라 `PageRenderer`가 apply 앞에 따로 그린다.
 */

const BAND_STYLE: BlockStyle = {
  layout: 'grid', tone: 'surface', width: 'wide', align: 'left',
  pad: 'loose', edge: 'none', media: 'none',
}

function SourceRow({ place }: { place: EnrichmentPlace }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-[var(--t-primary)]/15 pt-4">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">출처</span>
      {place.출처.map((src, k) => (
        <a
          key={k}
          href={src.uri}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="max-w-full truncate rounded-full bg-[var(--t-primary)]/10 px-2.5 py-0.5 text-[11px] font-medium text-[var(--t-primary)] underline-offset-2 hover:underline"
          title={src.title}
        >
          {src.title}
        </a>
      ))}
    </div>
  )
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {tags.map((tag, k) => (
        <span key={k} className="rounded-full border border-[var(--t-primary)]/30 px-2.5 py-0.5 text-[11px] font-medium">
          {tag}
        </span>
      ))}
    </div>
  )
}

/** 대형 피처 — 이야기 + 테마 그라디언트 패널(사진이 없어 색으로) */
function Feature({ place, t, flip }: { place: EnrichmentPlace; t: RenderTheme; flip: boolean }) {
  return (
    <article className="grid overflow-hidden rounded-lg border border-[var(--t-primary)]/25 bg-[var(--t-surface)] md:grid-cols-2">
      <div
        aria-hidden
        className={`relative min-h-[200px] bg-gradient-to-br from-[var(--t-primary)] to-[var(--t-secondary)] ${flip ? 'md:order-2' : ''}`}
      >
        <span className="absolute bottom-4 left-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
          {place.태그[0] ?? '현지'}
        </span>
      </div>
      <div className="flex flex-col justify-center p-6 md:p-10">
        <p className={`break-keep text-2xl font-bold tracking-tight md:text-3xl ${headlineClass(t)}`}>{place.이름}</p>
        <Tags tags={place.태그} />
        <p className="mt-4 max-w-[34em] break-keep text-[15px] leading-relaxed md:text-base">{place.요약}</p>
        <SourceRow place={place} />
      </div>
    </article>
  )
}

export function EnrichmentSection({
  enrichment, t, nextTone,
}: {
  enrichment: Enrichment
  t: RenderTheme
  nextTone?: Tone
}) {
  const places = enrichment.places ?? []
  if (places.length === 0) return null

  // 앞 최대 2곳은 대형 피처, 나머지는 그리드 (아티팩트 구성)
  const features = places.slice(0, 2)
  const rest = places.slice(2)

  return (
    <Band style={BAND_STYLE} nextTone={nextTone}>
      <div className="max-w-[32em]">
        <p className="font-serif text-[15px] italic text-[var(--t-primary)]">머무는 곳들</p>
        <h2 className={`mt-1.5 break-keep text-3xl font-extrabold tracking-tight md:text-4xl ${headlineClass(t)}`}>
          이 길 위의 가게들
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed opacity-80">
          아래 소개는 각 장소를 실제 웹에서 찾아 정리한 것입니다. 지어낸 후기가 아니라,
          확인된 출처에 근거한 이야기만 싣습니다.
        </p>
      </div>

      <div className="mt-10 space-y-6">
        {features.map((place, i) => (
          <Feature key={`f-${i}-${place.이름}`} place={place} t={t} flip={i % 2 === 1} />
        ))}
      </div>

      {rest.length > 0 && (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((place, i) => (
            <article
              key={`g-${i}-${place.이름}`}
              className="flex flex-col rounded-lg border border-[var(--t-primary)]/25 bg-[var(--t-surface)] p-6 transition duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--t-primary)]/10"
            >
              <p className="break-keep text-lg font-bold tracking-tight">{place.이름}</p>
              <Tags tags={place.태그} />
              <p className="mt-3 flex-1 break-keep text-sm leading-relaxed opacity-90">{place.요약}</p>
              <SourceRow place={place} />
            </article>
          ))}
        </div>
      )}
    </Band>
  )
}
