/**
 * §17.1 반응형 실측 — 375 / 768 / 1280px. **AI 0회.**
 *
 * 체크리스트 **V-05가 「실제 검사 없이 반응형 검사 통과를 기록만 한 건이 0건」**을
 * 요구한다. 마크업을 읽고 통과로 적는 것이 바로 그 위반이므로, 실제 브라우저를
 * 띄워 **레이아웃 값을 읽는다.**
 *
 * 측정하는 것 (V-02·V-03)
 *   1. 문서 가로 스크롤 — `documentElement.scrollWidth > clientWidth`면 실패
 *   2. 뷰포트를 넘는 요소 — 단, `overflow-x: auto|scroll` 조상 안이면 정상(자체 스크롤)
 *   3. 스크롤 없이 넘치는 요소 — `scrollWidth > clientWidth`인데 `overflow-x: visible`
 *
 * 측정하지 않는 것
 *   요소 겹침은 자동 판정이 노이즈가 크다. 스크린샷을 남겨 육안 확인에 넘긴다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run verify:responsive
 */
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { FIXTURE_PAGE } from '../components/page/fixture'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
/**
 * 스크린샷 보관 위치.
 *
 * 기본값이 특정 PC의 절대 경로(`C:/Users/leo/...`)로 박혀 있었다. 그 계정이
 * 없는 컴퓨터에서는 남의 경로에 쓰거나 실패하고, 무엇보다 **다른 사람이
 * 이 스크립트를 돌릴 수 없다.** 임시 폴더를 기준으로 잡아 어디서나 돌아가게 한다.
 * 자리를 지정하려면 `SHOT_DIR` 환경 변수를 준다.
 */
const SHOTS = process.env.SHOT_DIR ?? join(tmpdir(), 'zentrip-responsive')
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const VIEWPORTS = [375, 768, 1280] as const

let pass = 0, fail = 0
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`     ✅ ${n}`) }
  else { fail++; console.log(`     ❌ ${n}${got !== undefined ? `\n          → ${JSON.stringify(got)}` : ''}`) }
}

mkdirSync(SHOTS, { recursive: true })

/* ── 로그인 ────────────────────────────────────────────────────── */
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
})
if (!login.ok) { console.error('로그인 실패 — dev 서버 확인'); process.exit(1) }
const setCookies = login.headers.getSetCookie()

/* ── 시드 ──────────────────────────────────────────────────────── */
const EXEC = `verify-responsive-${process.pid}`
const SLUG = `verify-rsp-${process.pid}`

{
  const { data: old } = await db.from('products').select('id').eq('execution_id', EXEC).maybeSingle()
  if (old) await db.from('applications').delete().eq('product_id', old.id)
}
await db.from('execution_logs').delete().eq('execution_id', EXEC)
await db.from('abnormality_flags').delete().eq('execution_id', EXEC)
await db.from('products').delete().eq('execution_id', EXEC)

const passAxis = { verdict: 'pass' as const, items: [] }
const { data: prod, error: seedError } = await db.from('products').insert({
  execution_id: EXEC, slug: SLUG, status: 'published',
  current_step: 'draft_registered', human_edited: true,
  published_at: new Date().toISOString(),
  form_input: {
    행사정보: {
      행사명: '반응형 실측 상품', 여행지: '제주 서귀포 일원',
      여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
      일정원문: '1일: 출발\n2일: 귀국', 타겟층: '가족', 여행스타일: '자연', 여행주제: '제주 걷기와 로컬 맛집 휴식',
      기획메모: '',
    },
    // 객체 배열 · 1건 이상 (§7.4)
    숙박: [{ 숙소명: '제주 올레 호텔', 위치: '서귀포', 객실타입: '디럭스', 숙박일정: '3박 4일' }],
    상점: [{ 상점명: '올레 기념품점', 구분: '추천', 위치: '', 상점정보: '7코스 입구' }],
    가격: { 성인: '890000원', 아동: '해당 없음', 기타: '' },
    식사: { 식사정보: '조식 3회 · 중식 2회' },
    항공편: { 공항: '김해', 항공사: '대한항공', 편명: 'KE1234', 출발시간: '09:00', 도착시간: '10:10' },
  },
  // §17.1의 검증 대상 12종이 전부 들어 있는 경계값 데이터 (components/page/fixture.ts)
  page_content: FIXTURE_PAGE,
  validation_snapshot: {
    attempt_no: 1, verdict: 'pass', validated_at: new Date().toISOString(),
    content_hash: 'rsp', axes: { axis_0: passAxis, axis_1: passAxis, axis_2: passAxis,
      axis_3: { ...passAxis, skipped: ['apply'] } },
  },
}).select().single()
if (seedError) { console.error('시드 실패:', seedError.message); process.exit(1) }

// 신청 내역·로그 화면에 실제 행이 있어야 표가 그려진다
await db.from('applications').insert({
  product_id: prod.id, name: '홍길동', email: 'rsp@example.com', phone: '010-1234-5678',
  headcount: 2, consent_at: new Date().toISOString(), email_status: 'failed',
  email_error: '도메인 미인증으로 발송이 거부되었습니다. 재발송하려면 수신 주소를 확인해 주세요.',
  product_snapshot: {
    행사명: '반응형 실측 상품', 여행지: '제주 서귀포 일원',
    여행기간: '2026-03-14 ~ 2026-03-17', 숙소명: '제주 올레 호텔',
    가격: { 성인: '890000원', 아동: '해당 없음' }, url: `${BASE}/p/${SLUG}`,
  },
})
await db.from('execution_logs').insert(
  ['pipeline_started', 'itinerary_decomposed', 'brochure_generated', 'page_generated']
    .map((step, i) => ({
      execution_id: EXEC, product_id: prod.id, category: 'pipeline', step,
      attempt_no: 1, retry_index: i === 3 ? 1 : 0, verdict: i === 2 ? 'fail' : '-',
      status: 'generating',
      // 넓은 JSON — 8열 표에서 입력·출력 칸이 페이지를 밀지 않는지 본다
      input: { 행사명: '반응형 실측 상품', 일정원문: '1일: '.repeat(40) },
      output: { detail: 'x'.repeat(400), usage: { total: 1234 } },
    })),
)
await db.from('abnormality_flags').insert({
  execution_id: EXEC, product_id: prod.id, attempt_no: 1, type: 'processing_delayed',
  step: 'page_generated', detail: '요청 소요 22.4초. 임계값 20초를 초과했습니다.',
})

/* ── 측정 ──────────────────────────────────────────────────────── */
interface Overflow {
  doc: { scrollWidth: number; clientWidth: number }
  beyond: { tag: string; cls: string; right: number }[]
  clipped: { tag: string; cls: string; scrollWidth: number; clientWidth: number }[]
  scrollers: number
}

/*
 * 측정 코드를 **문자열로** 넘긴다. 콜백으로 넘기면 tsx(esbuild)가 `keepNames`용
 * `__name` 헬퍼를 함수 선언에 끼워 넣는데, 그 헬퍼는 번들 스코프에만 있고
 * 브라우저에는 없어서 `ReferenceError: __name is not defined`로 죽는다.
 */
const MEASURE = `(() => {
  const de = document.documentElement
  const vw = de.clientWidth

  function hasScrollAncestor(el) {
    let n = el
    while (n && n !== document.body) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
      n = n.parentElement
    }
    return false
  }

  const beyond = []
  const clipped = []
  let scrollers = 0

  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    // 모달·오버레이는 뷰포트에 고정돼 문서 폭에 기여하지 않는다
    if (cs.position === 'fixed') continue

    const ox = cs.overflowX
    if (ox === 'auto' || ox === 'scroll') { scrollers++; continue }

    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.right > vw + 1 && !hasScrollAncestor(el)) {
      beyond.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 90),
        right: Math.round(r.right),
      })
    }
    if (ox === 'visible' && el.scrollWidth > el.clientWidth + 1 && !hasScrollAncestor(el)) {
      clipped.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 90),
        scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      })
    }
  }

  return {
    doc: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth },
    beyond: beyond.slice(0, 5),
    clipped: clipped.slice(0, 5),
    scrollers,
  }
})()`

async function measure(page: Page): Promise<Overflow> {
  return page.evaluate(MEASURE) as Promise<Overflow>
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
await ctx.addCookies(setCookies.map((c) => {
  const [pair] = c.split(';')
  const i = pair.indexOf('=')
  return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: 'localhost', path: '/' }
}))

/**
 * `desktopOnly` — §17.1이 편집기에 요구하는 것은 「편집기 **미리보기에서** 375 /
 * 768 / 1280 뷰포트를 전환해 기획자가 직접 확인한다」다. 편집기 자체(좌 목록 +
 * 중앙 편집 + 우 미리보기 3분할)는 기획자용 데스크톱 도구이며, 미리보기 칸이
 * 선택한 뷰포트 폭을 그대로 갖기 때문에 창보다 넓어지는 것이 **설계다.**
 *
 * 그래서 문서 가로 스크롤을 실패로 세지 않고, 대신 「미리보기 iframe이 있고
 * 뷰포트 전환 버튼 3개가 있다」를 본다. 검증 대상은 그 iframe 안의 페이지이고
 * 그것은 공개 페이지와 같은 `PageRenderer`다(§9.1).
 */
const TARGETS: { name: string; path: string; auth: boolean; desktopOnly?: boolean }[] = [
  { name: '공개 상품 페이지 (12종 전체)', path: `/p/${SLUG}`, auth: false },
  { name: '신청 폼 (§13.1)', path: `/p/${SLUG}#apply`, auth: false },
  { name: '/new 폼', path: '/new', auth: true },
  { name: '/admin 목록', path: '/admin', auth: true },
  { name: '/admin/products/{id} 상세', path: `/admin/products/${prod.id}`, auth: true },
  { name: '/admin/products/{id}/edit 편집기 (데스크톱 도구)',
    path: `/admin/products/${prod.id}/edit`, auth: true, desktopOnly: true },
  { name: '/admin/applications 신청 내역', path: '/admin/applications', auth: true },
  { name: '/admin/logs/{id} 로그 뷰', path: `/admin/logs/${EXEC}`, auth: true },
]

for (const t of TARGETS) {
  console.log(`\n${t.name}  ${t.path}`)
  for (const w of VIEWPORTS) {
    const page = await ctx.newPage()
    await page.setViewportSize({ width: w, height: 900 })
    const res = await page.goto(`${BASE}${t.path}`, { waitUntil: 'networkidle' })
    if (!res || res.status() >= 400) {
      check(`${w}px — 200 응답`, false, res?.status())
      await page.close()
      continue
    }
    const m = await measure(page)

    /*
     * Next.js 개발 표시기(`<nextjs-portal>`)를 가린다. `position: fixed`라 측정에는
     * 잡히지 않지만 `fullPage` 스크린샷에서는 본문 위에 찍혀 **없는 겹침으로 보인다.**
     * 개발 전용 요소이고 프로덕션에는 없다(next 문서 `devIndicators`).
     * `next.config.ts`에서 끄지 않는 이유: 개발 중에는 있어야 유용하다.
     */
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })

    const file = `${SHOTS}/${t.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}-${w}.png`
    await page.screenshot({ path: file, fullPage: true })

    if (t.desktopOnly) {
      // §17.1의 요구는 「미리보기에서 뷰포트를 전환해 확인」이다 — 그 수단의 존재를 본다
      const frames = await page.locator('iframe').count()
      const switches = await page.getByRole('button', { name: /375|768|1280/ }).count()
      check(`${w}px — 미리보기 iframe 1개 이상 (문서 폭 ${m.doc.scrollWidth}px은 설계)`,
        frames >= 1, { frames })
      check(`${w}px — 뷰포트 전환 버튼 3개`, switches >= 3, { switches })
      await page.close()
      continue
    }

    const docOk = m.doc.scrollWidth <= m.doc.clientWidth + 1
    check(`${w}px — 문서 가로 스크롤 0 (scrollWidth ${m.doc.scrollWidth} ≤ ${m.doc.clientWidth})`,
      docOk, docOk ? undefined : m.doc)
    check(`${w}px — 뷰포트를 넘는 요소 0 (자체 스크롤 컨테이너 ${m.scrollers}개 제외)`,
      m.beyond.length === 0, m.beyond.length ? m.beyond : undefined)
    check(`${w}px — 스크롤 없이 넘치는 요소 0`,
      m.clipped.length === 0, m.clipped.length ? m.clipped : undefined)

    await page.close()
  }
}

/* ── 정리 ──────────────────────────────────────────────────────── */
await browser.close()
if (!process.env.KEEP) {
  await db.from('applications').delete().eq('product_id', prod.id)
  await db.from('execution_logs').delete().eq('execution_id', EXEC)
  await db.from('abnormality_flags').delete().eq('execution_id', EXEC)
  await db.from('products').delete().eq('execution_id', EXEC)
  console.log('\n임시 데이터 정리 완료. (KEEP=1로 보존 가능)')
}

console.log(`\n스크린샷 ${TARGETS.length * VIEWPORTS.length}장: ${SHOTS}`)
console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
