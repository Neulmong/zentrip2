/**
 * 테마 (spec 2.8 §9.4) — **순수 모듈**.
 *
 * ## 2.7 → 2.8에서 뒤집힌 것
 *
 * 2.7까지 테마는 `여행스타일` select 6종 → 팔레트 7개의 **1:1 룩업**이었다.
 * 그래서 감귤축제 상품이라도 여행스타일이 「자연」이면 초록이 나왔고, 상품별
 * 분위기에 도달할 경로가 코드에 없었다.
 *
 * 2.8은 **AI가 색이 아니라 「색의 의도」(hue + mood)를 쓰고, 기계가 OKLCH로
 * 색을 계산한 뒤 WCAG 대비를 강제한다.** 「AI가 `#RRGGBB`를 쓰지 않는다」는
 * 그대로 지켜지고, 보증이 AI가 아니라 **계산기 쪽에** 남는 것이 이 설계의 핵심이다
 * (명령서 4-②). `npm run verify:a11y`가 hue 360 × mood 6 전수 스윕으로 이를 증명한다.
 *
 * ## 레거시 호환
 *
 * 이미 게시된 상품의 `page_content.theme`은 `"nature"` 같은 **문자열**이다.
 * 렌더러가 문자열과 객체 양쪽을 읽어야 하며, 문자열이면 옛 `THEME_TOKENS`의 hex를
 * 그대로 쓴다 — **게시된 페이지의 색이 바뀌면 안 된다**(명령서 완료조건 8).
 */

/* ════════════════════════════════════════════════════════════════
 * 1. 열거값 — AI가 고르는 스타일 손잡이 (명령서 4-②·4-③)
 *
 * `string`으로 두지 않고 열거로 고정하는 이유: 렌더링 컴포넌트가 1:1로 분기하므로
 * 값이 늘면 컴포넌트가 대응하지 못한 채 컴파일이 통과해 화면에서 조용히
 * 기본값으로 떨어진다. 무효 값은 `resolveThemeSpec`이 폴백으로 잡는다.
 * ════════════════════════════════════════════════════════════════ */

export type Mood = 'vivid' | 'warm' | 'cool' | 'earthy' | 'muted' | 'deep'
export type BackgroundKey = 'plain' | 'wash' | 'glow' | 'bloom' | 'wave' | 'grain'
export type Rhythm = 'even' | 'breathing' | 'airy' | 'dense'
export type Scale = 'compact' | 'balanced' | 'dramatic'

export type HeadlineTone =
  | 'calm-serif' | 'soft-sans' | 'tight-sans' | 'warm-serif'
  | 'bold-sans' | 'classic-serif' | 'neutral-sans'

export type AccentStyle =
  | 'underline-accent' | 'pill-badge' | 'bar-accent'
  | 'dot-accent' | 'block-accent' | 'rule-accent'

export const MOODS: readonly Mood[] = ['vivid', 'warm', 'cool', 'earthy', 'muted', 'deep']
export const BACKGROUNDS: readonly BackgroundKey[] = ['plain', 'wash', 'glow', 'bloom', 'wave', 'grain']
export const RHYTHMS: readonly Rhythm[] = ['even', 'breathing', 'airy', 'dense']
export const SCALES: readonly Scale[] = ['compact', 'balanced', 'dramatic']
export const HEADLINES: readonly HeadlineTone[] = [
  'calm-serif', 'soft-sans', 'tight-sans', 'warm-serif',
  'bold-sans', 'classic-serif', 'neutral-sans',
]
export const ACCENTS: readonly AccentStyle[] = [
  'underline-accent', 'pill-badge', 'bar-accent',
  'dot-accent', 'block-accent', 'rule-accent',
]

/** AI가 만드는 디자인 의도 (COMPOSE_SCHEMA의 `theme`). 색은 없다 — hue·mood만. */
export interface ThemeSpec {
  hue: number
  mood: Mood
  background: BackgroundKey
  headline: HeadlineTone
  accent: AccentStyle
  rhythm: Rhythm
  scale: Scale
  /** 한 문장. 로그·감사용 (예: "감귤축제 · 귤껍질 주황") */
  근거: string
}

/** 계산된 5색. 본문 대비는 `surface`가 아니라 `surfaceDeep`에 대고 잰다(명령서 4-②). */
export interface ThemeColors {
  primary: string
  secondary: string
  surface: string
  surfaceDeep: string
  text: string
}

/**
 * 저장되는 테마(§9.4) — `page_content.theme`. schema_version 2.0의 객체 형태.
 * 색은 **계산이 끝나 대비가 보증된 값**이다. 렌더러는 다시 계산하지 않는다.
 */
export interface ResolvedTheme {
  colors: ThemeColors
  background: BackgroundKey
  headline: HeadlineTone
  accent: AccentStyle
  rhythm: Rhythm
  scale: Scale
  /** 감사용 — AI가 고른 의도 그대로 */
  hue: number
  mood: Mood
  근거: string
  /** 무효라 폴백된 필드 경로. 필드별 폴백이므로 하나가 무효라고 전체를 버리지 않는다 */
  fallbacks: string[]
}

/** 저장 형태: 신규는 객체, 레거시는 문자열 키. 렌더러가 둘 다 읽는다 */
export type PageTheme = ResolvedTheme | ThemeKey | string

export function isResolvedTheme(t: unknown): t is ResolvedTheme {
  return !!t && typeof t === 'object' && 'colors' in (t as object)
}

/* ════════════════════════════════════════════════════════════════
 * 2. 레거시 — 2.7까지의 팔레트 7개 (게시된 페이지의 색을 보존한다)
 * ════════════════════════════════════════════════════════════════ */

export type ThemeKey =
  | 'nature' | 'resort' | 'urban' | 'culinary' | 'active' | 'heritage' | 'default'

interface LegacyTokens {
  colors: { primary: string; secondary: string; surface: string; text: string }
  headline: HeadlineTone
  accent: AccentStyle
}

/** 옛 문자열 테마의 hex. **값을 바꾸지 않는다** — 게시된 페이지가 이것으로 그려진다. */
export const THEME_TOKENS: Record<ThemeKey, LegacyTokens> = {
  nature: {
    colors: { primary: '#2F6B4F', secondary: '#A8C6A1', surface: '#F4F7F2', text: '#1C2B22' },
    headline: 'calm-serif', accent: 'underline-accent',
  },
  resort: {
    colors: { primary: '#0E7490', secondary: '#A5D8E6', surface: '#F2F8FA', text: '#12303A' },
    headline: 'soft-sans', accent: 'pill-badge',
  },
  urban: {
    colors: { primary: '#334155', secondary: '#94A3B8', surface: '#F5F6F8', text: '#171E2B' },
    headline: 'tight-sans', accent: 'bar-accent',
  },
  culinary: {
    colors: { primary: '#9A3412', secondary: '#F0B892', surface: '#FBF5F1', text: '#33180C' },
    headline: 'warm-serif', accent: 'dot-accent',
  },
  active: {
    colors: { primary: '#B45309', secondary: '#FCD9A0', surface: '#FDF8F0', text: '#2E1E06' },
    headline: 'bold-sans', accent: 'block-accent',
  },
  heritage: {
    colors: { primary: '#6D4C41', secondary: '#D7C4B7', surface: '#F8F5F2', text: '#2A1D17' },
    headline: 'classic-serif', accent: 'rule-accent',
  },
  default: {
    colors: { primary: '#171717', secondary: '#A3A3A3', surface: '#FAFAFA', text: '#171717' },
    headline: 'neutral-sans', accent: 'underline-accent',
  },
}

/** 레거시 문자열 → 렌더용 5색. `surfaceDeep`은 옛 값에 없으므로 `surface`를 그대로 쓴다. */
export function legacyColors(key: ThemeKey): ThemeColors {
  const c = (THEME_TOKENS[key] ?? THEME_TOKENS.default).colors
  return { ...c, surfaceDeep: c.surface }
}

/** 여행스타일 → 레거시 키. hue/mood가 아예 없을 때의 무채색 폴백 경로에 쓴다 */
const STYLE_TO_KEY: Record<string, ThemeKey> = {
  '자연': 'nature', '휴양': 'resort', '도심': 'urban',
  '미식': 'culinary', '액티비티': 'active', '문화·역사': 'heritage',
}

/** 여행스타일 → 기본 (hue, mood). AI가 hue/mood를 못 냈을 때의 폴백 시작점(명령서 4-②) */
const STYLE_TO_INTENT: Record<string, { hue: number; mood: Mood }> = {
  '자연': { hue: 145, mood: 'earthy' },
  '휴양': { hue: 200, mood: 'cool' },
  '도심': { hue: 240, mood: 'muted' },
  '미식': { hue: 25, mood: 'warm' },
  '액티비티': { hue: 40, mood: 'vivid' },
  '문화·역사': { hue: 30, mood: 'earthy' },
}

/**
 * 옛 진입점 — 여행스타일 → 레거시 키. **레거시 문자열 테마를 만드는 경로에만** 남긴다
 * (테스트·2.6 호환). 2.8 생성 경로는 `resolveThemeSpec`을 쓴다.
 */
export function resolveTheme(travelStyle: string): ThemeKey {
  return STYLE_TO_KEY[travelStyle.trim()] ?? 'default'
}

/* ════════════════════════════════════════════════════════════════
 * 3. OKLCH → sRGB (색 유도)
 *
 * https://bottosson.github.io/posts/oklab/ 의 표준 행렬. OKLCH를 쓰는 이유는
 * 인지 균등성이다 — 같은 L을 유지하며 hue만 돌리면 밝기 인상이 흔들리지 않아
 * 대비 강제가 예측 가능하다.
 * ════════════════════════════════════════════════════════════════ */

function oklchToRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  const gamma = (u: number) => {
    const c = Math.max(0, Math.min(1, u))
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
  }
  return [
    Math.round(gamma(lr) * 255),
    Math.round(gamma(lg) * 255),
    Math.round(gamma(lb) * 255),
  ]
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/* ── WCAG 2.1 상대 휘도 · 대비 (verify-a11y.mts와 동일 공식) ─────── */

export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export const WHITE = '#FFFFFF'

/** 강제할 대비 4종 (명령서 4-②) */
export const CONTRAST_MIN = {
  text_vs_surfaceDeep: 7, // 본문. §17.2의 4.5:1에 여유를 둔다
  primary_vs_white: 4.5, // tone:invert 띠 + block-accent의 흰 글자
  secondary_vs_text: 4.5, // tone:tint 띠 + pill-badge
  primary_vs_surface: 3, // 제목·강조 (대형 텍스트 기준)
} as const

/* ════════════════════════════════════════════════════════════════
 * 4. mood 프리셋 — 시작 L·C. 최종 대비는 아래 조정 루프가 보증한다
 *
 * mood는 **미감**(얼마나 선명·어두운가)을 준다. 대비는 프리셋이 아니라 루프가
 * 지킨다 — 그래서 어떤 hue가 와도 4종이 만족된다(명령서: 보증이 계산기 쪽에).
 * ════════════════════════════════════════════════════════════════ */

interface Preset {
  pL: number; pC: number // primary
  sL: number; sC: number // secondary
  bgL: number; bgC: number // surface
  dpL: number; dpC: number // surfaceDeep
  tL: number; tC: number // text
}

const MOOD_PRESET: Record<Mood, Preset> = {
  vivid: { pL: 0.58, pC: 0.16, sL: 0.90, sC: 0.09, bgL: 0.985, bgC: 0.010, dpL: 0.955, dpC: 0.020, tL: 0.28, tC: 0.04 },
  warm: { pL: 0.55, pC: 0.14, sL: 0.90, sC: 0.085, bgL: 0.985, bgC: 0.012, dpL: 0.950, dpC: 0.022, tL: 0.27, tC: 0.035 },
  cool: { pL: 0.55, pC: 0.13, sL: 0.91, sC: 0.075, bgL: 0.986, bgC: 0.010, dpL: 0.955, dpC: 0.018, tL: 0.26, tC: 0.030 },
  earthy: { pL: 0.50, pC: 0.08, sL: 0.88, sC: 0.050, bgL: 0.975, bgC: 0.014, dpL: 0.940, dpC: 0.022, tL: 0.26, tC: 0.030 },
  muted: { pL: 0.52, pC: 0.045, sL: 0.90, sC: 0.035, bgL: 0.984, bgC: 0.006, dpL: 0.955, dpC: 0.012, tL: 0.28, tC: 0.020 },
  deep: { pL: 0.42, pC: 0.12, sL: 0.86, sC: 0.070, bgL: 0.970, bgC: 0.012, dpL: 0.930, dpC: 0.030, tL: 0.24, tC: 0.035 },
}

/**
 * L을 한 방향으로 옮겨 조건을 만족시킨다. 극단(0 또는 1)에서는 대비 조건이 항상
 * 성립하므로(검정 vs 밝은 배경, 흰색 vs 어두운 글자) 루프는 반드시 수렴한다 —
 * 이것이 「어떤 입력에도 실패하지 않는다」의 근거다.
 */
function adjustL(
  startL: number, C: number, hue: number,
  ok: (hex: string) => boolean, dir: -1 | 1,
): string {
  let L = startL
  for (let i = 0; i < 200; i++) {
    const hex = toHex(oklchToRgb(L, C, hue))
    if (ok(hex)) return hex
    L += dir * 0.005
    if (L <= 0) return toHex(oklchToRgb(0, C, hue))
    if (L >= 1) return toHex(oklchToRgb(1, C, hue))
  }
  return toHex(oklchToRgb(L, C, hue))
}

/**
 * hue + mood → 대비가 보증된 5색.
 *
 * 순서가 의존성이다: surface·surfaceDeep(고정 기준) → text(surfaceDeep 대비) →
 * primary(흰색·surface 대비) → secondary(최종 text 대비).
 */
export function deriveColors(hue: number, mood: Mood): ThemeColors {
  const p = MOOD_PRESET[mood]

  const surface = toHex(oklchToRgb(p.bgL, p.bgC, hue))
  const surfaceDeep = toHex(oklchToRgb(p.dpL, p.dpC, hue))

  const text = adjustL(p.tL, p.tC, hue,
    (hex) => contrast(hex, surfaceDeep) >= CONTRAST_MIN.text_vs_surfaceDeep, -1)

  const primary = adjustL(p.pL, p.pC, hue,
    (hex) => contrast(hex, WHITE) >= CONTRAST_MIN.primary_vs_white
      && contrast(hex, surface) >= CONTRAST_MIN.primary_vs_surface, -1)

  const secondary = adjustL(p.sL, p.sC, hue,
    (hex) => contrast(hex, text) >= CONTRAST_MIN.secondary_vs_text, +1)

  return { primary, secondary, surface, surfaceDeep, text }
}

/* ════════════════════════════════════════════════════════════════
 * 5. 스펙 검증 + 폴백 — 스킬 `theme-design-token-match` (AI 뒤로 이동)
 *
 * AI가 고른 스펙을 검증하고 **무효 필드만** 폴백한다. 필드별 폴백이므로 하나가
 * 무효라고 전체를 버리지 않는다(명령서 4-②). 무엇이 폴백됐는지 목록으로 남긴다.
 * ════════════════════════════════════════════════════════════════ */

function inSet<T>(v: unknown, set: readonly T[]): v is T {
  return set.includes(v as T)
}

const DEFAULTS = {
  background: 'plain' as BackgroundKey,
  headline: 'neutral-sans' as HeadlineTone,
  accent: 'underline-accent' as AccentStyle,
  rhythm: 'even' as Rhythm,
  scale: 'balanced' as Scale,
}

/**
 * AI의 `ThemeSpec`(일부 무효일 수 있음) + 여행스타일 → 저장할 `ResolvedTheme`.
 *
 * hue/mood가 무효면 여행스타일 매핑으로, 그것도 없으면 무채색(hue 0 · mood muted)으로
 * 필드별 폴백한다. 색은 언제나 계산되고 대비 4종이 보증된다.
 */
/** AI가 낸 원시 스펙 — 전 필드가 무효(문자열·범위 밖)일 수 있다 */
export interface RawThemeSpec {
  hue?: number; mood?: string; background?: string; headline?: string
  accent?: string; rhythm?: string; scale?: string; 근거?: string
}

export function resolveThemeSpec(raw: RawThemeSpec | null | undefined, travelStyle: string): ResolvedTheme {
  const fallbacks: string[] = []
  const style = travelStyle?.trim() ?? ''
  const intent = STYLE_TO_INTENT[style] ?? { hue: 0, mood: 'muted' as Mood }

  let hue: number
  if (typeof raw?.hue === 'number' && Number.isFinite(raw.hue)) {
    hue = ((Math.round(raw.hue) % 360) + 360) % 360
  } else {
    hue = intent.hue; fallbacks.push('theme.hue')
  }

  let mood: Mood
  if (inSet(raw?.mood, MOODS)) mood = raw.mood
  else { mood = intent.mood; fallbacks.push('theme.mood') }

  const pick = <T>(v: unknown, set: readonly T[], def: T, path: string): T => {
    if (inSet(v, set)) return v
    fallbacks.push(path)
    return def
  }

  const background = pick(raw?.background, BACKGROUNDS, DEFAULTS.background, 'theme.background')
  const headline = pick(raw?.headline, HEADLINES, DEFAULTS.headline, 'theme.headline')
  const accent = pick(raw?.accent, ACCENTS, DEFAULTS.accent, 'theme.accent')
  const rhythm = pick(raw?.rhythm, RHYTHMS, DEFAULTS.rhythm, 'theme.rhythm')
  const scale = pick(raw?.scale, SCALES, DEFAULTS.scale, 'theme.scale')

  const 근거 = typeof raw?.근거 === 'string' ? raw.근거.trim() : ''

  return {
    colors: deriveColors(hue, mood),
    background, headline, accent, rhythm, scale,
    hue, mood, 근거, fallbacks,
  }
}
