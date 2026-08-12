/**
 * §7.5 자연어 초안 관통 테스트 — **실제 기획 메모 하나로 #20을 끝까지 밟는다.**
 *
 * 아래 `MEMO`는 기획자가 실제로 준 입력이다. 예시용으로 다듬지 않았다 —
 * 라벨 표기가 섞여 있고(`-여행일정:` / `-여행지 포인트`), 괄호가 빠진 줄도 있고,
 * 연도 없는 날짜(`11.04~11.08`)가 들어 있다. **그 상태로 통과해야 한다.**
 *
 * 검사하는 것:
 *   · 카페·음식점 13곳 + 숙소 2곳이 초안에 **누락 0건**으로 들어간다(§7.5 ②)
 *   · 연도가 없으면 날짜를 만들지 않고 사람에게 넘긴다
 *   · 사람이 날짜를 주면 그 날짜로 일차가 배분된다
 *   · 가격은 항상 비어 있다(§7.5 ③)
 *   · 초안이 그대로 `POST /api/products`(#1)에 통과한다 — 폼 구조가 같다는 뜻
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:plan-draft
 *
 * **AI 1회**를 쓴다(날짜를 주고 한 번 더 돌리면 2회).
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${n}`) }
  else { fail++; console.log(`  ❌ ${n}${got !== undefined ? `\n       → ${JSON.stringify(got, null, 2)}` : ''}`) }
}
const section = (t: string) => console.log(`\n${t}`)

/** 기획자가 실제로 준 메모. 손대지 않는다 */
const MEMO = `-여행일정: 4박5일 (11.04~11.08)
-여행주제: 제주걷기와 로컬분위기 맛집과 카페에서의 휴식
-여행객 페르소나:
긍뮹권에서 일하는 동기생 A, B는 혼자서 하기에는 부담되는 걷기 축제를 함께가서 제주의 가을을 제대로 만끽하고 싶어한다. 회사에서의 스트레스는 제주의 맛집과 카페에서 날려버리고 재충전하는 시간을 기대하는 29세와 31세의 연령의 여성이다. 2곳의 숙소에서 1곳은 고가의 제주구옥에서 다른 한곳은 마을안에 있는 타운하우스에서 숙박을 하며 마을 속 에서 머물고자 한다.
-행사: 제주올레걷기축제 (11.05~11.07) (관련기사: https://www.yna.co.kr/view/AKR20260708117400056)
-숙박:
 조금불편해도괜잖아 (구좌읍 김녕로1길 35-24), 고요한하루 (북선로 241)
-카페 및 음식점:
 시간을담다 (구좌읍 평대7길)
 마레1440 (구좌읍 해맞이해안로 1440)
 더모먼트김녕 (구좌읍 김녕로22길3)
 종달달 (구좌읍 종달로 60-12)
 카페술도가제주바당 (구좌읍 한동로27)
 보롬창고 구좌읍 종달항길3)
 so much more (조천읍 북촌11길25)
 공든 (조천읍 신북로 267)
 자드부팡 (조천읍 선흘리 954)
 터치우드 (조천읍 함대로 160)
 프레투스 (구좌읍 중산간동로 1875)
 아끈식당 (조천읍 신촌북2길 31-3)
 함덕골목해장국 (조천읍 조천북길62)
-여행지 포인트
 함덕해수욕장
 닭머르 (노을뷰)
 김녕해수욕장, 세기알
 선흘리마을
 송당리마을
 아부오름
 서우봉`

/** 메모에 적힌 상호 — 초안에 전부 남아야 한다. `보롬창고`는 여는 괄호가 없다 */
const 상호 = [
  '조금불편해도괜잖아', '고요한하루',
  '시간을담다', '마레1440', '더모먼트김녕', '종달달', '카페술도가제주바당', '보롬창고',
  'so much more', '공든', '자드부팡', '터치우드', '프레투스', '아끈식당', '함덕골목해장국',
]

/* ══ 로그인 (§14.2 — /api/* 전체가 보호된다) ═══════════════════════ */
section('0. 로그인')
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
})
check('로그인 200', login.ok, login.status)
if (!login.ok) { console.error('\n로그인 실패. ADMIN_PASSWORD와 dev 서버를 확인한다.'); process.exit(1) }
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

/* ══ 1. 초안 생성 (#20 · AI 1회) ═════════════════════════════════ */
section('1. POST /api/plan-draft — 자연어 → 폼 초안 (AI 1회)')

const t0 = Date.now()
const res = await fetch(`${BASE}/api/plan-draft`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ text: MEMO }),
})
const body = await res.json().catch(() => ({}))
const 소요 = ((Date.now() - t0) / 1000).toFixed(1)

check(`200 반환 (${소요}초)`, res.status === 200, { status: res.status, body })
if (res.status !== 200) {
  console.error('\n여기서 멈춘다. 409면 AI 실패이므로 다시 실행한다.')
  process.exit(1)
}

const draft = body.draft
const origin: Record<string, string> = body.origin ?? {}
const notes = body.notes ?? {}

console.log(`\n  일정원문:\n${String(draft.행사정보.일정원문).split('\n').map((l: string) => `    ${l}`).join('\n')}`)
console.log(`\n  숙박 ${draft.숙박.length}행 · 상점 ${draft.상점.length}행`)

/* ══ 2. 누락 0건 (§7.5 ②) ════════════════════════════════════════ */
section('2. 누락 0건 — 메모의 상호가 전부 초안에 남는다')

const haystack = [
  draft.행사정보.일정원문,
  ...draft.숙박.map((s: { 숙소명: string }) => s.숙소명),
  ...draft.상점.flatMap((s: { 상점명: string; 상점정보: string }) => [s.상점명, s.상점정보]),
].join(' ')

const 빠진것 = 상호.filter((n) => !haystack.includes(n))
check(`상호 ${상호.length}곳이 모두 초안에 있다`, 빠진것.length === 0, 빠진것)
/*
 * 서버의 누락 목록은 **상호를 하나도 담고 있지 않아야** 한다.
 *
 * 「누락 0건」을 요구하지 않는 이유: 축제명처럼 장소가 아닌 후보가 목록에 들어갈 수
 * 있고, AI가 그것을 일차에 배분하지 않으면 누락으로 잡힌다. 그건 **정상 동작이고
 * 사람에게 보여줘야 하는 정보**다. 이 검사가 지켜야 하는 것은 기획자가 적은 가게·
 * 숙소가 사라지지 않는 것이다.
 */
const 누락상호 = (notes.누락 ?? []).filter((c: { 이름: string }) => 상호.includes(c.이름))
check('서버 누락 목록에 상호가 없다', 누락상호.length === 0, 누락상호)
if ((notes.누락?.length ?? 0) > 0) {
  console.log(`     (상호 아닌 누락 ${notes.누락.length}건: `
    + `${notes.누락.map((c: { 이름: string }) => c.이름).join(', ')})`)
}

/* ══ 3. 날짜 — 연도가 없으면 만들지 않는다 ═══════════════════════ */
section('3. 연도 없는 날짜(11.04~11.08)를 추정하지 않는다')

check('여행기간을 비워 사람에게 넘긴다',
  draft.행사정보.여행기간_시작 === '' && draft.행사정보.여행기간_종료 === '',
  { 시작: draft.행사정보.여행기간_시작, 종료: draft.행사정보.여행기간_종료 })
check('날짜미정을 보고한다', notes.날짜미정 === true, notes.날짜미정)
check('여행기간 origin이 empty다',
  origin['행사정보.여행기간_시작'] === 'empty', origin['행사정보.여행기간_시작'])

/* ══ 4. 가격 — 초안이 만들지 않는다 (§7.5 ③) ═════════════════════ */
section('4. 금액은 AI가 채우지 않는다')

check('가격 3필드가 비어 있다',
  draft.가격.성인 === '' && draft.가격.아동 === '' && draft.가격.기타 === '', draft.가격)
check('가격 origin이 전부 empty다',
  ['가격.성인', '가격.아동', '가격.기타'].every((k) => origin[k] === 'empty'))
check('필수미입력에 가격이 잡힌다 — 제출이 막힌다',
  !!notes.필수미입력?.['가격.성인'], notes.필수미입력)

/* ══ 5. 구분 — 제휴로 올리지 않는다 (§6.1) ═══════════════════════ */
section('5. 상점 구분은 전부 추천이다')

const 제휴 = draft.상점.filter((s: { 구분: string }) => s.구분 !== '추천')
check('AI가 제휴로 올린 상점이 없다', 제휴.length === 0, 제휴)

/* ══ 6. origin 3종이 실제 출처를 가리킨다 (§7.5 ③) ═══════════════ */
section('6. origin 3종')

check('숙소명은 input이다 — 메모에 그대로 있던 값',
  origin['숙박[0].숙소명'] === 'input', origin['숙박[0].숙소명'])
check('일정원문은 planned다 — AI가 배분해 쓴 서술',
  origin['행사정보.일정원문'] === 'planned', origin['행사정보.일정원문'])

const 분포 = Object.values(origin).reduce<Record<string, number>>((a, v) => {
  a[v] = (a[v] ?? 0) + 1; return a
}, {})
console.log(`     분포: ${JSON.stringify(분포)}`)

/* ══ 7. 사람이 날짜를 주면 그 날짜로 배분한다 ════════════════════ */
section('7. 날짜를 지정해 다시 채우기 (AI 1회 추가)')

const res2 = await fetch(`${BASE}/api/plan-draft`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ text: MEMO, 여행기간_시작: '2026-11-04', 여행기간_종료: '2026-11-08' }),
})
const body2 = await res2.json().catch(() => ({}))
check('200 반환', res2.status === 200, res2.status)

if (res2.status === 200) {
  const d2 = body2.draft
  check('지정한 날짜가 그대로 들어간다',
    d2.행사정보.여행기간_시작 === '2026-11-04' && d2.행사정보.여행기간_종료 === '2026-11-08',
    { 시작: d2.행사정보.여행기간_시작, 종료: d2.행사정보.여행기간_종료 })

  const 일차수 = (String(d2.행사정보.일정원문).match(/^\s*\d+\s*일\s*[:：]/gm) ?? []).length
  check(`일정원문의 일차가 5개다 (11.04~11.08 · 양끝 포함)`, 일차수 === 5, 일차수)
  check('축제 기간(11.05~11.07)이 서술에 등장한다',
    /올레|축제/.test(String(d2.행사정보.일정원문)))

  /* ══ 8. 초안이 폼 구조와 같은가 — #1에 그대로 넣어 본다 ═══════ */
  section('8. 초안 구조가 form_input과 같다 — #1이 받아들인다')

  const fd = new FormData()
  const g = d2.행사정보
  for (const [k, v] of Object.entries({
    행사명: g.행사명, 여행지: g.여행지,
    여행기간_시작: g.여행기간_시작, 여행기간_종료: g.여행기간_종료,
    일정원문: g.일정원문, 타겟층: g.타겟층, 여행스타일: g.여행스타일,
    여행주제: g.여행주제, 기획메모: g.기획메모,
    식사정보: d2.식사.식사정보,
    // 사람이 채우는 칸 — 초안은 비워서 준다(§7.5 ③)
    가격_성인: '390000', 가격_아동: '해당 없음', 가격_기타: '항공료 별도',
  })) fd.set(k, String(v ?? ''))

  d2.숙박.forEach((st: Record<string, string>, i: number) => {
    for (const f of ['숙소명', '위치', '객실타입', '숙박일정']) {
      fd.set(`숙박[${i}].${f}`, st[f] ?? '')
    }
  })
  d2.상점.forEach((sh: Record<string, string>, i: number) => {
    for (const f of ['상점명', '구분', '위치', '상점정보']) {
      fd.set(`상점[${i}].${f}`, sh[f] ?? '')
    }
  })

  const created = await fetch(`${BASE}/api/products`, { method: 'POST', headers: { cookie }, body: fd })
  const cb = await created.json().catch(() => ({}))
  check('POST /api/products 200 — 초안이 폼 검증을 통과한다',
    created.status === 200 && typeof cb.product_id === 'string', cb)

  if (typeof cb.product_id === 'string' && !process.env.KEEP) {
    await fetch(`${BASE}/api/products/${cb.product_id}`, { method: 'DELETE', headers: { cookie } })
    console.log('     (등록한 상품을 지웠다. 남기려면 KEEP=1)')
  }
}

console.log(`\n${'─'.repeat(60)}`)
console.log(`통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
