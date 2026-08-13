/**
 * **AI 파이프라인 케이스 스위트** — 골든 10 + 에러 5.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:cases          # 기본: 골든 상품을 지운다
 *   KEEP=1 npm run test:cases   # 브라우저로 볼 수 있게 남긴다
 *
 * 골든 10 = 서로 다른 지역·기간·일차마커·여행스타일·요금의 유효 입력을 **전체
 * 파이프라인**(등록 → 분해 → 소개서 → 1차 → 페이지 → 2차 → 3차)에 통과시켜
 * `draft` + 4축 pass를 확인한다. 각 골든이 AI 5회를 쓴다 → **골든만 AI 50회.**
 *
 * 에러 5 = 관문(§16.2)에서 거부돼야 하는 입력. `POST /api/products`가 400 +
 * `field_errors[지정 칸]`을 돌려주고 **파이프라인을 시작하지 않는다.** AI 0회 —
 * 그것이 관문의 목적이다(나쁜 입력에 AI 예산을 쓰지 않는다).
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const KEEP = process.env.KEEP === '1'
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

let pass = 0, fail = 0
const failures: string[] = []
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${n}`) }
  else {
    fail++; failures.push(n)
    console.log(`  ❌ ${n}${got !== undefined ? `\n       → ${JSON.stringify(got)}` : ''}`)
  }
}
const T0 = Date.now()
const at = () => `${((Date.now() - T0) / 1000).toFixed(0)}초`

/* ── 로그인 ─────────────────────────────────────────────────── */
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
})
if (!login.ok) { console.error('로그인 실패 — dev 서버·ADMIN_PASSWORD 확인'); process.exit(1) }
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const toFD = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

/* ── 골든 픽스처 10 — 데모 규모(숙소 1~2·상점 1~3)로 유지해 예산을 지킨다 ── */
type Fx = Record<string, string>
const 기본요금 = { 가격_성인: '120000', 가격_아동: '해당 없음', 가격_기타: '항공료 별도' }

const GOLDENS: { name: string; f: Fx }[] = [
  { name: 'G01 제주 4일·자연·"n일" 마커', f: {
    행사명: '제주 올레 걷기 여행', 여행지: '제주', 여행스타일: '자연', 여행주제: '제주 걷기와 로컬 맛집 휴식',
    여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
    일정원문: '1일: 김해공항 출발, 올레 7코스 걷기, 중식·석식 제공\n2일: 성산일출봉, 해녀박물관 관람, 조식·중식\n3일: 자유 일정, 조식\n4일: 귀국',
    '숙박[0].숙소명': '롯데호텔 제주', '숙박[0].위치': '중문', '숙박[0].객실타입': '디럭스룸', '숙박[0].숙박일정': '1~2박',
    '숙박[1].숙소명': '성산 한옥스테이 고요', '숙박[1].위치': '성산읍', '숙박[1].객실타입': '', '숙박[1].숙박일정': '3박',
    '상점[0].상점명': '제주 로컬 기념품 숍', '상점[0].구분': '제휴', '상점[0].위치': '중문관광로 72', '상점[0].상점정보': '10% 할인',
    '상점[1].상점명': '성산 바다뷰 카페', '상점[1].구분': '추천', '상점[1].위치': '해맞이해안로 1', '상점[1].상점정보': '',
    '상점[2].상점명': '올레 국수집', '상점[2].구분': '추천', '상점[2].위치': '', '상점[2].상점정보': '',
    식사정보: '조식 3회, 중식 2회, 석식 1회', ...기본요금,
  } },
  { name: 'G02 부산 3일·미식·아동 유료', f: {
    행사명: '부산 미식 기행', 여행지: '부산', 여행스타일: '미식', 여행주제: '바다와 시장 먹거리',
    여행기간_시작: '2026-03-20', 여행기간_종료: '2026-03-22',
    일정원문: '1일: 김해공항 도착, 자갈치시장 회 투어\n2일: 감천문화마을, 국제시장 먹거리\n3일: 해운대 산책 후 귀가',
    '숙박[0].숙소명': '해운대 그랜드호텔', '숙박[0].위치': '해운대구', '숙박[0].객실타입': '오션뷰', '숙박[0].숙박일정': '2박',
    '상점[0].상점명': '자갈치 회센터', '상점[0].구분': '추천', '상점[0].위치': '자갈치로', '상점[0].상점정보': '',
    '상점[1].상점명': '국제시장 씨앗호떡', '상점[1].구분': '제휴', '상점[1].위치': '신창동', '상점[1].상점정보': '여행객 서비스',
    식사정보: '조식 2회 포함', 가격_성인: '250000', 가격_아동: '180000', 가격_기타: '',
  } },
  { name: 'G03 속초 2일·휴양·최소 구성', f: {
    행사명: '속초 힐링 1박2일', 여행지: '속초', 여행스타일: '휴양', 여행주제: '바다와 산의 재충전',
    여행기간_시작: '2026-04-01', 여행기간_종료: '2026-04-02',
    일정원문: '1일: 속초 도착, 영금정 해안 산책과 대포항 저녁\n2일: 설악산 케이블카 후 귀가',
    '숙박[0].숙소명': '속초 오션스위트', '숙박[0].위치': '조양동', '숙박[0].객실타입': '스위트', '숙박[0].숙박일정': '1박',
    '상점[0].상점명': '중앙시장 닭강정', '상점[0].구분': '추천', '상점[0].위치': '중앙로', '상점[0].상점정보': '',
    식사정보: '조식 1회 포함', 가격_성인: '300000', 가격_아동: '해당 없음', 가격_기타: '',
  } },
  { name: 'G04 전주 5일·도심·"Day n" 마커', f: {
    행사명: '전주 한옥마을 5일', 여행지: '전주', 여행스타일: '도심', 여행주제: '한옥과 골목 미식',
    여행기간_시작: '2026-05-01', 여행기간_종료: '2026-05-05',
    일정원문: 'Day 1: 전주 도착, 한옥마을 산책\nDay 2: 경기전과 전동성당\nDay 3: 남부시장 로컬 미식\nDay 4: 근교 나들이\nDay 5: 귀가',
    '숙박[0].숙소명': '한옥마을 게스트하우스', '숙박[0].위치': '풍남동', '숙박[0].객실타입': '한실', '숙박[0].숙박일정': '2박',
    '숙박[1].숙소명': '전주 시티호텔', '숙박[1].위치': '서신동', '숙박[1].객실타입': '트윈', '숙박[1].숙박일정': '2박',
    '상점[0].상점명': 'PNB 풍년제과', '상점[0].구분': '추천', '상점[0].위치': '경원동', '상점[0].상점정보': '',
    '상점[1].상점명': '한옥마을 공방', '상점[1].구분': '제휴', '상점[1].위치': '교동', '상점[1].상점정보': '체험 할인',
    식사정보: '조식 4회 포함', ...기본요금,
  } },
  { name: 'G05 여수 3일·문화역사·"첫째 날" 마커', f: {
    행사명: '여수 밤바다 3일', 여행지: '여수', 여행스타일: '문화·역사', 여행주제: '섬과 항구의 밤',
    여행기간_시작: '2026-05-10', 여행기간_종료: '2026-05-12',
    일정원문: '첫째 날: 여수 도착, 오동도 산책\n둘째 날: 해상케이블카, 이순신광장\n셋째 날: 아침 시장 후 귀가',
    '숙박[0].숙소명': '여수 베이호텔', '숙박[0].위치': '수정동', '숙박[0].객실타입': '오션뷰', '숙박[0].숙박일정': '2박',
    '상점[0].상점명': '교동시장 게장골목', '상점[0].구분': '추천', '상점[0].위치': '교동', '상점[0].상점정보': '',
    '상점[1].상점명': '낭만포차거리', '상점[1].구분': '추천', '상점[1].위치': '중앙동', '상점[1].상점정보': '',
    식사정보: '조식 2회 포함', ...기본요금,
  } },
  { name: 'G06 강릉 5일·액티비티', f: {
    행사명: '강릉 바다 액티비티', 여행지: '강릉', 여행스타일: '액티비티', 여행주제: '서핑과 트레킹',
    여행기간_시작: '2026-06-01', 여행기간_종료: '2026-06-05',
    일정원문: '1일: 강릉 도착, 경포해변\n2일: 사천해변 서핑 강습\n3일: 안반데기 트레킹\n4일: 정동진 자전거\n5일: 귀가',
    '숙박[0].숙소명': '강릉 씨마크호텔', '숙박[0].위치': '강문동', '숙박[0].객실타입': '오션뷰', '숙박[0].숙박일정': '3박',
    '숙박[1].숙소명': '정동진 펜션', '숙박[1].위치': '강동면', '숙박[1].객실타입': '', '숙박[1].숙박일정': '1박',
    '상점[0].상점명': '초당순두부마을', '상점[0].구분': '추천', '상점[0].위치': '초당동', '상점[0].상점정보': '',
    '상점[1].상점명': '안목해변 커피거리', '상점[1].구분': '추천', '상점[1].위치': '견소동', '상점[1].상점정보': '',
    '상점[2].상점명': '서핑샵 웨이브', '상점[2].구분': '제휴', '상점[2].위치': '사천면', '상점[2].상점정보': '장비 대여 할인',
    식사정보: '조식 4회 포함', ...기본요금,
  } },
  { name: 'G07 경주 4일·자연·아동 0원', f: {
    행사명: '경주 역사 답사', 여행지: '경주', 여행스타일: '자연', 여행주제: '역사 답사와 미식 그리고 휴식',
    여행기간_시작: '2026-06-10', 여행기간_종료: '2026-06-13',
    일정원문: '1일: 경주 도착, 대릉원\n2일: 불국사와 석굴암\n3일: 첨성대, 동궁과 월지 야경\n4일: 귀가',
    '숙박[0].숙소명': '경주 힐튼', '숙박[0].위치': '신평동', '숙박[0].객실타입': '디럭스', '숙박[0].숙박일정': '2박',
    '숙박[1].숙소명': '한옥마을 라한셀렉트', '숙박[1].위치': '황남동', '숙박[1].객실타입': '한실', '숙박[1].숙박일정': '1박',
    '상점[0].상점명': '황리단길 카페거리', '상점[0].구분': '추천', '상점[0].위치': '황남동', '상점[0].상점정보': '',
    '상점[1].상점명': '경주빵 본점', '상점[1].구분': '제휴', '상점[1].위치': '노동동', '상점[1].상점정보': '증정',
    // 요금은 **숫자만** 보낸다 — `buildFormInput`이 `원`을 붙인다. `0원`을 보내면 `0원원`이 된다
    식사정보: '조식 3회 포함', 가격_성인: '150000', 가격_아동: '0', 가격_기타: '',
  } },
  { name: 'G08 통영 2일·휴양·선택항목 전부 빈칸', f: {
    행사명: '통영 바다 나들이', 여행지: '통영', 여행스타일: '휴양', 여행주제: '',
    여행기간_시작: '2026-07-01', 여행기간_종료: '2026-07-02',
    일정원문: '1일: 통영 도착, 동피랑 벽화마을\n2일: 케이블카, 중앙시장 후 귀가',
    타겟층: '', 기획메모: '',
    '숙박[0].숙소명': '통영 마리나리조트', '숙박[0].위치': '도남동', '숙박[0].객실타입': '', '숙박[0].숙박일정': '',
    '상점[0].상점명': '중앙시장 충무김밥', '상점[0].구분': '추천', '상점[0].위치': '중앙동', '상점[0].상점정보': '',
    식사정보: '조식 1회 포함', 가격_성인: '180000', 가격_아동: '해당 없음', 가격_기타: '',
  } },
  { name: 'G09 안동 4일·문화역사·기획메모(페르소나)', f: {
    행사명: '안동 고택 여행', 여행지: '안동', 여행스타일: '문화·역사', 여행주제: '고택과 서원',
    여행기간_시작: '2026-07-10', 여행기간_종료: '2026-07-13',
    일정원문: '1일: 안동 도착, 하회마을\n2일: 도산서원, 봉정사\n3일: 월영교 야경과 구시장\n4일: 귀가',
    기획메모: '30대 직장인 부부, 번잡함을 피해 조용한 재충전을 원한다',
    '숙박[0].숙소명': '안동 그랜드호텔', '숙박[0].위치': '운흥동', '숙박[0].객실타입': '스탠다드', '숙박[0].숙박일정': '3박',
    '상점[0].상점명': '안동찜닭골목', '상점[0].구분': '추천', '상점[0].위치': '서부동', '상점[0].상점정보': '',
    '상점[1].상점명': '맘모스제과', '상점[1].구분': '제휴', '상점[1].위치': '남부동', '상점[1].상점정보': '증정 서비스',
    식사정보: '조식 3회 포함', ...기본요금,
  } },
  { name: 'G10 서울 3일·도심·미식', f: {
    행사명: '서울 도심 미식 3일', 여행지: '서울', 여행스타일: '도심', 여행주제: '고궁과 시장 먹거리',
    여행기간_시작: '2026-08-01', 여행기간_종료: '2026-08-03',
    일정원문: '1일: 서울 도착, 북촌한옥마을\n2일: 경복궁, 광장시장 먹거리\n3일: 남산타워 후 귀가',
    '숙박[0].숙소명': '명동 로얄호텔', '숙박[0].위치': '중구 명동', '숙박[0].객실타입': '디럭스', '숙박[0].숙박일정': '2박',
    '상점[0].상점명': '광장시장 마약김밥', '상점[0].구분': '추천', '상점[0].위치': '종로4가', '상점[0].상점정보': '',
    '상점[1].상점명': '북촌 전통찻집', '상점[1].구분': '추천', '상점[1].위치': '가회동', '상점[1].상점정보': '',
    '상점[2].상점명': '명동교자', '상점[2].구분': '제휴', '상점[2].위치': '명동10길', '상점[2].상점정보': '음료 서비스',
    식사정보: '조식 2회 포함', ...기본요금,
  } },
]

/* ── 에러 픽스처 5 — 관문에서 지정 칸이 거부돼야 한다 ─────────── */
const 유효기본: Fx = {
  행사명: '기준 유효 여행', 여행지: '제주', 여행스타일: '자연', 여행주제: '걷기',
  여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-16',
  일정원문: '1일: 도착과 올레길 걷기\n2일: 성산일출봉 관람\n3일: 귀가',
  '숙박[0].숙소명': '제주 호텔', '숙박[0].위치': '제주시', '숙박[0].객실타입': '', '숙박[0].숙박일정': '',
  '상점[0].상점명': '제주 카페', '상점[0].구분': '추천', '상점[0].위치': '', '상점[0].상점정보': '',
  식사정보: '조식 2회', 가격_성인: '120000', 가격_아동: '해당 없음', 가격_기타: '',
}
const 에러기본없이 = (드롭: string[], override: Fx): Fx => {
  const f = { ...유효기본, ...override }
  for (const k of 드롭) delete f[k]
  return f
}
const ERRORS: { name: string; f: Fx; key: string }[] = [
  { name: 'E01 행사명 하한 미달(1자)', key: '행사정보.행사명', f: { ...유효기본, 행사명: '제' } },
  { name: 'E02 일정원문 일차 마커 없음', key: '행사정보.일정원문', f: {
    ...유효기본, 일정원문: '공항에 도착해 올레길을 걷고 성산일출봉을 방문한 뒤 자유시간을 갖고 귀가한다',
  } },
  { name: 'E03 종료일 < 시작일', key: '행사정보.여행기간_종료', f: {
    ...유효기본, 여행기간_시작: '2026-03-17', 여행기간_종료: '2026-03-14',
  } },
  { name: 'E04 숙박 0건', key: '숙박', f: 에러기본없이(
    ['숙박[0].숙소명', '숙박[0].위치', '숙박[0].객실타입', '숙박[0].숙박일정'], {}) },
  { name: 'E05 상점 구분 열거값 위반(협력)', key: '상점[0].구분', f: { ...유효기본, '상점[0].구분': '협력' } },
]

/* ── 파이프라인 구동 (test-real와 동일 규율) ─────────────────── */
const 실패축 = (body: unknown): string | null => {
  const axes = (body as { axes?: Record<string, { verdict?: string } | null> })?.axes
  for (const [name, r] of Object.entries(axes ?? {})) if (r?.verdict === 'fail') return name
  return null
}

async function runPipeline(pid: string): Promise<{ ok: boolean; note: string }> {
  let updatedAt: string | undefined = await (async () => {
    const r = await fetch(`${BASE}/api/products/${pid}`, { headers: { cookie } })
    const b = await r.json().catch(() => ({}))
    return typeof b?.updated_at === 'string' ? b.updated_at : undefined
  })()

  const post = async (path: string) => {
    const r = await fetch(`${BASE}/api/products/${pid}/${path}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(updatedAt ? { updated_at: updatedAt } : {}),
    })
    const body = await r.json().catch(() => ({}))
    const next = (body as { updated_at?: unknown })?.updated_at
    if (typeof next === 'string') updatedAt = next
    return { status: r.status, body }
  }
  const step = async (path: string, tries = 3) => {
    for (let n = 1; n <= tries; n++) {
      const t = Date.now()
      const r = await post(path)
      const 초 = ((Date.now() - t) / 1000).toFixed(1)
      if (r.status === 200) { console.log(`       ${path} 200 · ${초}초`); return r }
      if (r.status === 409 && r.body?.reason === 'retry') {
        const w = Number(r.body.retry_after_ms ?? 2000)
        console.log(`       ↻ ${path} 409 retry · ${초}초 (${n}/${tries})`)
        await new Promise((res) => setTimeout(res, w)); continue
      }
      console.log(`       ${path} ${r.status} · ${초}초 ${JSON.stringify(r.body).slice(0, 120)}`)
      return r
    }
    return post(path)
  }

  for (const path of ['decompose', 'brochure', 'validate-brochure', 'page', 'validate-page', 'validate-consistency']) {
    const r = await step(path)
    const f = 실패축(r.body)
    if (r.status !== 200 || f) {
      return { ok: false, note: `${path} ${r.status}${f ? ` · 축 ${f} fail` : ''}` }
    }
  }
  return { ok: true, note: '' }
}

async function cleanup(pid: string, execId: string | undefined) {
  if (KEEP) return
  await db.from('applications').delete().eq('product_id', pid)
  if (execId) {
    await db.from('execution_logs').delete().eq('execution_id', execId)
    await db.from('abnormality_flags').delete().eq('execution_id', execId)
  }
  await db.from('products').delete().eq('id', pid)
}

/* ══ 골든 10 ══════════════════════════════════════════════════ */
console.log('\n═══════════════ 골든 10 — 전체 파이프라인 통과 기대 (AI 5회/건) ═══════════════')
const 남긴상품: string[] = []
for (const g of GOLDENS) {
  console.log(`\n${g.name}  [${at()}]`)
  const created = await (await fetch(`${BASE}/api/products`, {
    method: 'POST', headers: { cookie }, body: toFD(g.f),
  })).json().catch(() => ({}))
  if (!created.product_id) { check(`${g.name} 등록`, false, created); continue }
  const pid: string = created.product_id
  const result = await runPipeline(pid)
  if (!result.ok) { check(`${g.name} 파이프라인 통과`, false, result.note); await cleanup(pid, created.execution_id); continue }

  const row = (await db.from('products').select('status, validation_snapshot').eq('id', pid).single()).data as {
    status: string; validation_snapshot: { axes?: Record<string, { verdict?: string } | null> } | null
  }
  const 축pass = ['axis_0', 'axis_1', 'axis_2', 'axis_3'].every(
    (a) => row.validation_snapshot?.axes?.[a]?.verdict === 'pass')
  check(`${g.name} → draft + 4축 pass`, row.status === 'draft' && 축pass,
    { status: row.status, axes: row.validation_snapshot?.axes })
  if (KEEP) 남긴상품.push(`${BASE}/admin/products/${pid}`)
  else await cleanup(pid, created.execution_id)
}

/* ══ 에러 5 ═══════════════════════════════════════════════════ */
console.log('\n═══════════════ 에러 5 — 관문에서 거부 기대 (AI 0회) ═══════════════')
for (const e of ERRORS) {
  const r = await fetch(`${BASE}/api/products`, { method: 'POST', headers: { cookie }, body: toFD(e.f) })
  const body = await r.json().catch(() => ({}))
  const fe = (body as { field_errors?: Record<string, string> })?.field_errors ?? {}
  check(`${e.name} → 400 + ${e.key}`, r.status === 400 && !!fe[e.key],
    { status: r.status, field_errors: Object.keys(fe) })
  // 관문이 거부했으면 행이 없어야 한다 — 부작용 확인
  if (r.status === 400 && (body as { product_id?: string }).product_id) {
    check(`${e.name} 부작용 없음`, false, '400인데 product_id가 있다')
  }
}

/* ══ 결과 ═════════════════════════════════════════════════════ */
console.log(`\n${'─'.repeat(64)}`)
console.log(`통과 ${pass} · 실패 ${fail} · 총 ${at()}  (골든 ${GOLDENS.length} + 에러 ${ERRORS.length})`)
if (failures.length) console.log('실패:', failures.join(' · '))
if (KEEP && 남긴상품.length) {
  console.log('\n남긴 골든 상품 (브라우저 확인용):')
  for (const u of 남긴상품) console.log(`  ${u}`)
}
if (fail > 0) process.exit(1)
