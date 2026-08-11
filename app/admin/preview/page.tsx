import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageRenderer } from '@/components/page/PageRenderer'
import { FIXTURE_PAGE } from '@/components/page/fixture'
import type { ThemeKey } from '@/lib/pipeline/theme'

/**
 * **개발 전용** 렌더링 검증 하네스 (§17.1).
 *
 * §17.1은 「9종 섹션 컴포넌트 + 삽입 블록 3종을 개발 단계에서 375/768/1280px에
 * 대해 1회 검증하고 결과를 문서화한다」를 요구한다. 실제 상품으로는 12종을 한
 * 화면에 모을 수 없고(삽입 블록은 편집기를 거쳐야 생긴다), 테마 7종을 번갈아
 * 보려면 상품을 7개 만들어야 한다. 그래서 고정 데이터로 검증한다.
 *
 * **프로덕션에서는 404다.** spec의 라우트 표(§14.1)에 없는 경로이므로 배포본에
 * 남겨두지 않는다. 인증 게이트(§14.2) 안쪽이기도 해서 이중으로 막힌다.
 *
 * 브레이크포인트는 **뷰포트** 기준이라 고정 폭 div로는 재현되지 않는다.
 * 실제 폭을 가진 iframe 3개로 띄우는 이유가 그것이다.
 */

const VIEWPORTS = [375, 768, 1280] as const

const THEMES: ThemeKey[] = [
  'nature', 'resort', 'urban', 'culinary', 'active', 'heritage', 'default',
]

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ raw?: string; theme?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()

  const { raw, theme } = await searchParams
  const key = (THEMES as string[]).includes(theme ?? '') ? (theme as ThemeKey) : 'nature'
  const content = { ...FIXTURE_PAGE, theme: key }

  /* iframe 안쪽 — 페이지만 그린다 */
  if (raw) {
    return (
      <PageRenderer
        content={content}
        images={[]}
        applyForm={
          <p className="rounded-xl border border-dashed border-[var(--t-primary)] px-4 py-6 text-center text-sm">
            신청 폼 자리 — 고정 컴포넌트가 렌더링한다 (§13.1)
          </p>
        }
      />
    )
  }

  return (
    <main className="px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">렌더링 검증 (개발 전용)</h1>
        <p className="mt-1 text-sm text-neutral-500">
          섹션 9종 + 삽입 블록 3종 · 375 / 768 / 1280px · §17.1
        </p>

        <nav className="mt-4 flex flex-wrap gap-2">
          {THEMES.map((k) => (
            <Link
              key={k}
              href={`/admin/preview?theme=${k}`}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                k === key
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              {k}
            </Link>
          ))}
        </nav>
      </header>

      {/* 가로 스크롤은 이 컨테이너 안에서만 일어난다 (§17.1) */}
      <div className="flex gap-6 overflow-x-auto pb-4">
        {VIEWPORTS.map((w) => (
          <figure key={w} className="shrink-0">
            <figcaption className="mb-2 flex items-baseline justify-between text-xs text-neutral-500">
              <span className="font-medium text-neutral-800">{w}px</span>
              <a
                href={`/admin/preview?raw=1&theme=${key}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                새 창
              </a>
            </figcaption>
            <iframe
              src={`/admin/preview?raw=1&theme=${key}`}
              title={`상품 페이지 미리보기 ${w}px`}
              width={w}
              height={900}
              className="rounded-xl border border-neutral-300 bg-white"
            />
          </figure>
        ))}
      </div>
    </main>
  )
}
