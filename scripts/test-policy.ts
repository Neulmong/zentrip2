/**
 * spec 2.4 판정 규칙 회귀 테스트.
 *
 * 목적은 커버리지가 아니라 **2.2로 되돌아가는 것을 막는 것**이다.
 * 각 케이스는 `.claude/skills/`가 2.2 시점에 갖고 있던 값으로 구현했을 때
 * 실제로 깨지는 지점을 재현한다.
 *
 *   npm run test:policy
 */
import { checkPrecondition, RESET_ON, ZERO_COUNTS, hasRetryBudget, resetCounters, COUNTER_AXIS } from '../lib/policy'
import { computeVerdict, discardAxes, withAxis, contentHash, passedAxis, failedAxis, axisPassed } from '../lib/validation'
import { maskName, maskEmail, maskPhone, maskPii } from '../lib/mask'
import { RETRY_COUNTERS, RETRY_LIMIT, type ProductRow, type ValidationSnapshot } from '../lib/types'
import { validateFormInput, buildFormInput, tripDays, hasDayMarker, combineTripPeriod } from '../lib/form-validation'

let pass = 0, fail = 0
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? `  → ${JSON.stringify(got)}` : ''}`) }
}
function section(t: string) { console.log(`\n${t}`) }

/** 최소 ProductRow 팩토리 */
function product(over: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p1', execution_id: 'e1', attempt_no: 1, slug: null,
    status: 'generating', current_step: 'pipeline_started',
    form_input: {} as ProductRow['form_input'],
    confirmed_data: null, brochure_content: null, page_content: null,
    validation_snapshot: null, retry_counts: { ...ZERO_COUNTS },
    human_edited: false, publish_override_at: null, failure_reason: null,
    published_at: null, created_at: '', updated_at: '',
    ...over,
  }
}
function snapshotWith(axes: Partial<ValidationSnapshot['axes']>): ValidationSnapshot {
  return {
    attempt_no: 1, verdict: 'pass', validated_at: '', content_hash: null,
    axes: { axis_0: null, axis_1: null, axis_2: null, axis_3: null, ...axes },
  }
}

/* ── B2. 시작 조건은 재료 기준이다 (§14.5) ───────────────────── */
section('B2 — 시작 조건: 재료 기준 (§14.5)')

// 2·3차 검증 실패 후 409 retry_from:5로 /page를 재호출하는 순간의 상태.
// 2.2는 `status = brochure_ready`만 허용해 이 재호출을 전부 거부했다.
check('2·3차 실패 후 /page 재호출 (status=generating) 허용',
  checkPrecondition('page', product({
    status: 'generating',
    brochure_content: {},
    validation_snapshot: snapshotWith({ axis_1: passedAxis() }),
  })) === null)

check('[상품 생성] 최초 진입 (status=brochure_ready) 허용',
  checkPrecondition('page', product({
    status: 'brochure_ready',
    brochure_content: {},
    validation_snapshot: snapshotWith({ axis_1: passedAxis() }),
  })) === null)

check('axis_1 = fail이면 /page 거부 (오류 증폭 방지)',
  checkPrecondition('page', product({
    status: 'brochure_ready',
    brochure_content: {},
    validation_snapshot: snapshotWith({ axis_1: failedAxis({} as never) }),
  })) !== null)

// current_step은 재시도 시점에 이미 앞서 나가 있다. 조건에 쓰면 안 된다.
check('current_step이 앞서 나가 있어도 /brochure 통과 (재료만 본다)',
  checkPrecondition('brochure', product({
    status: 'generating',
    current_step: 'validation_1_completed',
    confirmed_data: {},
    validation_snapshot: snapshotWith({ axis_0: passedAxis() }),
  })) === null)

check('generating에서 [처음부터 다시] 허용 (§15.1.1)',
  checkPrecondition('regenerate', product({ status: 'generating' })) === null)

check('draft 상품에 /decompose 재호출은 거부',
  checkPrecondition('decompose', product({ status: 'draft' })) !== null)

check('published 상품 편집 허용 (§14.5 #10)',
  checkPrecondition('content', product({ status: 'published', page_content: {} })) === null)

/* ── B1. 재시도 카운터 4종, 예산 비공유 (§11.6) ──────────────── */
section('B1 — 재시도 카운터 4종 (§11.6)')

check('카운터가 4종이다', RETRY_COUNTERS.length === 4, RETRY_COUNTERS)
check('normalization이 존재한다 (2.2는 3종이었다)',
  RETRY_COUNTERS.includes('normalization'))
check('기본값 4개 키가 모두 0',
  Object.keys(ZERO_COUNTS).length === 4 && Object.values(ZERO_COUNTS).every((v) => v === 0))

// 0차가 brochure를 공유하면 1차 예산이 깎인다 — 2.2의 실제 동작.
const afterZeroth = { ...ZERO_COUNTS, normalization: RETRY_LIMIT }
check('normalization 소진이 brochure 예산을 깎지 않는다',
  !hasRetryBudget(afterZeroth, 'normalization') && hasRetryBudget(afterZeroth, 'brochure'))

check('카운터-축 대응이 1:1',
  COUNTER_AXIS.normalization === 'axis_0' && COUNTER_AXIS.brochure === 'axis_1'
  && COUNTER_AXIS.page === 'axis_2' && COUNTER_AXIS.consistency === 'axis_3')

/* ── B4. 카운터 초기화 시점 (§11.6) ──────────────────────────── */
section('B4 — 카운터 초기화 시점 (§11.6)')

check('[상품 생성]은 page·consistency만 초기화',
  JSON.stringify(RESET_ON['product-create']) === JSON.stringify(['page', 'consistency']),
  RESET_ON['product-create'])

check('[다시 생성]은 4종 전부 초기화', RESET_ON.regenerate.length === 4)
check('재제출은 4종 전부 초기화', RESET_ON['form-resubmit'].length === 4)

// 소진 후 brochure_ready로 되돌아온 뒤 [상품 생성]을 다시 누르는 시나리오.
const exhausted = { normalization: 0, brochure: 0, page: RETRY_LIMIT, consistency: RETRY_LIMIT }
const reset = resetCounters(exhausted, RESET_ON['product-create'])
check('소진 후 [상품 생성] 재시도가 즉시 실패하지 않는다',
  hasRetryBudget(reset, 'page') && hasRetryBudget(reset, 'consistency'))

/* ── §11.3 최상위 verdict 계산 ───────────────────────────────── */
section('§11.3 — verdict 계산')

check('미실행 축(null)은 계산에서 제외',
  computeVerdict(snapshotWith({ axis_0: passedAxis(), axis_1: passedAxis() }).axes) === 'pass')
check('한 축이라도 fail이면 fail',
  computeVerdict(snapshotWith({ axis_0: passedAxis(), axis_2: failedAxis({} as never) }).axes) === 'fail')

const snap = withAxis(null, 1, 'axis_0', passedAxis())
check('withAxis가 축을 기록하고 verdict를 재계산', axisPassed(product({ validation_snapshot: snap }), 'axis_0'))

/* ── §15.3 [다시 생성] 축 폐기 범위 ──────────────────────────── */
section('§15.3 — 축 폐기 범위')

const full = snapshotWith({
  axis_0: passedAxis(), axis_1: passedAxis(), axis_2: passedAxis(), axis_3: passedAxis(),
})
const fromPage = discardAxes(full, 2, ['axis_2', 'axis_3'])
check('draft에서 재생성: axis_0·axis_1 보존',
  fromPage.axes.axis_0?.verdict === 'pass' && fromPage.axes.axis_1?.verdict === 'pass')
check('draft에서 재생성: axis_2·axis_3 폐기',
  fromPage.axes.axis_2 === null && fromPage.axes.axis_3 === null)
// 통째로 비우면 §14.5의 `axis_1 = pass` 조건을 못 채워 재실행 자체가 거부된다.
check('폐기 후에도 /page 시작 조건 충족',
  checkPrecondition('page', product({
    status: 'generating', brochure_content: {}, validation_snapshot: fromPage,
  })) === null)

/* ── §11.3 content_hash ──────────────────────────────────────── */
section('§11.3 — content_hash')

check('키 순서가 달라도 같은 해시',
  contentHash({ b: 1, a: { d: 2, c: 3 } }) === contentHash({ a: { c: 3, d: 2 }, b: 1 }))
check('내용이 다르면 다른 해시', contentHash({ a: 1 }) !== contentHash({ a: 2 }))
check('sha256: 접두사', contentHash({}).startsWith('sha256:'))

/* ── §5.4 개인정보 마스킹 ────────────────────────────────────── */
section('§5.4 — 개인정보 마스킹')

check('이름', maskName('홍길동') === '홍*동', maskName('홍길동'))
check('이메일', maskEmail('hong@example.com') === 'ho***@example.com', maskEmail('hong@example.com'))
check('연락처', maskPhone('010-1234-5678') === '010-****-5678', maskPhone('010-1234-5678'))

const masked = maskPii({
  name: '홍길동', email: 'hong@example.com', phone: '01012345678',
  headcount: 2, product_snapshot: { 행사명: '제주 올레 바람 여행' },
}) as Record<string, unknown>
check('중첩 객체 재귀 마스킹',
  masked.name === '홍*동' && masked.email === 'ho***@example.com' && masked.phone === '010-****-5678')
check('개인정보가 아닌 값은 원본 유지',
  masked.headcount === 2
  && (masked.product_snapshot as Record<string, unknown>).행사명 === '제주 올레 바람 여행')

/* ── §7.1·§6.2.1 폼 검증 ────────────────────────────────────── */
section('§7.1·§6.2.1 — 폼 검증')

check('일수는 양끝 포함 — 하루 여행은 1일', tripDays('2026-03-14', '2026-03-14') === 1)
check('3/14~3/17은 4일', tripDays('2026-03-14', '2026-03-17') === 4)

function form(over: Record<string, string> = {}) {
  return buildFormInput({
    행사명: '제주 올레 바람 여행', 여행지: '제주',
    여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
    일정원문: '1일: 김해공항 출발, 올레 7코스 걷기, 중식·석식 제공\n2일: 성산일출봉 관람',
    숙소명: '롯데호텔 제주', 객실타입: '디럭스룸', 위치: '중문',
    상점명: '제주 로컬 기념품 숍', 상점정보: '여행객 10% 할인',
    가격_성인: '120000', 가격_아동: '해당 없음', 가격_기타: '항공료 별도',
    식사정보: '조식 3회, 중식 2회, 석식 1회',
    ...over,
  })
}

check('정상 입력은 오류 0건', Object.keys(validateFormInput(form())).length === 0,
  validateFormInput(form()))
check('15일은 통과',
  !validateFormInput(form({ 여행기간_종료: '2026-03-28' }))['행사정보.여행기간_종료'])
check('16일은 거부 (§6.2.1 상한)',
  !!validateFormInput(form({ 여행기간_종료: '2026-03-29' }))['행사정보.여행기간_종료'])
check('종료일이 시작일보다 이르면 거부',
  !!validateFormInput(form({ 여행기간_종료: '2026-03-13' }))['행사정보.여행기간_종료'])
check('행사명 40자 초과 거부 (hero.headline 계약과 연동 §17.1)',
  !!validateFormInput(form({ 행사명: '가'.repeat(41) }))['행사정보.행사명'])

// 일차 구분 인식 6종 (§6.3) — 이 목록이 실패 판정의 기준이다
for (const [label, text] of [
  ['n일', '1일: 김해공항 출발하여 올레길을 걷습니다'],
  ['n일차', '1일차 김해공항 출발하여 올레길을 걷습니다'],
  ['n일 차', '1일 차 김해공항 출발하여 올레길을 걷습니다'],
  ['첫째 날', '첫째 날 김해공항 출발하여 올레길을 걷습니다'],
  ['Day n', 'Day 1 김해공항 출발하여 올레길을 걷습니다'],
  ['DAY n', 'DAY 1 김해공항 출발하여 올레길을 걷습니다'],
] as const) {
  check(`일차 구분 인식: ${label}`, hasDayMarker(text))
}
check('일차 구분이 없으면 거부 (임의 배분 금지)',
  !!validateFormInput(form({ 일정원문: '제주도의 아름다운 풍경을 즐기는 여행입니다. 맛집도 갑니다.' }))['행사정보.일정원문'])

// §7.4 구조
const f = form()
check('form_input은 중첩 구조 (평면 키 아님)',
  f.행사정보?.행사명 === '제주 올레 바람 여행' && !('행사명' in f))
check('여행기간은 2필드 — 결합은 confirmed_data에서만 (§6.2.1)',
  f.행사정보.여행기간_시작 === '2026-03-14' && f.행사정보.여행기간_종료 === '2026-03-17'
  && !('여행기간' in f.행사정보))
check('미입력 선택 항목은 빈 문자열 — `추후 추가 예정`은 confirmed_data에서만 (§7.4)',
  f.행사정보.타겟층 === '' && f.숙박.숙박일정 === '' && f.항공편.공항 === '')
check('금액은 {숫자}원 문자열 (§6.2)', f.가격.성인 === '120000원')
check('아동 미운영은 `해당 없음` 그대로 (0원 표시 방지 §6.1)', f.가격.아동 === '해당 없음')
check('여행기간 결합 형식 — 물결표 앞뒤 공백 1칸',
  combineTripPeriod('2026-03-14', '2026-03-17') === '2026-03-14 ~ 2026-03-17')

/* ── 결과 ────────────────────────────────────────────────────── */
console.log(`\n${'─'.repeat(52)}`)
console.log(`통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
