import type { Enrichment } from '@/lib/pipeline/enrichment'
import type { BlockStyle, Tone } from '@/lib/pipeline/vocabulary'
import { Band, SectionHeading, type RenderTheme } from './theme'

/**
 * place-enrichment 렌더 (Task 2) — **출처 표기가 핵심이다**.
 *
 * 그라운딩 웹 검색으로 얻은 실제 장소 정보를 카드로 그리고, 각 카드에 **인용
 * 출처 링크**를 붙인다. 값이 실제 출처에 근거함을 화면이 증명한다(§8.8 · 사용자
 * 요구 — 가짜가 아니라 진짜 리뷰를 출처와 함께). `page_content.sections` 밖의
 * 부가 데이터라 `PageRenderer`가 apply 앞에 따로 그린다.
 */

const CARD_STYLE: BlockStyle = {
  layout: 'grid', tone: 'surface', width: 'normal', align: 'left',
  pad: 'normal', edge: 'none', media: 'none',
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

  return (
    <Band style={CARD_STYLE} nextTone={nextTone}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading t={t}>현지 정보</SectionHeading>
        <span className="shrink-0 rounded-full bg-[var(--t-secondary)]/40 px-2.5 py-0.5 text-[11px] font-medium">
          {enrichment.생성_라벨}
        </span>
      </div>

      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {places.map((place, i) => (
          <li
            key={`${i}-${place.이름}`}
            className="min-w-0 rounded-xl border border-[var(--t-primary)]/50 bg-[var(--t-surface)]/50 p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="break-words text-[15px] font-semibold leading-snug">{place.이름}</p>

            {place.태그.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {place.태그.map((tag, k) => (
                  <span
                    key={k}
                    className="rounded-full bg-[var(--t-secondary)]/40 px-2 py-0.5 text-[11px] font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <p className="mt-3 break-words text-sm leading-relaxed">{place.요약}</p>

            {/* 출처 표기 — 실제 검색 근거. 링크는 새 탭, 크롤 힌트 없음 */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--t-primary)]/15 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80">출처</span>
              {place.출처.map((src, k) => (
                <a
                  key={k}
                  href={src.uri}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="max-w-full truncate rounded bg-[var(--t-primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--t-primary)] underline-offset-2 hover:underline"
                  title={src.title}
                >
                  {src.title}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Band>
  )
}
