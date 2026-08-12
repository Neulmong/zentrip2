/**
 * §20 3분 시나리오 관통 테스트 — **한 상품이 대본 순서대로 끝까지 간다.**
 *
 * 구간별 테스트(`test:pipeline`·`test:publish`·`test:application`·`test:logs`)가
 * 전부 통과해도, 이어붙였을 때 상태 전이나 시작 조건에서 끊길 수 있다. 이
 * 스크립트는 §20의 9개 큐 지점을 **한 상품으로** 순서대로 밟는다.
 *
 * 실제 AI를 6회 호출한다(§4.2의 1요청 1AI호출 × 6단계). 무료 티어 쿼터를 쓴다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:demo
 *   KEEP=1 npm run test:demo   ← 브라우저로 확인하려면 남긴다
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const TO = process.env.TEST_EMAIL_TO ?? 'delivered@resend.dev'
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

let pass = 0, fail = 0
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`     ✅ ${n}`) }
  else { fail++; console.log(`     ❌ ${n}${got !== undefined ? `\n          → ${JSON.stringify(got)}` : ''}`) }
}

const T0 = Date.now()
/** 시작부터의 경과. §20의 큐 시간과 나란히 읽는다 */
const at = () => {
  const s = Math.round((Date.now() - T0) / 1000)
  return `${String(Math.floor(s / 60)).padStart(1, '0')}:${String(s % 60).padStart(2, '0')}`
}
const cue = (script: string, label: string) =>
  console.log(`\n[${at()}] §20 ${script} — ${label}`)

/* ══ 0:00 로그인 ═════════════════════════════════════════════════ */
cue('0:00', '/admin/login 비밀번호 인증')
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
})
check('로그인 200', login.ok, login.status)
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const guard = await fetch(`${BASE}/admin`, { redirect: 'manual' })
check('비로그인은 /admin에 못 들어간다', guard.status === 307 || guard.status === 302, guard.status)

/* ══ 0:15 폼 입력 ════════════════════════════════════════════════ */
cue('0:15', '/new 폼 입력 → POST /api/products')
const fd = new FormData()
for (const [k, v] of Object.entries({
  행사명: '데모 관통 제주 여행', 여행지: '제주',
  여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
  일정원문: [
    '1일: 김해공항 출발, 올레 7코스 걷기, 중식·석식 제공',
    '2일: 성산일출봉, 해녀박물관 관람, 조식·중식 제공',
    '3일: 자유 일정, 조식 제공',
    '4일: 귀국',
  ].join('\n'),
  /*
   * **숙소 2곳 · 상점 3곳으로 넣는다**(spec 2.7 · §7.4).
   *
   * 1행씩만 넣으면 배열 경로가 사실상 미검증이다 — 행이 하나일 때는 인덱스가
   * 항상 `[0]`이라 `source` 경로가 다른 원소를 가리키는 결함이 드러나지 않고,
   * 렌더러가 첫 행만 그려도 화면이 정상으로 보인다. §7.3 ⑤-1의 「이미지를 올리지
   * 않아 슬롯 경로가 미검증이었다」와 같은 종류의 구멍이다.
   *
   * 폼 필드 이름이 `source` 경로와 같은 표기다 — 실제 화면이 그렇게 보낸다.
   */
  '숙박[0].숙소명': '롯데호텔 제주', '숙박[0].위치': '중문',
  '숙박[0].객실타입': '디럭스룸', '숙박[0].숙박일정': '1~2박',
  '숙박[1].숙소명': '성산 한옥스테이 고요', '숙박[1].위치': '성산읍 고성리',
  '숙박[1].객실타입': '', '숙박[1].숙박일정': '3박',

  '상점[0].상점명': '제주 로컬 기념품 숍', '상점[0].구분': '제휴',
  '상점[0].위치': '중문관광로 72', '상점[0].상점정보': '여행객 10% 할인',
  '상점[1].상점명': '성산 바다뷰 카페', '상점[1].구분': '추천',
  '상점[1].위치': '해맞이해안로 1', '상점[1].상점정보': '',
  '상점[2].상점명': '올레 국수집', '상점[2].구분': '추천',
  '상점[2].위치': '', '상점[2].상점정보': '',

  가격_성인: '120000', 가격_아동: '해당 없음', 가격_기타: '항공료 별도',
  식사정보: '조식 3회, 중식 2회, 석식 1회', 여행스타일: '자연', 여행주제: '제주 걷기와 로컬 맛집 휴식',
  기획메모: '',
})) fd.set(k, v)

const created = await (await fetch(`${BASE}/api/products`, {
  method: 'POST', headers: { cookie }, body: fd,
})).json()
check('상품 등록 200 + product_id', typeof created.product_id === 'string', created)
if (!created.product_id) { console.error('여기서 멈춘다.'); process.exit(1) }
const pid: string = created.product_id

/*
 * 배열이 행 수·순서 그대로 저장됐는가 (§7.4). 순서는 값의 일부다 — 흔들리면
 * `source` 경로가 다른 원소를 가리켜 1·2·3차가 전부 어긋난다.
 */
{
  /*
   * DB에서 직접 읽는다 — `GET /api/products/{id}`(#9)는 상태·단계·검증 결과만
   * 돌려주고 `form_input`을 싣지 않는다(§14.4). 여기서 볼 것은 **저장된 구조**다.
   */
  const fi = (await db.from('products').select('form_input').eq('id', pid).single())
    .data?.form_input as { 숙박: { 숙소명: string }[]; 상점: { 상점명: string; 구분: string }[] }
  check('숙박 2행 · 상점 3행이 순서 그대로 저장된다 (§7.4)',
    fi?.숙박?.length === 2 && fi.숙박[0].숙소명 === '롯데호텔 제주'
    && fi.숙박[1].숙소명 === '성산 한옥스테이 고요'
    && fi?.상점?.length === 3 && fi.상점[2].상점명 === '올레 국수집',
    { 숙박: fi?.숙박?.map((s) => s.숙소명), 상점: fi?.상점?.map((s) => s.상점명) })
  check('사람이 고른 `제휴`가 그대로 남는다 — AI가 올린 값이 아니다 (§6.1)',
    fi?.상점?.[0].구분 === '제휴' && fi.상점[1].구분 === '추천',
    fi?.상점?.map((s) => s.구분))
}


/**
 * §16.1.1 — 조회 시점을 **이어서 나른다.** 실제 클라이언트가 그렇게 하므로
 * (`lib/client/run-pipeline.ts`) 보내지 않는 하니스는 잠금이 걸린 앱을
 * 잠금 없는 앱처럼 재게 된다.
 */
let updatedAt: string | undefined = await (async () => {
  const r = await fetch(`${BASE}/api/products/${pid}`, { headers: { cookie } })
  const seen = await r.json().catch(() => ({}))
  return typeof seen?.updated_at === 'string' ? seen.updated_at : undefined
})()

const post = async (path: string, body?: unknown) => {
  const r = await fetch(`${BASE}/api/products/${pid}/${path}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ ...(updatedAt ? { updated_at: updatedAt } : {}), ...(body ?? {}) }),
  })
  const parsed = { status: r.status, body: await r.json().catch(() => ({})) }
  // 행이 갱신됐으면 새 값으로 바꿔 든다 — 200이든 409 retry든.
  const next = (parsed.body as { updated_at?: unknown })?.updated_at
  if (typeof next === 'string') updatedAt = next
  return parsed
}

/**
 * AI 단계 호출. **409 `retry`를 재시도한다** — 실제 클라이언트가 그렇게 하므로
 * (§4.2·`lib/client/run-pipeline.ts`) 재시도하지 않는 하니스는 앱보다 약한 조건을
 * 재는 셈이다. 무료 티어 분당 한도(429)에서는 서버가 `retry_after_ms`를 주므로
 * **그 값을 그대로 기다린다** — 하니스는 UI가 아니라 응답성을 신경 쓸 이유가 없다.
 */
/**
 * §14.6 — **200은 「단계 완료」이고 `fail` 확정도 포함한다.** 상태 코드만 보고
 * 통과로 세면, 재시도가 소진돼 축이 `fail`로 굳은 응답을 성공으로 읽는다.
 * 실제로 무료 티어 429에서 그 일이 일어난다(`발견값: rate_limited`).
 */
function failedAxis(body: unknown): string | null {
  const axes = (body as { axes?: Record<string, { verdict?: string } | null> })?.axes
  if (!axes) return null
  for (const [name, r] of Object.entries(axes)) {
    if (r?.verdict === 'fail') return name
  }
  return null
}

async function step(path: string, tries = 3) {
  for (let n = 1; n <= tries; n++) {
    const r = await post(path)
    if (r.status === 200) return r
    if (r.status === 409 && r.body?.reason === 'retry') {
      const waitMs = Number(r.body.retry_after_ms ?? 2000)
      console.log(`     ↻ ${path} 409 retry — ${Math.round(waitMs / 1000)}초 대기 후 재시도 (${n}/${tries})`)
      await new Promise((res) => setTimeout(res, waitMs))
      continue
    }
    return r
  }
  return post(path)
}
const row = async () => (await db.from('products').select('*').eq('id', pid).single()).data!

/**
 * 한 묶음을 **실제 클라이언트와 같은 규칙으로** 돌린다(`lib/client/run-pipeline.ts`).
 *
 * 멈추는 조건이 둘이다 — 둘 다 「더 호출해도 소용없다」는 뜻이고,
 * 그 상태에서 다음 단계를 부르면 §14.5의 시작 조건에서 409 precondition만 나온다:
 *
 *   422           입력 문제로 중단(§14.6) → 폼 화면으로 이동
 *   200 + axes fail  검증 실패 확정(§14.6) → 검토 화면으로 이동
 *
 * 멈춘 뒤의 단계를 계속 호출하면 **실패가 부풀려져** 진짜 원인이 묻힌다.
 * 앱보다 멍청한 하니스는 앱을 잘못 재는 것이므로 여기서 같은 규칙을 쓴다.
 */
let halted: string | null = null
async function runGroup(names: string[]) {
  for (const name of names) {
    if (halted) {
      console.log(`     ⏭  ${name} — ${halted}로 이미 멈춤 (클라이언트는 호출하지 않는다)`)
      continue
    }
    const r = await step(name)

    if (r.status === 422) {
      halted = '입력 오류(422)'
      check(`${name} 200 (fail 확정 아님)`, false,
        { status: 422, failure_reason: r.body?.failure_reason, 다음화면: `/new?product_id=${pid}` })
      continue
    }

    const bad = failedAxis(r.body)
    if (r.status === 200 && bad) halted = `${bad} fail 확정`
    check(`${name} 200 (fail 확정 아님)`, r.status === 200 && !bad, r)
  }
}

/* ══ 0:50 소개서 생성 = 4요청 ════════════════════════════════════ */
cue('0:50', '[소개서 생성] — 클라이언트가 4요청을 순차 호출 (§8.5)')
await runGroup(['decompose', 'brochure', 'validate-brochure'])
const afterBrochure = await row()
check('status = brochure_ready (§15.2)', afterBrochure.status === 'brochure_ready',
  afterBrochure.status)
check('axis_0·axis_1 통과 배지 (§20 1:15의 컷)',
  afterBrochure.validation_snapshot?.axes?.axis_0?.verdict === 'pass'
  && afterBrochure.validation_snapshot?.axes?.axis_1?.verdict === 'pass',
  afterBrochure.validation_snapshot?.axes)

const review = await (await fetch(`${BASE}/admin/products/${pid}`, { headers: { cookie } })).text()
check('소개서 검토 화면에 8섹션이 그려진다',
  ['개요', '일정', '숙박', '항공', '식사', '가격', '제휴상점'].every((s) => review.includes(s)))

/* ══ 1:15 상품 생성 = 3요청 ══════════════════════════════════════ */
cue('1:15', '[상품 생성] — 3요청 순차 호출 (§9.6)')
await runGroup(['page', 'validate-page', 'validate-consistency'])
const afterPage = await row()
check('status = draft (§15.2)', afterPage.status === 'draft', afterPage.status)
check('검증 4축 전부 pass (§20 1:15 — 절대 자르지 않는 컷)',
  ['axis_0', 'axis_1', 'axis_2', 'axis_3']
    .every((a) => afterPage.validation_snapshot?.axes?.[a]?.verdict === 'pass'),
  afterPage.validation_snapshot?.axes)
check('slug 발급 (§12.1)', !!afterPage.slug, afterPage.slug)

/* ══ 1:35 편집기 ═════════════════════════════════════════════════ */
cue('1:35', '편집기 — 문구 수정 + 섹션 삭제 + slug 지정 (§10)')
const editor = await (await fetch(`${BASE}/admin/products/${pid}/edit`, { headers: { cookie } })).text()
check('편집기 화면이 열린다', editor.includes('미리보기') || editor.includes('편집'))

if (!afterPage.page_content) {
  console.error(`\n[${at()}] page_content가 없어 이후 단계를 진행할 수 없다. 위 실패를 먼저 보라.`)
  console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
  process.exit(1)
}
const content = afterPage.page_content as {
  sections: { id: string; type: string; visible: boolean; data: Record<string, unknown> }[]
}
/*
 * §20의 「섹션 1개 삭제」는 배열에서 빼는 것이 아니다. §10.2가 「`visible: false`로
 * 전환하며 **데이터는 보존**」이라고 규정하고, 배열에서 빼면 저장이 400으로
 * 거부된다(「기본 섹션이 빠졌습니다」). 편집 이력을 되돌릴 수 있어야 하기 때문이다.
 */
const edited = {
  ...content,
  sections: content.sections.map((s) => ({
    ...s,
    ...(s.id === 'sec_shop' ? { visible: false } : {}),
    ...(s.type === 'summary'
      ? { data: { ...s.data, 여행지: '제주 (편집됨)' } }
      : {}),
  })),
}
const saved = await fetch(`${BASE}/api/products/${pid}/content`, {
  method: 'PATCH', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ page_content: edited, updated_at: afterPage.updated_at }),
})
check('편집 저장 200', saved.status === 200, await saved.clone().text())
const afterEdit = await row()
check('human_edited = true → 배지 2종 동시 표시 조건 (§10.4)',
  afterEdit.human_edited === true, afterEdit.human_edited)

const savedSections = (afterEdit.page_content as typeof content).sections
const shop = savedSections.find((s) => s.id === 'sec_shop')
check('숨긴 섹션이 배열에 남아 있다 — 데이터 보존 (§10.2)', !!shop, savedSections.map((s) => s.id))
check('visible = false로 전환됐다', shop?.visible === false, shop?.visible)

const DEMO_SLUG = `demo-run-${process.pid}`
const slugRes = await fetch(`${BASE}/api/products/${pid}/slug`, {
  method: 'PATCH', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ slug: DEMO_SLUG, updated_at: afterEdit.updated_at }),
})
check('slug 지정 200', slugRes.status === 200, await slugRes.clone().text())

const detail = await (await fetch(`${BASE}/admin/products/${pid}`, { headers: { cookie } })).text()
check('검증축·편집축 배지가 동시에 붙는다 (§10.4)',
  detail.includes('AI 검증 통과') && detail.includes('사람 편집됨'), true)

/* ══ 2:10 게시 ═══════════════════════════════════════════════════ */
cue('2:10', '[게시] — 확인 모달 → 공개 URL 즉시 활성 (§12.2)')
const beforePublish = await row()
const notYet = await fetch(`${BASE}/p/${DEMO_SLUG}`)
check('게시 전 공개 URL은 404 (§20 「draft URL은 404」)', notYet.status === 404, notYet.status)

const published = await post('publish', { updated_at: beforePublish.updated_at })
check('게시 200', published.status === 200, published.body)
check('url = /p/{slug}', published.body.url === `/p/${DEMO_SLUG}`, published.body.url)

/* ══ 2:20 비로그인 접속 ══════════════════════════════════════════ */
cue('2:20', '비로그인으로 /p/{slug} 접속 — 절대 자르지 않는 컷')
const publicRes = await fetch(`${BASE}/p/${DEMO_SLUG}`)  // ← 쿠키 없음
const publicHtml = await publicRes.text()
check('200 반환', publicRes.status === 200, publicRes.status)
check('행사명이 보인다', publicHtml.includes('데모 관통'))
check('편집한 값이 반영돼 있다', publicHtml.includes('제주 (편집됨)'))
/*
 * 숨긴 섹션은 HTML에 **한 글자도 남지 않는다.** `PageRenderer`가 서버에서
 * `visible !== false`로 거른 뒤 그리고, 공개 페이지에는 `page_content`를 들고 가는
 * 클라이언트 컴포넌트가 없어 RSC 페이로드로 새어 나갈 경로도 없다(§16.3).
 *
 * `상점정보`·`숙소명`은 둘 다 컴포넌트가 그리는 라벨이다. 숨긴 제휴상점은 0,
 * 그려지는 숙박은 1 이상 — 라벨이 실제로 존재하는 문자열임을 숙박 쪽이 증명하므로
 * 「오타라서 0」과 「숨겨져서 0」이 구분된다.
 *
 * ⚠ 2026-08-12 정정: 원래 이 자리는 `shopHits > 0 && shopHits < staysHits`였다.
 *   「페이로드에는 남는다」를 전제한 조건인데, 그러면 **숨긴 데이터가 새어 나와야만
 *   통과**한다. 이 스크립트가 처음 실제로 돌아간 날(AI 쿼터 확보) 드러났다.
 */
const count = (s: string) => publicHtml.split(s).length - 1
const shopHits = count('상점정보')
/*
 * ⚠ 2.7 정정: 전에는 `숙소명`을 셌다. 배열이 되면서 숙박 섹션이 정의 목록에서
 * **카드 목록**으로 바뀌었고(`CardList`), 카드의 제목은 «숙소명»이라는 낱말이
 * 아니라 **값**(롯데호텔 제주)이다. 그래서 그 낱말은 이제 0이 정상이다.
 * 「그려지는 섹션의 라벨」로 쓸 수 있는 것은 카드 안의 `객실타입`이다.
 */
const staysHits = count('객실타입')
check(`숨긴 섹션은 HTML에 남지 않는다 (상점정보 ${shopHits} = 0, 객실타입 ${staysHits} > 0)`,
  shopHits === 0 && staysHits > 0, { shopHits, staysHits })

/*
 * 배열 렌더링 — **행이 전부 그려지는가.** 첫 행만 그려도 화면은 정상으로 보이므로
 * 두 번째 숙소를 명시적으로 확인한다(§9.3 `숙소들[]`).
 */
check('숙소 2곳이 모두 공개 페이지에 있다 (§7.4)',
  publicHtml.includes('롯데호텔 제주') && publicHtml.includes('성산 한옥스테이 고요'),
  { 첫째: publicHtml.includes('롯데호텔 제주'), 둘째: publicHtml.includes('성산 한옥스테이 고요') })
check('미입력 표기가 카드 안에서도 유지된다 (§6.1)',
  publicHtml.includes('추후 추가 예정'))
/*
 * 숨긴 제휴상점의 **행 값**도 한 글자도 남지 않는다. 라벨(`상점정보`)만 보면
 * 「라벨은 지웠는데 값은 새는」 경우를 놓친다 — 상점 3행 중 하나라도 남으면 실패다.
 */
check('숨긴 섹션의 행 값이 HTML에 없다 (§16.3)',
  !publicHtml.includes('제주 로컬 기념품 숍')
  && !publicHtml.includes('성산 바다뷰 카페')
  && !publicHtml.includes('올레 국수집'), true)
check('신청 폼 5필드', ['이름', '이메일', '연락처', '인원수', '동의']
  .every((f) => publicHtml.includes(f)))
check('관리 화면 흔적이 없다',
  !publicHtml.includes('/admin') && !publicHtml.includes('로그아웃'), true)

/* ══ 2:40 신청 → 이메일 ══════════════════════════════════════════ */
cue('2:40', '신청 폼 제출 → 완료 응답 → 이메일 (§13)')
const applyRes = await fetch(`${BASE}/api/applications`, {  // ← 쿠키 없음
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    product_id: pid, name: '홍길동', email: TO,
    phone: '010-1234-5678', headcount: 2, consent: true,
  }),
})
const applyBody = await applyRes.json()
check('신청 200 (인증 없이)', applyRes.status === 200, applyBody)
check('email_status = pending — 발송을 기다리지 않는다', applyBody.email_status === 'pending')

let app = (await db.from('applications').select('*').eq('id', applyBody.application_id).single()).data!
for (let i = 0; i < 30 && app.email_status === 'pending'; i++) {
  await new Promise((r) => setTimeout(r, 500))
  app = (await db.from('applications').select('*').eq('id', applyBody.application_id).single()).data!
}
check(`이메일 발송 성공 (수신 ${TO})`, app.email_status === 'sent', app.email_error)
check('스냅샷에 편집 전 원본 사실정보가 담긴다 (form_input 기준 §13.3)',
  app.product_snapshot?.여행지 === '제주', app.product_snapshot?.여행지)

/* ══ 2:55 관리 화면 2개 ══════════════════════════════════════════ */
cue('2:55', '/admin/applications · /admin/logs/{execution_id}')
const exec = beforePublish.execution_id
const appsHtml = await (await fetch(`${BASE}/admin/applications?product_id=${pid}`, {
  headers: { cookie },
})).text()
check('신청 내역에 이 신청이 있다', appsHtml.includes('데모 관통'))
check('연락처가 마스킹돼 있다', appsHtml.includes('010-****-5678'))
check('발송 상태 = 발송됨', appsHtml.includes('발송됨'))

const logsHtml = await (await fetch(`${BASE}/admin/logs/${exec}`, { headers: { cookie } })).text()
check('로그 화면 200 + 파이프라인 탭', logsHtml.includes('실행 로그'))
check('9개 파이프라인 단계가 있다',
  ['파이프라인 시작', '일차 분해', '0차 검증', '소개서 생성', '1차 검증',
    '페이지 생성', '2차 검증', '3차 검증', '임시저장 등록']
    .every((s) => logsHtml.includes(s)))

const lifeHtml = await (await fetch(`${BASE}/admin/logs/${exec}?tab=lifecycle`, {
  headers: { cookie },
})).text()
check('상태변경 탭에 편집·slug 변경·게시가 있다',
  ['편집 저장', 'slug 변경', '게시'].every((s) => lifeHtml.includes(s)))

const applyTabHtml = await (await fetch(`${BASE}/admin/logs/${exec}?tab=application`, {
  headers: { cookie },
})).text()
check('신청·메일 탭에 접수·발송이 있다',
  applyTabHtml.includes('신청 접수') && applyTabHtml.includes('메일 발송'))
check('로그의 개인정보가 마스킹돼 있다',
  applyTabHtml.includes('홍*동') && !applyTabHtml.includes(TO), true)

const { data: allLogs } = await db.from('execution_logs').select('step,category')
  .eq('execution_id', exec).order('id')
console.log(`     전체 로그 ${allLogs?.length}행: ${allLogs?.map((l) => l.step).join(' → ')}`)

/* ══ 결과 ════════════════════════════════════════════════════════ */
console.log(`\n[${at()}] 관통 완료`)
console.log(`  §20 대본은 3:00, §1의 측정 기준은 10분이다.`)

if (!process.env.KEEP) {
  await db.from('applications').delete().eq('product_id', pid)
  await db.from('execution_logs').delete().eq('execution_id', exec)
  await db.from('abnormality_flags').delete().eq('execution_id', exec)
  await db.from('products').delete().eq('id', pid)
  console.log('  임시 데이터 정리 완료. (KEEP=1로 남겨 브라우저에서 확인 가능)')
} else {
  console.log(`  남겨 둠 — /p/${DEMO_SLUG} · /admin/products/${pid} · /admin/logs/${exec}`)
}

console.log(`\n${'─'.repeat(52)}\n통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
