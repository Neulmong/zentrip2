import type { CSSProperties, ReactNode } from 'react'
import { THEME_TOKENS, type ThemeKey, type ThemeTokens } from '@/lib/pipeline/theme'

/**
 * 테마 토큰 → 화면 (§9.4) — **순수 모듈**.
 *
 * 적용 범위는 **컬러 스킴 · 헤드라인 톤 · 강조 포인트 3가지뿐이다.**
 * 테마가 섹션 구성·문구·사실정보를 바꾸지 않는다.
 *
 * ## 구현 결정 — 왜 CSS 변수인가
 *
 * 토큰 값은 런타임에 `page_content.theme`으로 정해지는데, Tailwind는 빌드
 * 시점에 클래스를 수집하므로 `bg-${primary}` 같은 동적 클래스를 만들 수 없다.
 * 최상위에서 CSS 변수 4개를 주입하고 각 컴포넌트는 `bg-[var(--t-primary)]`로
 * 참조한다 — 클래스 문자열이 정적이라 수집되고, 값만 테마별로 갈린다.
 */

export function tokensOf(theme: ThemeKey): ThemeTokens {
  return THEME_TOKENS[theme] ?? THEME_TOKENS.default
}

export function themeVars(theme: ThemeKey): CSSProperties {
  const c = tokensOf(theme).colors
  return {
    '--t-primary': c.primary,
    '--t-secondary': c.secondary,
    '--t-surface': c.surface,
    '--t-text': c.text,
  } as CSSProperties
}

/**
 * 헤드라인 톤 7종. 자간·굵기·세리프 여부만 바꾼다 — 크기는 컴포넌트가 정한다.
 * 본문 서체에는 적용하지 않는다(가독성 기준은 §17.2가 단일 출처다).
 */
const HEADLINE_CLASS: Record<ThemeTokens['headline'], string> = {
  'calm-serif': 'font-serif font-medium tracking-tight',
  'soft-sans': 'font-sans font-medium tracking-normal',
  'tight-sans': 'font-sans font-semibold tracking-tighter',
  'warm-serif': 'font-serif font-semibold tracking-normal',
  'bold-sans': 'font-sans font-bold tracking-tight',
  'classic-serif': 'font-serif font-normal tracking-wide',
  'neutral-sans': 'font-sans font-semibold tracking-tight',
}

export function headlineClass(t: ThemeTokens): string {
  return HEADLINE_CLASS[t.headline] ?? HEADLINE_CLASS['neutral-sans']
}

/**
 * 섹션 제목 + 강조 포인트 6종.
 *
 * 대비 검토(§17.2, 4.5:1) — 강조가 배경을 칠하는 변형은 2개뿐이다.
 *   `block-accent` : primary 배경 + 흰 글자. primary 6색 전부 흰색 대비 4.8:1 이상
 *   `pill-badge`   : secondary 배경 + `--t-text` 글자. secondary는 전부 밝은 값이고
 *                    text는 전부 어두운 값이라 9:1 이상
 * 나머지 4개는 선·점으로만 강조하므로 본문 대비에 영향을 주지 않는다.
 */
export function SectionHeading({ t, children }: { t: ThemeTokens; children: ReactNode }) {
  const base = `text-lg md:text-xl ${headlineClass(t)}`

  switch (t.accent) {
    case 'underline-accent':
      return (
        <h2 className={`${base} inline-block border-b-2 border-[var(--t-primary)] pb-1`}>
          {children}
        </h2>
      )
    case 'pill-badge':
      return (
        <h2 className={`${base} inline-block rounded-full bg-[var(--t-secondary)]
                        px-4 py-1 text-[var(--t-text)]`}>
          {children}
        </h2>
      )
    case 'bar-accent':
      return (
        <h2 className={`${base} border-l-4 border-[var(--t-primary)] pl-3`}>{children}</h2>
      )
    case 'dot-accent':
      return (
        <h2 className={`${base} flex items-center gap-2`}>
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--t-primary)]" />
          {children}
        </h2>
      )
    case 'block-accent':
      return (
        <h2 className={`${base} inline-block bg-[var(--t-primary)] px-3 py-1 text-white`}>
          {children}
        </h2>
      )
    case 'rule-accent':
    default:
      return (
        <div>
          <h2 className={base}>{children}</h2>
          <hr className="mt-2 border-t-2 border-[var(--t-primary)]" />
        </div>
      )
  }
}
