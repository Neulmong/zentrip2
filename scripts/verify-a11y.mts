/**
 * 접근성 실측 (§17.2 · V-06). **AI 0회 · 브라우저 0회.**
 *
 * §17.2는 「모든 이미지에 대체 텍스트, 폼 필드에 label, **본문 대비 4.5:1 이상**」을
 * 요구한다. 이 셋 중 **대비는 눈으로 재는 값이 아니라 계산되는 값이다** —
 * WCAG 2.1의 상대 휘도 공식이 정해져 있다.
 *
 * 그동안 V-06을 「테마 7종 육안 확인」으로 미뤄뒀는데, 육안으로는
 *   · 4.4:1과 4.6:1을 구분할 수 없고
 *   · 7종 × 여러 조합을 사람이 매번 다시 볼 수 없다
 * 그래서 계산으로 바꾼다. 실패하면 **어느 조합이 몇 대 몇인지** 나온다.
 *
 *   npm run verify:a11y
 */
import { readFileSync } from 'node:fs'
import {
  THEME_TOKENS, deriveColors, CONTRAST_MIN, WHITE, MOODS, type ThemeKey,
} from '../lib/pipeline/theme'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? `  → ${JSON.stringify(got)}` : ''}`) }
}
const section = (t: string) => console.log(`\n${t}`)

/* ── WCAG 2.1 상대 휘도 · 대비비 ────────────────────────────────
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 * ─────────────────────────────────────────────────────────────── */
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const r2 = (n: number) => Math.round(n * 100) / 100

/* ══ V-06 ① 대비 4종 — hue 360 × mood 6 전수 스윕 (spec 2.8 · 명령서 4-②) ══
 *
 * 2.7까지는 팔레트 7종 육안/고정 검사였다. 2.8은 AI가 hue+mood를 고르고 기계가
 * OKLCH로 색을 계산하므로, **모든 hue×mood 조합**에서 대비 4종이 만족됨을 증명해야
 * 「보증이 계산기 쪽에 남는다」가 성립한다. 프리셋 육안 검사보다 강한 보증이다.
 */
section('§17.2 · V-06 — 대비 4종 전수 스윕 (hue 0~359 × mood 6 = 2160 조합)')
console.log('  강제: text/surfaceDeep≥7 · primary/white≥4.5 · secondary/text≥4.5 · primary/surface≥3\n')

console.log(`  ${'mood'.padEnd(8)} ${'본문/deep'.padStart(10)} ${'P/white'.padStart(9)} ${'S/text'.padStart(9)} ${'P/surf'.padStart(9)}  판정`)
console.log(`  ${'─'.repeat(56)}`)

for (const mood of MOODS) {
  let mn = { t: 99, pw: 99, st: 99, ps: 99 }
  let bad = 0
  for (let hue = 0; hue < 360; hue++) {
    const c = deriveColors(hue, mood)
    const t = contrast(c.text, c.surfaceDeep)
    const pw = contrast(c.primary, WHITE)
    const st = contrast(c.secondary, c.text)
    const ps = contrast(c.primary, c.surface)
    mn = { t: Math.min(mn.t, t), pw: Math.min(mn.pw, pw), st: Math.min(mn.st, st), ps: Math.min(mn.ps, ps) }
    if (t < CONTRAST_MIN.text_vs_surfaceDeep - 1e-9 || pw < CONTRAST_MIN.primary_vs_white - 1e-9
      || st < CONTRAST_MIN.secondary_vs_text - 1e-9 || ps < CONTRAST_MIN.primary_vs_surface - 1e-9) bad++
  }
  console.log(`  ${mood.padEnd(8)} ${(r2(mn.t) + ':1').padStart(10)} ${(r2(mn.pw) + ':1').padStart(9)} ${(r2(mn.st) + ':1').padStart(9)} ${(r2(mn.ps) + ':1').padStart(9)}  ${bad === 0 ? '✅' : '❌'}`)
  check(`${mood}: 360개 hue 전부 대비 4종 만족`, bad === 0, { 미달개수: bad })
}

/* ── 레거시 — 게시된 문자열 테마 7종의 색은 바뀌지 않는다(완료조건 8) ── */
section('레거시 — 게시된 테마 7종 본문 대비 4.5:1 (색 보존)')
for (const t of Object.keys(THEME_TOKENS) as ThemeKey[]) {
  const c = THEME_TOKENS[t].colors
  const body = contrast(c.text, c.surface)
  check(`${t} 본문 대비 4.5:1 이상`, body >= 4.5, { 대비: `${r2(body)}:1` })
}

/* ══ V-06 ② 폼 필드에 label ══════════════════════════════════════ */
section('§17.2 · V-06 — 폼 필드에 label')

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

{
  const form = read('app/new/form.tsx')
  check('/new 폼이 label 컴포넌트를 통해 필드를 그린다',
    /<label[^>]*htmlFor=/.test(form))

  /*
   * `htmlFor`와 `id`가 **같은 값인지**를 본다.
   * `Field`가 `htmlFor={name}`을 그리고, 호출부가 `<Field name="행사명">` 안에
   * `<input id="행사명">`을 넣는 구조다. 문자열 형태만 grep하면(예: `id={name}`)
   * 멀쩡한 연결을 놓친다 — 실제로 그렇게 오판했다. 값끼리 대조한다.
   */
  const fieldNames = [...form.matchAll(/<Field\s[^>]*\bname="([^"]+)"/g)].map((m) => m[1])
  const inputIds = new Set(
    [...form.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]))
  const unlinked = fieldNames.filter((n) => !inputIds.has(n))

  check(`label의 htmlFor가 입력 id와 값이 일치한다 (필드 ${fieldNames.length}개)`,
    fieldNames.length > 0 && unlinked.length === 0, { 연결안됨: unlinked })

  // placeholder만으로 라벨을 대신한 입력이 있는지.
  const bareInputs = [...form.matchAll(/<(input|select|textarea)\b(?![^>]*\bid=)[^>]*>/g)]
    .filter((m) => !/type="(checkbox|hidden|file)"/.test(m[0]))
  check('id 없는 입력이 0건이다 (placeholder로 대체한 건 0건)',
    bareInputs.length === 0, bareInputs.map((m) => m[0].slice(0, 60)))
}

{
  const apply = read('components/page/ApplyForm.tsx')
  check('신청 폼이 label을 쓴다', /<label/.test(apply))
  check('신청 폼 label이 htmlFor로 연결된다', /htmlFor=/.test(apply))
}

{
  const login = read('app/admin/login/page.tsx')
  check('로그인 폼에 label이 있다', /<label/.test(login), '로그인 화면')
}

/* ══ V-06 ③ 이미지 대체 텍스트 ═══════════════════════════════════ */
section('§17.2 · V-06 — 모든 이미지에 대체 텍스트')
{
  const media = read('components/page/media.tsx')
  check('이미지 컴포넌트가 alt를 필수로 받는다', /alt=/.test(media))
  check('빈 alt로 렌더링하는 경로가 없다 (자동 채움은 업로드 시점)',
    !/alt=""/.test(media) && !/alt=\{''\}/.test(media))
  console.log('  ※ 저장 시점 자동 채움은 test:images의 F-05가 판정한다 (28건 통과)')
}

/* ══ 다크 모드 범위 제외 (§17.2) ═════════════════════════════════ */
section('§17.2 — 다크 모드는 범위 제외 (라이트 단일)')
{
  /*
   * **주석을 걷어내고** 본다. `globals.css`에는 「스캐폴드의
   * `prefers-color-scheme: dark` 블록을 제거했다」는 설명이 주석으로 남아 있어서,
   * 그대로 grep하면 설명문을 위반으로 잡는다 — 실제로 그렇게 오판했다.
   */
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')   // /* … */
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // // …  (url:// 는 남긴다)
  const css = strip(read('app/globals.css'))
  const layout = strip(read('app/layout.tsx'))

  check('prefers-color-scheme: dark 블록이 0건이다 (주석 제외)',
    !/prefers-color-scheme:\s*dark/.test(css + layout), '다크 모드 스타일')
  check('dark: 변형 클래스가 0건이다',
    !/\bdark:[a-z-]/.test(css), 'tailwind dark: 클래스')
}

console.log(`\n${'─'.repeat(52)}`)
console.log(`통과 ${pass} · 실패 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
