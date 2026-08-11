/**
 * spec 2.4 판정 규칙 회귀 테스트.
 *
 * 목적은 커버리지가 아니라 **2.2로 되돌아가는 것을 막는 것**이다.
 * 각 케이스는 `.claude/skills/`가 2.2 시점에 갖고 있던 값으로 구현했을 때
 * 실제로 깨지는 지점을 재현한다.
 *
 *   npm run test:policy
 */
import { checkPrecondition, RESET_ON, ZERO_COUNTS, hasRetryBudget, resetCounters, COUNTER_AXIS, planRestart, RESUBMIT_PLAN } from '../lib/policy'
import { computeVerdict, discardAxes, withAxis, contentHash, passedAxis, failedAxis, axisPassed } from '../lib/validation'
import { maskName, maskEmail, maskPhone, maskPii } from '../lib/mask'
import { RETRY_COUNTERS, RETRY_LIMIT, type ProductRow, type ValidationSnapshot } from '../lib/types'
import { validateFormInput, buildFormInput, tripDays, hasDayMarker, combineTripPeriod } from '../lib/form-validation'
import { describeStatus, screenPath, verificationBadge, editBadge } from '../lib/status-view'

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

/* ── R15. 되돌림 범위 (§15.3 · §15.1.1) ───────────────────────
 * 너무 많이 지우면 §14.5의 시작 조건을 못 넘겨 재실행 자체가 거부되고,
 * 너무 적게 지우면 사라진 소개서를 가리키는 페이지가 남는다.
 * ──────────────────────────────────────────────────────────── */
section('R15 — 되돌림 범위 (§15.3)')

const planOf = (over: Partial<ProductRow>) => planRestart(product(over))

// [다시 생성] — 상태로 시작점을 정한다
check('brochure_ready → §8.3③ /brochure부터',
  planOf({ status: 'brochure_ready' }).from === 3)
check('brochure_ready는 axis_1=pass여도 ③이다 (소개서를 다시 만드는 버튼이므로)',
  planOf({
    status: 'brochure_ready',
    validation_snapshot: snapshotWith({ axis_0: passedAxis(), axis_1: passedAxis() }),
  }).from === 3)
check('draft → §9.5① /page부터', planOf({ status: 'draft' }).from === 5)

// [처음부터 다시] — generating은 진행 지점을 모르므로 축으로 판정한다 (§15.1.1)
check('generating + axis_1=pass → ⑤',
  planOf({
    status: 'generating',
    validation_snapshot: snapshotWith({ axis_0: passedAxis(), axis_1: passedAxis() }),
  }).from === 5)
check('generating + axis_0만 pass → ③',
  planOf({
    status: 'generating', validation_snapshot: snapshotWith({ axis_0: passedAxis() }),
  }).from === 3)
check('generating + 통과 축 없음 → ②',
  planOf({ status: 'generating', validation_snapshot: null }).from === 2)
check('generating + axis_0=fail → ② (fail은 pass가 아니다)',
  planOf({
    status: 'generating', validation_snapshot: snapshotWith({ axis_0: failedAxis({} as never) }),
  }).from === 2)

/**
 * 시작점 **이전** 축은 반드시 남는다. 통째로 비우면 §14.5의
 * `axis_0 = pass`·`axis_1 = pass` 조건을 못 넘겨 재실행이 첫 호출에서 거부된다.
 */
check('③ 시작 — axis_0을 보존한다 (§14.5 #3 조건)',
  !planOf({ status: 'brochure_ready' }).discard.includes('axis_0'))
check('⑤ 시작 — axis_0·axis_1을 보존한다 (§14.5 #5 조건)',
  !planOf({ status: 'draft' }).discard.some((a) => a === 'axis_0' || a === 'axis_1'))
check('② 시작 — 4개 축 전부 폐기',
  planOf({ status: 'generating' }).discard.length === 4)

// 산출물은 「시작점 이후 전부」 — 사라진 소개서를 가리키는 페이지를 남기지 않는다
check('③ 시작 — brochure_content와 page_content를 함께 비운다',
  JSON.stringify(planOf({ status: 'brochure_ready' }).clear.sort())
  === JSON.stringify(['brochure_content', 'page_content']))
check('③ 시작 — confirmed_data는 보존 (§15.3 보존 목록)',
  !planOf({ status: 'brochure_ready' }).clear.includes('confirmed_data'))
check('⑤ 시작 — page_content만 비운다',
  JSON.stringify(planOf({ status: 'draft' }).clear) === JSON.stringify(['page_content']))

// current_step은 시작점의 **직전** 단계로 되돌린다
check('③ 시작 — current_step = normalization_validated',
  planOf({ status: 'brochure_ready' }).currentStep === 'normalization_validated')
check('⑤ 시작 — current_step = validation_1_completed',
  planOf({ status: 'draft' }).currentStep === 'validation_1_completed')

// 입력 재제출은 언제나 ②부터 (§14.4 #17)
check('입력 재제출 — 언제나 ②, 4축 폐기, 산출물 3종 전부 비움',
  RESUBMIT_PLAN.from === 2 && RESUBMIT_PLAN.discard.length === 4
  && RESUBMIT_PLAN.clear.length === 3)

/* ── S15. 상태 × 화면 × 버튼 (§15.1) ──────────────────────────
 * 이 표는 목록·상세·편집기 세 화면이 공유하므로, 어긋나면 화면마다
 * 다른 버튼이 뜬다. spec이 「단일 출처」라고 못박은 지점이다.
 * ──────────────────────────────────────────────────────────── */
section('S15 — 상태 × 화면 × 버튼 (§15.1)')

const keysOf = (p: ProductRow) => describeStatus(p).buttons.map((b) => b.key)
const btn = (p: ProductRow, k: string) => describeStatus(p).buttons.find((b) => b.key === k)
const passSnap = snapshotWith({ axis_0: passedAxis(), axis_1: passedAxis() })
const failSnap: ValidationSnapshot = {
  ...snapshotWith({ axis_1: failedAxis({} as never) }), verdict: 'fail',
}

// 표시 이름 7종 — DB의 영어 status를 화면에 그대로 쓰지 않는다
for (const [status, label] of [
  ['generating', '처리중'], ['input_error', '입력오류'], ['brochure_ready', '소개서 완료'],
  ['draft', '임시저장'], ['reviewing', '검토중'], ['published', '게시됨'],
  ['unpublished', '게시중단'],
] as const) {
  check(`표시 이름: ${status} → ${label}`,
    describeStatus(product({ status, validation_snapshot: passSnap })).label === label)
}

// generating은 복구 버튼 2개를 가진 유일한 상태다 (§15.1.1)
check('generating에만 [이어서 진행]·[처음부터 다시]',
  JSON.stringify(keysOf(product({ status: 'generating' }))) === '["resume","restart"]')

// brochure_ready + fail: [상품 생성]을 **숨기지 않고 잠근다**.
// 숨기면 기획자가 왜 다음으로 못 가는지 알 수 없다.
check('brochure_ready+pass — [상품 생성] 활성',
  btn(product({ status: 'brochure_ready', validation_snapshot: passSnap }), 'create-page')?.disabled !== true)
check('brochure_ready+fail — [상품 생성]은 보이되 잠김 (숨기지 않는다)',
  btn(product({ status: 'brochure_ready', validation_snapshot: failSnap }), 'create-page')?.disabled === true)
check('brochure_ready+fail — 잠금 사유를 함께 준다',
  !!btn(product({ status: 'brochure_ready', validation_snapshot: failSnap }), 'create-page')?.disabledReason)
check('brochure_ready+fail — 실패 항목을 함께 보여준다',
  describeStatus(product({ status: 'brochure_ready', validation_snapshot: failSnap })).showsFailedItems)

/**
 * §15.1의 명시 규칙: reviewing·published·unpublished에는 [다시 생성]이 없다.
 * 사람이 편집한 내용이 사라지기 때문이다. 여기가 빠지면 편집분이 날아간다.
 */
for (const status of ['reviewing', 'published', 'unpublished'] as const) {
  check(`${status}에는 [다시 생성]을 제공하지 않는다`,
    !keysOf(product({ status, validation_snapshot: passSnap })).includes('regenerate'))
}
check('draft에는 [다시 생성]이 있다',
  keysOf(product({ status: 'draft', validation_snapshot: passSnap })).includes('regenerate'))

// 게시 게이트 (§11.5) — 버튼은 하나, 절차만 verdict로 갈린다
check('verdict=fail → [책임 게시] 표기 + 확인 문구',
  btn(product({ status: 'draft', validation_snapshot: failSnap }), 'publish')?.label === '책임 게시'
  && !!btn(product({ status: 'draft', validation_snapshot: failSnap }), 'publish')?.confirm)
check('verdict=pass + 편집 없음 → [게시], 확인 모달 없음',
  btn(product({ status: 'draft', validation_snapshot: passSnap }), 'publish')?.confirm === undefined)
check('verdict=pass + 사람 편집됨 → 확인 모달 (편집분은 검증 대상이 아니다 §10.4)',
  !!btn(product({ status: 'draft', validation_snapshot: passSnap, human_edited: true }), 'publish')?.confirm)
check('검증 스냅샷이 없으면 게시 불가 — 미검증을 통과로 읽지 않는다',
  btn(product({ status: 'draft', validation_snapshot: null }), 'publish')?.disabled === true)
check('input_error에는 게시 경로가 없다 (§11.5)',
  !keysOf(product({ status: 'input_error' })).includes('publish'))
check('[다시 생성] + 편집분 있음 → 사라진다는 확인을 받는다 (§15.3)',
  !!btn(product({ status: 'draft', validation_snapshot: passSnap, human_edited: true }), 'regenerate')?.confirm)

// `/p/{slug}`가 200을 반환하는 상태는 published 하나뿐이다
for (const status of [
  'generating', 'input_error', 'brochure_ready', 'draft', 'reviewing', 'unpublished',
] as const) {
  check(`${status}는 공개되지 않는다 (/p/{slug} 404)`,
    !describeStatus(product({ status, validation_snapshot: passSnap })).isPublic)
}
check('published만 공개된다 (/p/{slug} 200)',
  describeStatus(product({ status: 'published', validation_snapshot: passSnap })).isPublic)

// §14.1 도달 화면 → 경로
check('input_error의 도달 화면은 값이 유지되는 폼이다',
  screenPath(describeStatus(product({ status: 'input_error' })).screen, 'X') === '/new?product_id=X')
check('draft 이후의 도달 화면은 편집기다',
  screenPath(describeStatus(product({ status: 'draft', validation_snapshot: passSnap })).screen, 'X')
  === '/admin/products/X/edit')

/* ── S10. 배지 2종 (§10.4) ──────────────────────────────────── */
section('S10 — 배지 2종은 서로 독립이다 (§10.4)')

check('verdict=pass → AI 검증 통과',
  verificationBadge(product({ validation_snapshot: passSnap })) === 'pass')
check('verdict=fail + override 없음 → AI 검증 실패',
  verificationBadge(product({ validation_snapshot: failSnap })) === 'fail')
check('verdict=fail + override 있음 → 검증 실패 · 책임 게시됨',
  verificationBadge(product({ validation_snapshot: failSnap, publish_override_at: 'T' })) === 'override')
check('미검증은 배지를 붙이지 않는다 (실패로 표시하지 않는다)',
  verificationBadge(product({ validation_snapshot: null })) === null)
check('human_edited=false면 편집 배지 없음 (「편집 안 됨」 배지는 없다)',
  editBadge(product({ human_edited: false })) === null)
check('두 축은 독립 — 검증 실패 + 사람 편집됨이 동시에 붙는다',
  verificationBadge(product({ validation_snapshot: failSnap, human_edited: true })) === 'fail'
  && editBadge(product({ validation_snapshot: failSnap, human_edited: true })) === '사람 편집됨')

/* ── 결과 ────────────────────────────────────────────────────── */
console.log(`\n${'─'.repeat(52)}`)
console.log(`통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
