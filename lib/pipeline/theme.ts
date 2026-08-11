/**
 * 테마 (§9.4) — **순수 모듈**.
 *
 * 적용 범위는 **컬러 스킴 · 헤드라인 톤 · 강조 포인트 3가지로 한정**한다.
 * 테마가 섹션 구성·문구·사실정보를 바꾸지 않으며, 편집기에서 변경할 수 없다.
 * `page_content.theme`에만 보관한다 — `products`에 별도 컬럼을 두지 않는다(§5.1).
 */

export type ThemeKey =
  | 'nature' | 'resort' | 'urban' | 'culinary' | 'active' | 'heritage' | 'default'

/** 여행스타일 select 표시 문자열 → 테마 키. 1:1 대응(§9.4). */
const STYLE_TO_THEME: Record<string, ThemeKey> = {
  '자연': 'nature',
  '휴양': 'resort',
  '도심': 'urban',
  '미식': 'culinary',
  '액티비티': 'active',
  '문화·역사': 'heritage',
}

/**
 * 표에 없는 값·미입력·`추후 추가 예정`이면 `default`로 폴백한다.
 * **실패로 처리하지 않는다**(§9.4).
 */
export function resolveTheme(travelStyle: string): ThemeKey {
  return STYLE_TO_THEME[travelStyle.trim()] ?? 'default'
}

/**
 * 헤드라인 톤·강조 포인트는 렌더링 컴포넌트가 1:1로 분기하므로(§9.4) 열거값으로
 * 고정한다. `string`으로 두면 토큰을 추가했을 때 컴포넌트가 대응하지 않아도
 * 컴파일이 통과해, 화면에서 조용히 기본값으로 떨어진다.
 */
export type HeadlineTone =
  | 'calm-serif' | 'soft-sans' | 'tight-sans' | 'warm-serif'
  | 'bold-sans' | 'classic-serif' | 'neutral-sans'

export type AccentStyle =
  | 'underline-accent' | 'pill-badge' | 'bar-accent'
  | 'dot-accent' | 'block-accent' | 'rule-accent'

export interface ThemeTokens {
  colors: { primary: string; secondary: string; surface: string; text: string }
  headline: HeadlineTone
  accent: AccentStyle
}

/**
 * 디자인 토큰 3종. 본문 대비는 4.5:1 이상을 만족해야 한다(§17.2) —
 * `text`는 전부 `surface` 대비 충분히 어두운 값으로 골랐다.
 */
export const THEME_TOKENS: Record<ThemeKey, ThemeTokens> = {
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
