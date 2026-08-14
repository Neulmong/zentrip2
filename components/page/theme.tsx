import type { CSSProperties, ReactNode } from 'react'
import {
  legacyColors, THEME_TOKENS,
  type BackgroundKey, type HeadlineTone, type AccentStyle,
  type Rhythm, type Scale, type ThemeColors, type ThemeKey, type PageTheme,
  isResolvedTheme,
} from '@/lib/pipeline/theme'
import type { BlockStyle, Tone } from '@/lib/pipeline/vocabulary'

/**
 * 테마 → 화면 (spec 2.8 §9.4) — **순수 모듈**.
 *
 * ## 2.8에서 넓어진 것 (명령서 4-②·4-③)
 *
 * 2.7은 컬러 스킴·헤드라인·강조 3가지뿐이었다. 2.8은 **배경 레이어 · 블록별
 * 스타일 손잡이(tone·width·pad·align·edge·media) · 리듬 · 스케일**까지 화면이
 * 읽는다. 색은 5종(`surfaceDeep` 추가)이며 전부 CSS 변수로 주입한다.
 *
 * ## 레거시 호환
 *
 * `page_content.theme`이 문자열(`"nature"`)이면 옛 `THEME_TOKENS` hex를 그대로
 * 쓴다 — 게시된 페이지의 색이 바뀌면 안 된다(명령서 완료조건 8). `surfaceDeep`은
 * 옛 값에 없으므로 `surface`를 그대로 쓴다(배경 레이어가 `plain`으로 떨어진다).
 */

/** 렌더링이 읽는 테마 번들. 객체·문자열 어느 저장 형태에서도 이걸로 정규화한다. */
export interface RenderTheme {
  colors: ThemeColors
  headline: HeadlineTone
  accent: AccentStyle
  background: BackgroundKey
  rhythm: Rhythm
  scale: Scale
}

export function renderTheme(theme: PageTheme): RenderTheme {
  if (isResolvedTheme(theme)) {
    return {
      colors: theme.colors, headline: theme.headline, accent: theme.accent,
      background: theme.background, rhythm: theme.rhythm, scale: theme.scale,
    }
  }
  // 레거시 문자열
  const key = (typeof theme === 'string' && theme in THEME_TOKENS ? theme : 'default') as ThemeKey
  const tok = THEME_TOKENS[key]
  return {
    colors: legacyColors(key), headline: tok.headline, accent: tok.accent,
    background: 'plain', rhythm: 'even', scale: 'balanced',
  }
}

export function themeVars(theme: PageTheme): CSSProperties {
  const c = renderTheme(theme).colors
  return {
    '--t-primary': c.primary,
    '--t-secondary': c.secondary,
    '--t-surface': c.surface,
    '--t-surface-deep': c.surfaceDeep,
    '--t-text': c.text,
  } as CSSProperties
}

/* ════════════════════════════════════════════════════════════════
 * 배경 레이어 — `background` 6종 (명령서 4-②·4-③)
 *
 * surface → surfaceDeep 사이만 쓴다. `surfaceDeep`이 배경의 **가장 어두운 지점**
 * 이고, 본문 대비를 surface가 아니라 surfaceDeep에 대고 잰 이유가 이것이다 —
 * 배경 표현이 붙어도 보증이 유지된다(명령서 4-②).
 * ════════════════════════════════════════════════════════════════ */

export function Background({ background }: { background: BackgroundKey }) {
  const base = 'pointer-events-none fixed inset-0 -z-10'
  switch (background) {
    case 'wash':
      return <div aria-hidden className={`${base} bg-gradient-to-b from-[var(--t-surface)] to-[var(--t-surface-deep)]`} />
    case 'glow':
      return (
        <div aria-hidden className={`${base} bg-[var(--t-surface)]`}>
          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-[var(--t-secondary)]/30 to-transparent" />
        </div>
      )
    case 'bloom':
      return (
        <div aria-hidden className={`${base} bg-[var(--t-surface)]`}>
          <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[var(--t-secondary)]/25 blur-3xl" />
          <div className="absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-[var(--t-primary)]/10 blur-3xl" />
        </div>
      )
    case 'wave':
      return (
        <div aria-hidden className={`${base} bg-[var(--t-surface)]`}>
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[var(--t-surface-deep)] via-[var(--t-surface)] to-transparent" />
        </div>
      )
    case 'grain':
      return (
        <div aria-hidden className={`${base} bg-[var(--t-surface)]`}
          style={{ backgroundImage: 'repeating-linear-gradient(45deg, var(--t-surface-deep) 0, var(--t-surface-deep) 1px, transparent 1px, transparent 6px)', opacity: 0.4 }} />
      )
    case 'plain':
    default:
      return <div aria-hidden className={`${base} bg-[var(--t-surface)]`} />
  }
}

/* ════════════════════════════════════════════════════════════════
 * Band — 공용 래퍼 (명령서 4-③)
 *
 * **대부분의 시각적 변화가 여기서 나온다.** tone·width·pad·align·edge를 래퍼
 * 하나가 전부 처리하므로 타입별 컴포넌트에 다양성을 흩뿌리지 않는다 — 그래야
 * 새 블록을 추가할 때 비용이 커지지 않는다.
 * ════════════════════════════════════════════════════════════════ */

// 데스크톱에서 「폰을 옆으로 늘린」 좁은 느낌이 나지 않도록 한 단계씩 넓혔다.
// 문단 텍스트는 각 섹션 안에서 자체 max-w(2xl·3xl)로 가독 폭을 지키므로, 여기서
// 밴드를 넓혀도 글줄이 길어지지 않고 카드·그리드·카루셀만 폭을 활용한다.
const WIDTH_CLASS = {
  narrow: 'max-w-2xl', normal: 'max-w-5xl', wide: 'max-w-7xl', full: 'max-w-none',
} as const

const PAD_CLASS = {
  tight: 'py-8 md:py-12', normal: 'py-14 md:py-20', loose: 'py-24 md:py-32',
} as const

/**
 * tone → 배경·글자색. **②에서 강제하는 대비 4종이 정확히 이 둘(invert·tint)을 덮는다.**
 * 다른 배경색 조합을 만들지 않는다(명령서 4-③).
 */
function toneClass(tone: Tone): string {
  switch (tone) {
    case 'invert': return 'bg-[var(--t-primary)] text-white'
    case 'tint': return 'bg-[var(--t-secondary)] text-[var(--t-text)]'
    case 'surface': return 'bg-[var(--t-surface)] text-[var(--t-text)]'
    case 'bare': default: return 'text-[var(--t-text)]'
  }
}

/** tone → CSS 색값 (edge 장식이 다음 블록의 tone 색을 칠할 때 쓴다) */
export function toneColorVar(tone: Tone | undefined): string {
  switch (tone) {
    case 'invert': return 'var(--t-primary)'
    case 'tint': return 'var(--t-secondary)'
    default: return 'var(--t-surface)'
  }
}

/**
 * edge 장식 — **컨텐츠 박스를 clip하지 않는다.** clip-path로 잘라내면 좁은 화면에서
 * 글자가 사라진다(명령서 4-③). 대신 **다음 블록의 tone 색으로 칠한 장식 도형**을
 * 띠 아래에 놓는다. `nextTone`은 PageRenderer가 정렬된 목록에서 내려보낸다.
 */
function EdgeShape({ edge, nextTone }: { edge: BlockStyle['edge']; nextTone?: Tone }) {
  if (edge === 'none') return null
  const color = toneColorVar(nextTone)
  if (edge === 'rule') {
    return <div aria-hidden className="absolute inset-x-0 bottom-0 h-px" style={{ background: 'currentColor', opacity: 0.15 }} />
  }
  if (edge === 'diagonal') {
    return <div aria-hidden className="absolute inset-x-0 -bottom-px h-6" style={{ background: color, clipPath: 'polygon(0 100%, 100% 0, 100% 100%)' }} />
  }
  if (edge === 'arc') {
    return <div aria-hidden className="absolute inset-x-0 -bottom-px h-8 rounded-t-[50%]" style={{ background: color }} />
  }
  // curve
  return <div aria-hidden className="absolute inset-x-0 -bottom-px h-6 rounded-t-3xl" style={{ background: color }} />
}

export interface BandProps {
  children: ReactNode
  style?: BlockStyle
  nextTone?: Tone
  /** 히어로처럼 폭 제약 밖으로 나가는 경우 */
  bleed?: boolean
  className?: string
}

export function Band({ children, style, nextTone, bleed, className = '' }: BandProps) {
  const s = style
  const tone = s?.tone ?? 'surface'
  const width = s?.width ?? 'normal'
  const pad = s?.pad ?? 'normal'
  const align = s?.align ?? 'left'
  const edge = s?.edge ?? 'none'

  const inner = `mx-auto w-full ${WIDTH_CLASS[width]} px-5 md:px-8 ${align === 'center' ? 'text-center' : ''}`

  return (
    <section className={`zt-reveal relative w-full ${toneClass(tone)} ${PAD_CLASS[pad]} ${className}`}>
      <div className={bleed ? 'w-full' : inner}>{children}</div>
      <EdgeShape edge={edge} nextTone={nextTone} />
    </section>
  )
}

/* ════════════════════════════════════════════════════════════════
 * 헤드라인 톤 7종 + 강조 6종 (2.7과 동일 — 렌더 로직 변경 0)
 * ════════════════════════════════════════════════════════════════ */

const HEADLINE_CLASS: Record<HeadlineTone, string> = {
  'calm-serif': 'font-serif font-medium tracking-tight',
  'soft-sans': 'font-sans font-medium tracking-normal',
  'tight-sans': 'font-sans font-semibold tracking-tighter',
  'warm-serif': 'font-serif font-semibold tracking-normal',
  'bold-sans': 'font-sans font-bold tracking-tight',
  'classic-serif': 'font-serif font-normal tracking-wide',
  'neutral-sans': 'font-sans font-semibold tracking-tight',
}

export function headlineClass(t: { headline: HeadlineTone }): string {
  return HEADLINE_CLASS[t.headline] ?? HEADLINE_CLASS['neutral-sans']
}

/** scale → 제목 크기 (명령서 4-② `scale`) */
function headingSize(scale: Scale): string {
  switch (scale) {
    case 'compact': return 'text-xl md:text-2xl'
    case 'dramatic': return 'text-3xl md:text-5xl'
    case 'balanced': default: return 'text-2xl md:text-4xl'
  }
}

export function SectionHeading(
  { t, children }: { t: RenderTheme; children: ReactNode },
) {
  const base = `${headingSize(t.scale)} ${headlineClass(t)}`

  switch (t.accent) {
    case 'underline-accent':
      return <h2 className={`${base} inline-block border-b-2 border-[var(--t-primary)] pb-1`}>{children}</h2>
    case 'pill-badge':
      return <h2 className={`${base} inline-block rounded-full bg-[var(--t-secondary)] px-4 py-1 text-[var(--t-text)]`}>{children}</h2>
    case 'bar-accent':
      return <h2 className={`${base} border-l-4 border-[var(--t-primary)] pl-3`}>{children}</h2>
    case 'dot-accent':
      return (
        <h2 className={`${base} flex items-center gap-2`}>
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--t-primary)]" />
          {children}
        </h2>
      )
    case 'block-accent':
      return <h2 className={`${base} inline-block bg-[var(--t-primary)] px-3 py-1 text-white`}>{children}</h2>
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
