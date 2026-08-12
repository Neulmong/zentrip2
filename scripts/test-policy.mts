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
import {
  describeStatus, screenPath, verificationBadge, editBadge,
  publishGate, publishProcedure, PUBLISHABLE_STATUSES, deleteGate,
} from '../lib/status-view'
import {
  diffSections, LENGTH_LIMITS_SAVE, moveSection, renumber, same, validateEdit,
} from '../lib/edit-contract'
import { LENGTH_LIMITS_GENERATE, type PageContent, type PageSection } from '../lib/pipeline/page'
import { buildConfirmedData } from '../lib/pipeline/normalize'
import { assertFactsUnchanged, buildBrochure, checkBrochure } from '../lib/pipeline/brochure'
import { buildPage, checkPage } from '../lib/pipeline/page'
import { assertSectionCoverage, checkConsistency } from '../lib/pipeline/consistency'
import { resolveTheme } from '../lib/pipeline/theme'
import { findMemoLeaks } from '../lib/pipeline/memo-leak'
import { checkDeclaredTerms, verifyAxis0 } from '../lib/pipeline/axis0'
import { toJsonSchema, validateAgainstSchema } from '../lib/ai/schema'
import {
  DECOMPOSE_SCHEMA, EXPAND_SCHEMA, VALIDATION_SCHEMA,
} from '../lib/pipeline/ai-contracts'
import { MAX_BACKOFF_MS, backoff } from '../lib/client/run-pipeline'
import { quotaSummary } from '../lib/ai/gemini'
import { createDeepseekProvider } from '../lib/ai/deepseek'
import { GoogleGenAI } from '@google/genai'
import { readFileSync } from 'node:fs'

/** 주석을 걷어낸 provider 소스 — 「retryOptions를 넘기지 않는다」를 코드로 확인한다. */
const GEMINI_SOURCE = readFileSync(new URL('../lib/ai/gemini.ts', import.meta.url), 'utf8')

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

/* ── E10. 편집 계약 (§10.2·§10.3·§17.1) ─────────────────────── */
section('E10 — 편집 계약 (§10.2·§10.3·§17.1)')

const sec = (
  id: string, type: string, order: number,
  data: Record<string, unknown>, over: Partial<PageSection> = {},
): PageSection => ({
  id, type, order, visible: true, locked: id === 'sec_hero' || id === 'sec_apply',
  data, source: Object.fromEntries(Object.keys(data).map((k) => [k, 'generated'])), ...over,
})

/** §9.3 9종을 갖춘 최소 page_content. */
function pageContent(over: Partial<Record<string, Record<string, unknown>>> = {}): PageContent {
  const base: Record<string, [string, Record<string, unknown>]> = {
    sec_hero: ['hero', { headline: '제주 여행', subcopy: '봄', image_slot: '' }],
    sec_summary: ['summary', { 여행기간: '3일', 여행지: '제주', 타겟층: '가족', 여행스타일: '자연' }],
    sec_itinerary: ['itinerary', { days: [{ day: '1', text: '도착', image_slot: '' }] }],
    sec_accommodation: ['accommodation', { 숙소명: 'A', 객실타입: 'B', 위치: 'C', 숙박일정: 'D', image_slots: [] }],
    sec_flight: ['flight', { 공항: 'A', 항공사: 'B', 편명: 'C', 출발시간: 'D', 도착시간: 'E' }],
    sec_meal: ['meal', { 식사정보: '조식' }],
    sec_price: ['price', { 성인: '1', 아동: '2', 기타: '3' }],
    sec_shop: ['shop', { 상점명: 'S', 상점정보: 'I', image_slots: [] }],
    sec_apply: ['apply', {
      제목: '신청', 안내문구: '연락 주세요',
      가격요약: { 성인: '1', 아동: '2' }, 행사정보요약: { 행사명: '제주 여행', 여행기간: '3일' },
    }],
  }
  return {
    schema_version: '1.0', theme: 'nature',
    sections: Object.entries(base).map(([id, [type, data]], i) =>
      sec(id, type, i + 1, { ...data, ...(over[id] ?? {}) })),
  }
}

const ctx0 = { before: pageContent(), imageIds: new Set<string>(), slots: new Set<string>() }
const clone = (c: PageContent): PageContent => JSON.parse(JSON.stringify(c))

check('변경 없는 저장은 통과한다',
  validateEdit(clone(ctx0.before), ctx0).content !== undefined)

// §9.4 — 테마는 편집기에서 변경 불가
{
  const next = clone(ctx0.before); next.theme = 'urban'
  check('테마 변경은 거부한다 (§9.4)', 'theme' in validateEdit(next, ctx0).errors)
}

// §10.2 삭제 불가 — locked 섹션은 숨길 수도 없다
{
  const next = clone(ctx0.before)
  next.sections.find((s) => s.id === 'sec_hero')!.visible = false
  check('hero는 숨길 수 없다 (§10.2 locked)', 'sec_hero' in validateEdit(next, ctx0).errors)
}
{
  const next = clone(ctx0.before)
  next.sections = next.sections.filter((s) => s.id !== 'sec_meal')
  check('기본 9종은 배열에서 사라질 수 없다 (삭제는 숨김으로만)',
    'sec_meal' in validateEdit(next, ctx0).errors)
}
{
  const next = clone(ctx0.before)
  next.sections.find((s) => s.id === 'sec_meal')!.visible = false
  check('locked=false 섹션의 숨김은 허용한다 (데이터는 보존)',
    validateEdit(next, ctx0).content !== undefined)
}

// §10.2 apply 예외 — 제목·안내문구만
{
  const next = clone(ctx0.before)
  next.sections.find((s) => s.id === 'sec_apply')!.data.안내문구 = '바뀐 문구'
  check('신청 섹션의 안내문구는 편집할 수 있다',
    validateEdit(next, ctx0).content !== undefined)
}
{
  const next = clone(ctx0.before)
  ;(next.sections.find((s) => s.id === 'sec_apply')!.data.가격요약 as Record<string, string>).성인 = '999'
  check('신청 섹션의 가격요약은 편집할 수 없다 (§10.2)',
    'sec_apply.가격요약' in validateEdit(next, ctx0).errors)
}

// §9.3 키 고정 — source 없는 사실정보 필드를 만들 수 없다
{
  const next = clone(ctx0.before)
  next.sections.find((s) => s.id === 'sec_meal')!.data.새필드 = 'x'
  check('§9.3에 없는 키를 늘릴 수 없다', 'sec_meal.새필드' in validateEdit(next, ctx0).errors)
}
{
  const next = clone(ctx0.before)
  delete next.sections.find((s) => s.id === 'sec_meal')!.data.식사정보
  check('§9.3의 키를 지울 수 없다', 'sec_meal.식사정보' in validateEdit(next, ctx0).errors)
}

// §17.1 길이 계약 — 편집 저장 시 6종
{
  const long = (n: number) => 'ㄱ'.repeat(n)
  const at = (id: string, patch: Record<string, unknown>) => {
    const next = clone(ctx0.before)
    Object.assign(next.sections.find((s) => s.id === id)!.data, patch)
    return validateEdit(next, ctx0).errors
  }
  check('hero.headline 40자 초과 거부', 'sec_hero.headline' in at('sec_hero', { headline: long(41) }))
  check('hero.headline 40자는 통과', !('sec_hero.headline' in at('sec_hero', { headline: long(40) })))
  check('hero.subcopy 80자 초과 거부', 'sec_hero.subcopy' in at('sec_hero', { subcopy: long(81) }))
  check('일차별 서술 200자 초과 거부',
    'sec_itinerary.days.0.text' in
    at('sec_itinerary', { days: [{ day: '1', text: long(201), image_slot: '' }] }))
  check('섹션 제목 30자 초과 거부', 'sec_apply.제목' in at('sec_apply', { 제목: long(31) }))
}

// §10.2 삽입 블록 3종
{
  const withBlock = (type: string, data: Record<string, unknown>) => {
    const next = clone(ctx0.before)
    next.sections.splice(8, 0, {
      id: 'blk_abc', type, order: 8.5, visible: true, locked: false, data, source: {},
    })
    return validateEdit(next, ctx0)
  }
  check('free_text 블록 삽입 허용', withBlock('free_text', { 본문: '안녕' }).content !== undefined)
  check('free_text 500자 초과 거부',
    'blk_abc.본문' in withBlock('free_text', { 본문: 'ㄱ'.repeat(501) }).errors)
  check('notice 300자 초과 거부',
    'blk_abc.본문' in withBlock('notice', { 본문: 'ㄱ'.repeat(301) }).errors)
  check('3종 밖의 블록은 거부한다', 'blk_abc' in withBlock('video', { 본문: 'x' }).errors)
  check('image 블록은 올라간 사진만 참조한다 (§10.2)',
    'blk_abc.image_id' in withBlock('image', { image_id: '없는-id' }).errors)
  check('image 블록이 실제 이미지를 가리키면 통과',
    validateEdit(
      (() => { const n = clone(ctx0.before); n.sections.splice(8, 0, {
        id: 'blk_abc', type: 'image', order: 8.5, visible: true, locked: false,
        data: { image_id: 'img-1' }, source: {} }); return n })(),
      { ...ctx0, imageIds: new Set(['img-1']) },
    ).content !== undefined)
  check('free_text의 source는 전 필드 generated다 (§10.2 표)',
    withBlock('free_text', { 본문: '안녕', 제목: '제목' })
      .content!.sections.find((s) => s.id === 'blk_abc')!.source.본문 === 'generated')
  check('image 블록에는 source를 붙이지 않는다 (사실정보가 아니다)',
    Object.keys(validateEdit(
      (() => { const n = clone(ctx0.before); n.sections.splice(8, 0, {
        id: 'blk_abc', type: 'image', order: 8.5, visible: true, locked: false,
        data: { image_id: 'img-1' }, source: {} }); return n })(),
      { ...ctx0, imageIds: new Set(['img-1']) },
    ).content!.sections.find((s) => s.id === 'blk_abc')!.source).length === 0)
}

// §16.1 — 없는 슬롯을 참조하지 않는다
{
  const next = clone(ctx0.before)
  next.sections.find((s) => s.id === 'sec_hero')!.data.image_slot = 'hero'
  check('업로드되지 않은 슬롯 참조는 거부', 'sec_hero.image_slot' in validateEdit(next, ctx0).errors)
  check('업로드된 슬롯이면 통과',
    validateEdit(next, { ...ctx0, slots: new Set(['hero']) }).content !== undefined)
}

// §10.2 order — hero는 항상 1, apply는 항상 마지막
{
  const next = clone(ctx0.before)
  next.sections.splice(8, 0, {
    id: 'blk_z', type: 'notice', order: 99, visible: true, locked: false,
    data: { 본문: '맨 끝에 놓아 봤다' }, source: {},
  })
  const out = validateEdit(next, ctx0).content!
  check('order를 1부터 다시 매긴다', out.sections.every((s, i) => s.order === i + 1))
  check('hero는 항상 첫 번째', out.sections[0].id === 'sec_hero')
  check('apply는 항상 마지막 — 뒤에 놓은 블록도 앞으로 당긴다',
    out.sections[out.sections.length - 1].id === 'sec_apply')
}

// [위로]/[아래로]는 hero·apply 자리를 침범하지 않는다
{
  const list = renumber(pageContent().sections)
  check('두 번째 섹션을 위로 올려도 hero는 1번을 지킨다',
    moveSection(list, 'sec_summary', -1)[0].id === 'sec_hero')
  check('마지막 직전 섹션을 내려도 apply는 끝을 지킨다',
    moveSection(list, 'sec_shop', 1).at(-1)!.id === 'sec_apply')
}

// §10.3 5항 — 변경된 섹션마다 edit_history
{
  const before = pageContent()
  const after = clone(before)
  after.sections.find((s) => s.id === 'sec_meal')!.data.식사정보 = '중식 포함'
  const recs = diffSections(before, after)
  check('바뀐 섹션 1건만 기록한다',
    recs.length === 1 && recs[0].action === 'update' && recs[0].section_id === 'sec_meal', recs)
  check('변경이 없으면 이력을 남기지 않는다', diffSections(before, clone(before)).length === 0)

  const hidden = clone(before)
  hidden.sections.find((s) => s.id === 'sec_shop')!.visible = false
  check('숨김은 delete로 적는다 (§10.2가 삭제를 숨김으로 정의)',
    diffSections(before, hidden)[0].action === 'delete')

  const inserted = validateEdit(
    (() => { const n = clone(before); n.sections.splice(8, 0, {
      id: 'blk_new', type: 'notice', order: 8.5, visible: true, locked: false,
      data: { 본문: '새 안내' }, source: {} }); return n })(), ctx0).content!
  const insertRecs = diffSections(before, inserted)
  check('삽입은 insert로 적는다',
    insertRecs.some((r) => r.action === 'insert' && r.section_id === 'blk_new'), insertRecs)
  check('삽입으로 밀려난 섹션은 reorder로 적는다',
    insertRecs.some((r) => r.action === 'reorder' && r.section_id === 'sec_apply'))
}

// 키 순서만 바뀐 것은 변경이 아니다 — 이력이 쓰레기로 차는 것을 막는다
check('키 순서가 달라도 같은 값으로 본다',
  same({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }))
check('값이 다르면 다르게 본다', !same({ a: 1 }, { a: 2 }))

// §17.1 — 생성 4종과 편집 6종의 상한값은 같아야 한다 (강제 시점만 다르다)
check('생성 시 4종의 상한이 편집 저장 시와 일치한다',
  LENGTH_LIMITS_GENERATE['hero.headline'] === LENGTH_LIMITS_SAVE['hero.headline']
  && LENGTH_LIMITS_GENERATE['hero.subcopy'] === LENGTH_LIMITS_SAVE['hero.subcopy']
  && LENGTH_LIMITS_GENERATE['일차별 서술'] === LENGTH_LIMITS_SAVE['일차별 서술']
  && LENGTH_LIMITS_GENERATE['섹션 제목'] === LENGTH_LIMITS_SAVE['섹션 제목'])
check('편집 저장 시 강제하는 것은 6종이다', Object.keys(LENGTH_LIMITS_SAVE).length === 6)

/* ── P11. 게시 게이트 (§11.5·§12.2·§14.5 #12) ───────────────── */
section('P11 — 게시 게이트 (§11.5·§12.2)')

/** 게시 가능한 최소 조건을 갖춘 상품. */
const publishable = (over: Partial<ProductRow> = {}) => {
  const p = product({
    status: 'draft', slug: 'jeju-trip', page_content: {},
    validation_snapshot: passSnap, ...over,
  })
  return {
    status: p.status, validation_snapshot: p.validation_snapshot,
    human_edited: p.human_edited, publish_override_at: p.publish_override_at,
    slug: p.slug, hasPageContent: !!p.page_content,
  }
}

check('pass + 편집 없음 → 확인 없이 게시', publishProcedure(publishable()).kind === 'plain')
check('pass + 사람 편집됨 → 확인 필요 (§11.5)',
  publishProcedure(publishable({ human_edited: true })).kind === 'acknowledge')
check('fail → 책임 게시 절차',
  publishProcedure(publishable({ validation_snapshot: failSnap })).kind === 'override')
check('미검증 → 게시 경로 없음 (없는 것을 통과로 읽지 않는다)',
  publishProcedure(publishable({ validation_snapshot: null })).kind === 'blocked')

check('pass는 그냥 통과한다', publishGate(publishable()).ok)
{
  const g = publishGate(publishable())
  check('통과 시 override는 false다 — publish_override_at을 남기지 않는다',
    g.ok === true && g.override === false, g)
}

// §11.5 — 확인 모달은 화면 규정이라 서버가 강제하지 않는다(DB에 남는 것이 없다)
check('pass + human_edited도 서버는 플래그 없이 통과시킨다',
  publishGate(publishable({ human_edited: true })).ok)

// §11.5 — 책임 게시는 기록되는 결정이므로 요청에 의사가 있어야 한다
check('fail은 override 없이 거부한다',
  !publishGate(publishable({ validation_snapshot: failSnap })).ok)
check('fail + override:true는 통과한다',
  publishGate(publishable({ validation_snapshot: failSnap }), { override: true }).ok)
check('fail + override로 통과하면 override 플래그가 켜진다',
  (publishGate(publishable({ validation_snapshot: failSnap }), { override: true }) as
    { ok: true; override: boolean }).override === true)
check('미검증은 override로도 열리지 않는다 (열람할 실패 항목 자체가 없다)',
  !publishGate(publishable({ validation_snapshot: null }), { override: true }).ok)

// §15.2 전이표 — [게시]로 published에 갈 수 있는 상태는 3개다
check('draft에서 게시 가능', publishGate(publishable({ status: 'draft' })).ok)
check('reviewing에서 게시 가능', publishGate(publishable({ status: 'reviewing' })).ok)
check('unpublished에서 재게시 가능', publishGate(publishable({ status: 'unpublished' })).ok)
check('published를 다시 게시하지 않는다', !publishGate(publishable({ status: 'published' })).ok)
for (const status of ['input_error', 'generating', 'brochure_ready'] as const) {
  check(`${status}에는 게시 경로가 없다`, !publishGate(publishable({ status })).ok)
}
check('§15.2 전이표와 PUBLISHABLE_STATUSES가 일치한다',
  PUBLISHABLE_STATUSES.length === 3
  && ['draft', 'reviewing', 'unpublished'].every((s) => PUBLISHABLE_STATUSES.includes(s as never)))

// 공개할 것이 없으면 게시하지 않는다
check('page_content가 없으면 게시 거부',
  !publishGate({ ...publishable(), hasPageContent: false }).ok)
check('slug가 없으면 게시 거부', !publishGate({ ...publishable(), slug: null }).ok)

// 버튼 표기와 서버 판정이 같은 함수를 쓴다 — 활성 버튼이 403으로 튕기지 않는다
check('버튼이 비활성인 경우와 게이트가 막는 경우가 일치한다',
  ['draft', 'reviewing', 'unpublished'].every((status) => {
    for (const snap of [passSnap, failSnap, null]) {
      const p = product({ status: status as never, validation_snapshot: snap })
      const b = describeStatus(p).buttons.find((x) => x.key === 'publish')
      const gate = publishGate(publishable({ status: status as never, validation_snapshot: snap }))
      // 비활성 버튼 ↔ 게이트가 override로도 열지 못하는 경우
      const gateHard = !publishGate(
        publishable({ status: status as never, validation_snapshot: snap }), { override: true }).ok
      if (!!b?.disabled !== gateHard) return false
      // 확인이 필요한 버튼 ↔ 게이트가 플래그 없이는 막는 경우
      if (b?.label === '책임 게시' && gate.ok) return false
    }
    return true
  }))

/* ── U13. 게시 중단 (§12.3·§14.5 #13) ───────────────────────── */
section('U13 — 게시 중단 (§12.3)')

check('published에서만 중단할 수 있다',
  checkPrecondition('unpublish', product({ status: 'published' })) === null)
for (const status of ['draft', 'reviewing', 'unpublished', 'generating', 'input_error', 'brochure_ready'] as const) {
  check(`${status}에서는 중단할 수 없다 (409 precondition)`,
    checkPrecondition('unpublish', product({ status })) !== null)
}
check('게시 중단은 확인을 받는다 (공개 페이지가 즉시 404가 된다)',
  !!describeStatus(product({ status: 'published', validation_snapshot: passSnap }))
    .buttons.find((b) => b.key === 'unpublish')?.confirm)

/* ── U14. 상품 삭제 (§12.4·§14.4 #18) ───────────────────────── */
section('U14 — 상품 삭제 (§12.4)')

const ALL_STATUSES = [
  'generating', 'input_error', 'brochure_ready', 'draft', 'reviewing', 'published', 'unpublished',
] as const

check('published만 삭제할 수 없다',
  !deleteGate({ status: 'published', hasApplications: false }).ok)
for (const status of ALL_STATUSES.filter((s) => s !== 'published')) {
  check(`${status}는 삭제할 수 있다`,
    deleteGate({ status, hasApplications: false }).ok)
}
// §12.4 — 「진행 주체가 사라진 상품을 정리하는 것이 이 기능의 주 용도」
check('generating도 삭제할 수 있다 (§15.1.1 정리 용도)',
  deleteGate({ status: 'generating', hasApplications: false }).ok)

check('신청이 있으면 어느 상태에서도 삭제할 수 없다',
  ALL_STATUSES.every((status) => !deleteGate({ status, hasApplications: true }).ok))
check('막힌 사유가 두 경우에 서로 다르다 (화면에 그대로 쓴다)',
  deleteGate({ status: 'published', hasApplications: false }).ok === false
  && deleteGate({ status: 'draft', hasApplications: true }).ok === false
  && (deleteGate({ status: 'published', hasApplications: false }) as { detail: string }).detail
     !== (deleteGate({ status: 'draft', hasApplications: true }) as { detail: string }).detail)
check('게시 중 + 신청 있음은 게시 중단 안내가 먼저다 (풀어야 할 순서)',
  (deleteGate({ status: 'published', hasApplications: true }) as { detail: string })
    .detail.includes('게시 중단'))

/* ════════════════════════════════════════════════════════════════
 * U15 — AI 출력 스키마 강제 (§4.3 · lib/ai/schema.ts)
 *
 * Gemini는 `responseSchema`로 제공자가 강제하지만, **예비 경로(DeepSeek)는
 * `json_schema` strict 모드가 없어** 이 검증기가 유일한 관문이다.
 * 여기가 조용히 통과시키면 구조가 깨진 값이 파이프라인에 그대로 들어간다.
 * ════════════════════════════════════════════════════════════════ */
section('U15 — AI 출력 스키마 강제 (§4.3)')

const V = (v: unknown, s: unknown) => validateAgainstSchema(v, toJsonSchema(s))

check('Gemini 대문자 타입이 JSON Schema 소문자로 바뀐다',
  (toJsonSchema(DECOMPOSE_SCHEMA) as { type: string }).type === 'object'
  && (toJsonSchema(DECOMPOSE_SCHEMA) as { properties: { 일정: { type: string } } })
       .properties.일정.type === 'array')

// `핵심표현`은 §6.3 판정 3단계의 신고 필드다 — 필수이므로 픽스처에도 있어야 한다
const 분해출력 = { 판정: 'pass', 일정: [{ day: '1', 원문근거: 'a', 내용: 'b', 핵심표현: ['a'] }] }
check('올바른 일차 분해 출력은 통과한다',
  V(분해출력, DECOMPOSE_SCHEMA).length === 0, V(분해출력, DECOMPOSE_SCHEMA))
check('핵심표현이 빠지면 스키마가 거부한다 (3단계 신고 누락 — §6.3)',
  V({ 판정: 'pass', 일정: [{ day: '1', 원문근거: 'a', 내용: 'b' }] }, DECOMPOSE_SCHEMA).length > 0)
check('올바른 검증 출력은 통과한다',
  V({ 판정: 'pass', items: [] }, VALIDATION_SCHEMA).length === 0)
check('올바른 확장 서술 출력은 통과한다',
  V({ days: [{ day: '1', text: 'x' }], apply: { 제목: 'a', 안내문구: 'b' } }, EXPAND_SCHEMA)
    .length === 0)

check('필수 필드 누락을 잡는다',
  V({ 판정: 'pass' }, VALIDATION_SCHEMA).some((e) => /items.*필수/.test(e)))
check('enum 밖의 판정값을 잡는다 (§8.2의 판정 3종)',
  V({ 판정: 'maybe', items: [] }, VALIDATION_SCHEMA).some((e) => /허용값/.test(e)))
check('타입 불일치를 잡는다',
  V({ 판정: 'pass', items: 'nope' }, VALIDATION_SCHEMA).some((e) => /array/.test(e)))
check('배열 원소 **안쪽**의 누락을 잡는다',
  V({ days: [{ day: '1' }], apply: { 제목: 'a', 안내문구: 'b' } }, EXPAND_SCHEMA)
    .some((e) => /days\[0\]\.text/.test(e)))
check('최상위가 객체가 아니면 잡는다', V('문자열', EXPAND_SCHEMA).length > 0)
check('null을 잡는다', V(null, EXPAND_SCHEMA).length > 0)
check('실패 경로가 사람이 읽을 수 있다 (로그에 그대로 남는다)',
  V({ days: [], apply: {} }, EXPAND_SCHEMA).join(' ').includes('$.apply.제목'),
  V({ days: [], apply: {} }, EXPAND_SCHEMA))
check('모르는 키워드는 무시한다 (거부하지 않는다)',
  V({ a: 'x' }, { type: 'OBJECT', properties: { a: { type: 'STRING', minLength: 99 } } })
    .length === 0)

/* ════════════════════════════════════════════════════════════════
 * U16 — 재시도 백오프 (§4.2 · lib/client/run-pipeline.ts)
 *
 * 서버가 「n초 뒤 재호출하라」고 지시했는데 클라이언트가 **더 짧게 자르면**
 * 한도가 안 풀린 채 재호출해 429를 또 맞고, 재시도 예산 2회를 몇 초 만에
 * 태운다. 실측에서 서버 지시값은 11·20·49·52·57·59초였다.
 * ════════════════════════════════════════════════════════════════ */
section('U16 — 재시도 백오프 (§4.2)')

check('상한이 실측된 지시값(최대 59초)을 전부 덮는다',
  MAX_BACKOFF_MS >= 59_000, MAX_BACKOFF_MS)
check('상한 이하의 지시는 **그대로** 기다린다 (자르지 않는다)',
  [11_000, 20_000, 49_000, 52_000, 57_000, 59_000]
    .every((v) => Math.min(v, MAX_BACKOFF_MS) === v))
check('상한을 넘는 지시만 상한으로 줄인다',
  Math.min(120_000, MAX_BACKOFF_MS) === MAX_BACKOFF_MS)

{
  // 남은 초를 화면에 갱신하는지 — 통째로 기다리면 「멈춘 화면」과 구분되지 않는다.
  const seen: string[] = []
  const t0 = Date.now()
  await backoff(2_000, '검사 중…', 1, (label) => seen.push(label))
  const elapsed = Date.now() - t0

  check('지시한 시간만큼 실제로 기다린다', elapsed >= 1_900 && elapsed < 3_500, elapsed)
  check('1초마다 진행 표시를 갱신한다 (얼어붙은 화면이 아니다)',
    seen.length >= 2, seen.length)
  check('남은 초를 보여준다', seen.some((s) => /\d+초 후/.test(s)), seen[0])
  check('원래 단계 이름을 유지한다', seen.every((s) => s.startsWith('검사 중…')), seen[0])
}

/* ════════════════════════════════════════════════════════════════
 * U17 — 429 진단 요약 (§4.3 · lib/ai/gemini.ts)
 *
 * Gemini의 429 본문은 안내 문구·링크가 앞자리를 차지하고 `quotaId`가 뒤에
 * 온다. 메시지를 앞에서 잘라 저장하면 로그에 남는 것은 「한도 초과」뿐이고
 * **분당인지 일일인지 구분할 수 없다.** 실제로 그 때문에 「기다리면 풀린다」로
 * 오해했는데, 진짜는 하루 20회라 대기로는 풀리지 않는 것이었다.
 *
 * 아래 본문은 이 프로젝트에서 **실제로 받은 429 응답**이다.
 * ════════════════════════════════════════════════════════════════ */
section('U17 — 429 진단 요약 (§4.3)')

const REAL_429 = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details. '
      + 'For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. '
      + 'To monitor your current usage, head to: https://ai.dev/rate-limit. \n'
      + '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, '
      + 'limit: 20, model: gemini-3.5-flash\nPlease retry in 11.949744534s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
          quotaDimensions: { location: 'global', model: 'gemini-3.5-flash' },
          quotaValue: '20',
        }],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '11s' },
    ],
  },
})

{
  const summary = quotaSummary(REAL_429)
  check('요약을 만들어 낸다', summary !== null, summary)
  check('**일일** 한도임을 밝힌다 (대기로 풀리지 않는 종류다)',
    summary?.includes('하루') === true, summary)
  check('한도 값을 담는다 (20회)', summary?.includes('20') === true, summary)
  check('quotaId를 담는다', summary?.includes('GenerateRequestsPerDayPerProjectPerModel') === true,
    summary)

  // 300자로 자르던 예전 방식이면 진단 정보가 통째로 사라진다 — 그 회귀를 막는다.
  const OLD_CUT = 300
  check('원본 메시지는 300자 안에 quotaId가 없다 (그래서 요약이 필요했다)',
    !REAL_429.slice(0, OLD_CUT).includes('quotaId'))
  check('요약을 앞에 붙이면 300자 안에서 판별된다',
    `${summary} — ${REAL_429}`.slice(0, OLD_CUT).includes('하루'), summary)
}

check('분당 한도는 「분당」으로 표기한다',
  quotaSummary(JSON.stringify({
    error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProject-FreeTier', quotaValue: '10' }] }] },
  }))?.includes('분당') === true)
check('쿼터 정보가 없는 메시지는 null이다 (없는 요약을 지어내지 않는다)',
  quotaSummary('그냥 네트워크 오류') === null)

/* ════════════════════════════════════════════════════════════════
 * U18 — SDK 자동 재시도 (§4.2 · A-14)
 *
 * 「재시도는 클라이언트가 같은 API를 재호출한다」가 원칙이다. SDK가 몰래
 * 재시도하면 **그 횟수가 전부 하루 20회 쿼터에서 빠지는데** 우리 눈에는
 * 「1회 실패」로 보여 원인을 알 수 없다.
 *
 * `@google/genai`는 `retryOptions`를 안 넘기면 재시도하지 않지만, 누군가
 * 「명시적으로 꺼두자」며 `retryOptions: {}`를 넣는 순간 **기본값 5가 켜진다.**
 * 그 함정을 여기서 막는다 — 실제로 나가는 HTTP 요청 수를 센다.
 * ════════════════════════════════════════════════════════════════ */
section('U18 — SDK 자동 재시도 (§4.2 · A-14)')

async function countRequests(httpOptions?: Record<string, unknown>): Promise<number> {
  let calls = 0
  const real = globalThis.fetch
  globalThis.fetch = (async () => {
    calls++
    // 429는 SDK의 기본 재시도 대상이다(408·429·5xx).
    return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded' } }),
      { status: 429, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  try {
    const ai = new GoogleGenAI({ apiKey: 'fake', ...(httpOptions ? { httpOptions } : {}) })
    await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'x' }] }],
      config: { abortSignal: AbortSignal.timeout(20_000) },
    })
  } catch { /* 429는 던진다 */ }
  globalThis.fetch = real
  return calls
}

{
  const asShipped = await countRequests()
  check('429를 받아도 HTTP 요청이 1회뿐이다 (현재 설정)', asShipped === 1, asShipped)

  // 함정 재현 — retryOptions를 넘기면 attempts 기본값 5가 켜진다.
  const withEmptyOptions = await countRequests({ retryOptions: { attempts: 2 } })
  check('retryOptions를 넘기면 재시도가 켜진다 (넘기면 안 되는 이유)',
    withEmptyOptions > 1, withEmptyOptions)

  check('실제 provider가 retryOptions를 넘기지 않는다',
    !/retryOptions/.test(GEMINI_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')),
    'lib/ai/gemini.ts에 retryOptions가 있다')
}

/* ════════════════════════════════════════════════════════════════
 * U19 — 여행주제 · 기획메모 (§6.1·§7.4 확장)
 *
 * `여행스타일`이 6종 단일 선택이라 「걷기 + 맛집 + 휴식」 같은 복합 주제를
 * 담을 수 없어 둘을 분리했다.
 *   여행주제  값 필드 · 고객에게 **표시** · `source` 있음 · 미입력 시 채움
 *   기획메모  참고 필드 · 고객 **미노출** · `source` 없음 · **채우지 않는다**
 * ════════════════════════════════════════════════════════════════ */
section('U19 — 여행주제 · 기획메모 (§6.1·§7.4)')

{
  const raw: Record<string, string> = {
    행사명: '제주 여행', 여행지: '제주',
    여행기간_시작: '2026-03-14', 여행기간_종료: '2026-03-17',
    일정원문: '1일: 김해공항 출발, 올레 7코스 걷기',
    숙소명: '롯데호텔 제주', 객실타입: '디럭스룸', 위치: '중문',
    상점명: '기념품 숍', 상점정보: '10% 할인',
    가격_성인: '120000', 가격_아동: '해당 없음', 식사정보: '조식 3회',
    여행스타일: '자연',
  }

  const filled = buildFormInput({ ...raw, 여행주제: '걷기와 맛집', 기획메모: '30대 2인' })
  check('여행주제·기획메모가 form_input에 담긴다',
    filled.행사정보.여행주제 === '걷기와 맛집' && filled.행사정보.기획메모 === '30대 2인')

  const empty = buildFormInput(raw)
  check('미입력이면 form_input에 빈 문자열이다 (§7.4)',
    empty.행사정보.여행주제 === '' && empty.행사정보.기획메모 === '')

  const cd = buildConfirmedData(empty).data
  check('여행주제 미입력은 `추후 추가 예정`으로 채운다 (화면에 표시되므로)',
    cd.행사정보.여행주제 === '추후 추가 예정', cd.행사정보.여행주제)
  check('기획메모 미입력은 **채우지 않는다** (고객에게 안 보이므로)',
    cd.행사정보.기획메모 === '', cd.행사정보.기획메모)

  const cdMemo = buildConfirmedData(filled).data
  check('기획메모 입력분은 confirmed_data로 승계된다 (프롬프트 재료)',
    cdMemo.행사정보.기획메모 === '30대 2인')

  const br = buildBrochure(cdMemo, '요약 문장입니다.')
  const overview = br.sections.find((s) => s.id === 'b_overview')!
  check('소개서 개요에 여행주제가 실린다', '여행주제' in overview.data)
  check('여행주제의 source가 `행사정보.여행주제`다',
    overview.source.여행주제 === '행사정보.여행주제', overview.source.여행주제)

  const allSources = br.sections.flatMap((s) => Object.values(s.source ?? {}))
  check('어느 섹션의 source도 기획메모를 가리키지 않는다',
    !allSources.some((v) => String(v).includes('기획메모')),
    allSources.filter((v) => String(v).includes('기획메모')))
  check('기획메모 원문이 소개서에 실리지 않는다',
    !JSON.stringify(br).includes('30대 2인'))

  // 상한 — 요약 섹션이 무너지지 않게, 프롬프트가 25초 예산을 밀어내지 않게.
  check('여행주제 200자 초과는 거부된다',
    !!validateFormInput(buildFormInput({ ...raw, 여행주제: '가'.repeat(201) }))['행사정보.여행주제'])
  check('기획메모 1000자 초과는 거부된다',
    !!validateFormInput(buildFormInput({ ...raw, 기획메모: '가'.repeat(1001) }))['행사정보.기획메모'])
  check('상한 이내는 통과한다',
    Object.keys(validateFormInput(buildFormInput({
      ...raw, 여행주제: '가'.repeat(200), 기획메모: '가'.repeat(1000),
    }))).length === 0)
  check('타겟층 100자 초과도 거부된다 (긴 페르소나는 기획메모로 보낸다)',
    !!validateFormInput(buildFormInput({ ...raw, 타겟층: '가'.repeat(101) }))['행사정보.타겟층'])
}

/* ════════════════════════════════════════════════════════════════
 * U20 — 주 공급자·모델 관문 (§4.3 · lib/ai/deepseek.ts · lib/ai/index.ts)
 *
 * spec 2.6에서 주 공급자가 DeepSeek으로, 모델이 `deepseek-v4-flash` **하나로**
 * 확정됐다. 확정을 문서에만 적어두면 급할 때 환경 변수 한 줄로 뒤집힌다 —
 * 「일단 pro로 올려보자」가 가능한 순간 그것은 확정이 아니다.
 * 그래서 provider가 호출 **전에** 던지는지를 여기서 센다.
 * ════════════════════════════════════════════════════════════════ */
section('U20 — 주 공급자·모델 관문 (§4.3)')

const AI_INDEX_SOURCE = readFileSync(new URL('../lib/ai/index.ts', import.meta.url), 'utf8')
const DEEPSEEK_SOURCE = readFileSync(new URL('../lib/ai/deepseek.ts', import.meta.url), 'utf8')

const threw = (fn: () => unknown): string | null => {
  try { fn(); return null } catch (e) { return (e as Error).message }
}

check('기본 모델은 deepseek-v4-flash다',
  createDeepseekProvider('sk-test').model === 'deepseek-v4-flash',
  createDeepseekProvider('sk-test').model)
check('공급자 이름이 deepseek다', createDeepseekProvider('sk-test').name === 'deepseek')

check('deepseek-v4-pro는 생성 시점에 거부된다',
  threw(() => createDeepseekProvider('sk-test', 'deepseek-v4-pro')) !== null)
check('거부 사유가 pro를 지목한다 (로그만 보고 원인을 안다)',
  /pro/i.test(threw(() => createDeepseekProvider('sk-test', 'deepseek-v4-pro')) ?? ''),
  threw(() => createDeepseekProvider('sk-test', 'deepseek-v4-pro')))
check('대소문자를 섞어도 못 뚫는다',
  threw(() => createDeepseekProvider('sk-test', 'DeepSeek-V4-PRO')) !== null)
check('flash가 아닌 값도 거부된다',
  threw(() => createDeepseekProvider('sk-test', 'deepseek-chat')) !== null)
check('flash 계열은 통과한다 (503 대비 탈출구는 남아 있다)',
  threw(() => createDeepseekProvider('sk-test', 'deepseek-v4-flash-lite')) === null,
  threw(() => createDeepseekProvider('sk-test', 'deepseek-v4-flash-lite')))

check('AI_PROVIDER가 비면 deepseek으로 간다 (기본값이 주 경로다)',
  /AI_PROVIDER\s*\?\?\s*'deepseek'/.test(AI_INDEX_SOURCE),
  'lib/ai/index.ts의 기본값이 deepseek이 아니다')
check('예비 경로는 gemini를 명시할 때만 선택된다',
  /===\s*'gemini'\s*\?\s*'gemini'\s*:\s*'deepseek'/.test(AI_INDEX_SOURCE))
check('주 경로도 SDK 자동 재시도를 끈다 (§4.2 — 25초 예산)',
  /maxRetries:\s*0/.test(DEEPSEEK_SOURCE))
check('주 경로 타임아웃이 공용 상수를 쓴다 (25초가 한 곳에서 온다)',
  /timeout:\s*AI_TIMEOUT_MS/.test(DEEPSEEK_SOURCE))

/* ── 하네스 체인에 새로 들어간 검사 2종 ─────────────────────── */

/*
 * `tonal-manner-apply`(보호값 검증)와 `memo-leak-check`는 매니페스트가 체인에
 * 선언했지만 라우트 코드에는 없던 검사다. 체인에 넣는 순간 **정상 산출물을
 * 반려할 위험**이 생긴다 — 그러면 데모가 첫 요청에서 죽는다.
 *
 * 그래서 두 방향을 다 고정한다: 정상 산출물에 0건, 조작에는 1건 이상.
 */
section('하네스 체인 — 새 검사가 정상 산출물을 반려하지 않는다')

{
  const fi = form({ 여행스타일: '자연', 여행주제: '걷기와 맛집' })
  const cd = buildConfirmedData(fi).data
  cd.행사정보.일정 = [
    { day: '1', 원문근거: '1일: 김해공항 출발, 올레 7코스 걷기, 중식·석식 제공',
      내용: '김해공항에서 출발해 올레 7코스를 걷습니다.' },
    { day: '2', 원문근거: '2일: 성산일출봉 관람',
      내용: '성산일출봉을 관람합니다.' },
    { day: '3', 원문근거: '', 내용: '추후 추가 예정' },
    { day: '4', 원문근거: '', 내용: '추후 추가 예정' },
  ]

  const br = buildBrochure(cd, '올레 7코스를 걷고 성산일출봉을 관람합니다.')

  const 보호값 = assertFactsUnchanged(cd, br)
  check('tonal-manner-apply: 정상 소개서에 보호값 위반 0건', 보호값.length === 0, 보호값)
  check('brochure-contract-check: 정상 소개서에 계약 위반 0건',
    checkBrochure(br).length === 0, checkBrochure(br))

  // 조작 방향 — 값이 바뀌면 반드시 잡아야 한다
  const 조작 = structuredClone(br)
  const price = 조작.sections.find((s) => s.id === 'b_price')!
  price.data.성인 = '130000원'
  check('tonal-manner-apply: 가격을 바꾸면 잡는다', assertFactsUnchanged(cd, 조작).length > 0)

  /*
   * 필드 **누락**. 값 변경만 보던 시절 두 검사가 다 놓치던 구멍이다 —
   * `assertFactsUnchanged`는 없는 값을 건너뛰었고, `checkBrochure`는
   * `data`에 있는 키만 봤다. 조립부 회귀가 가장 흔히 나타나는 형태다.
   */
  const 누락 = structuredClone(br)
  const 숙박 = 누락.sections.find((s) => s.id === 'b_accommodation')!
  delete 숙박.data.숙소명
  check('tonal-manner-apply: source에 있는데 값이 없으면 잡는다',
    assertFactsUnchanged(cd, 누락).length > 0, assertFactsUnchanged(cd, 누락))
  check('brochure-contract-check: source에 있는데 data에 없으면 잡는다',
    checkBrochure(누락).length > 0, checkBrochure(누락))

  // 페이지 쪽도 같은 방식으로 확인한다
  const theme = resolveTheme(cd.행사정보.여행스타일)
  const expanded = new Map(cd.행사정보.일정.map((d) => [d.day, d.내용]))
  const pageContent = buildPage({
    cd, theme, slots: new Set<string>(), expanded,
    apply: { 제목: '신청 안내', 안내문구: '아래 양식으로 신청해 주세요. 확인 후 연락드립니다.' },
  })
  check('page-contract-check: 정상 페이지에 계약 위반 0건',
    checkPage(pageContent, new Set()).length === 0, checkPage(pageContent, new Set()))

  const { 기획메모, ...메모제외 } = cd.행사정보
  const 확정값 = JSON.stringify({ ...cd, 행사정보: 메모제외 })
  const 서술: [string, string][] = [
    ...[...expanded.entries()].map(([d, t]) => [`days[${d}].text`, t] as [string, string]),
    ['apply.제목', '신청 안내'],
    ['apply.안내문구', '아래 양식으로 신청해 주세요. 확인 후 연락드립니다.'],
  ]
  /*
   * 3차 교차 대조 — `kind: ai` → `kind: mechanical`로 내린 검사다.
   * **정상 산출물에 0건**이 아니면 파이프라인이 매 실행 반려된다.
   */
  check('consistency-check: 대응표가 두 모델의 섹션을 전부 덮는다',
    assertSectionCoverage().length === 0, assertSectionCoverage())
  check('consistency-check: 정상 산출물에 위반 0건',
    checkConsistency(br, pageContent).length === 0, checkConsistency(br, pageContent))

  const 값조작 = structuredClone(pageContent)
  ;(값조작.sections.find((s) => s.id === 'sec_price')!.data as Record<string, unknown>).성인 = '130000'
  check('consistency-check: 값이 다르면 잡는다', checkConsistency(br, 값조작).length > 0)

  const 섹션삭제 = structuredClone(pageContent)
  섹션삭제.sections = 섹션삭제.sections.filter((s) => s.id !== 'sec_flight')
  check('consistency-check: 섹션이 사라지면 잡는다', checkConsistency(br, 섹션삭제).length > 0)

  const 서술누락 = structuredClone(pageContent)
  const dd = 서술누락.sections.find((s) => s.id === 'sec_itinerary')!.data.days as Record<string, unknown>[]
  dd[0].text = '첫날은 이동합니다.'
  check('consistency-check: 소개서에 있던 요소가 페이지에서 사라지면 잡는다',
    checkConsistency(br, 서술누락).length > 0)

  check('memo-leak-check: 메모가 비면 유출 0건',
    findMemoLeaks(기획메모, 확정값, 서술).length === 0)
  check('memo-leak-check: 메모에만 있는 숫자가 서술에 나오면 잡는다',
    findMemoLeaks('30대 2인 가족', 확정값,
      [['days[1].text', '30대 두 분이 함께 걷습니다.']]).length > 0)
}

/* ── 0차 — 표시와 실패를 분리한다 (§6.3 판정 3단계) ─────────── */

section('0차 — 명사구는 표시만, 확정 위반만 실패')

{
  const fi = form()
  const cd = buildConfirmedData(fi).data
  cd.행사정보.일정 = [
    { day: '1', 원문근거: '1일: 김해공항 출발, 올레 7코스 걷기, 중식·석식 제공',
      내용: '김해공항에서 출발해 올레 7코스를 걷습니다. 중식과 석식이 제공됩니다.' },
    { day: '2', 원문근거: '2일: 성산일출봉 관람', 내용: '성산일출봉을 관람합니다.' },
    { day: '3', 원문근거: '', 내용: '추후 추가 예정' },
    { day: '4', 원문근거: '', 내용: '추후 추가 예정' },
  ]

  const r = verifyAxis0(fi, cd, 4)
  check('정상 분해 결과의 확정 위반은 0건 (어미 활용을 실패로 세지 않는다)',
    r.items.length === 0, r.items)

  const 창작 = structuredClone(cd)
  창작.행사정보.일정[1].내용 = '우도로 이동해 성산일출봉을 관람합니다.'
  const r2 = verifyAxis0(fi, 창작, 4)
  check('입력에 없는 «우도»는 위반 후보로 표시된다',
    r2.위반후보.some((n) => n.후보.includes('우도')), r2.위반후보.map((n) => n.후보))
  check('그래도 0차 실패로 세지 않는다 (3단계는 AI의 몫 — §6.3)',
    r2.items.length === 0, r2.items)

  const 일수틀림 = structuredClone(cd)
  일수틀림.행사정보.일정 = 일수틀림.행사정보.일정.slice(0, 3)
  check('일차 수 불일치는 확정 위반이다', verifyAxis0(fi, 일수틀림, 4).items.length > 0)

  const 위조 = structuredClone(cd)
  위조.행사정보.일정[0].원문근거 = '일정원문에 없는 문장입니다'
  /* 3단계 (§6.3) — AI가 신고한 핵심표현을 **기계가** 대조한다 */
  {
    const 신고 = structuredClone(cd)
    신고.행사정보.일정 = 신고.행사정보.일정.map((d) => ({
      ...d, 핵심표현: d.내용 === '추후 추가 예정' ? [] : ['김해공항', '올레 7코스'],
    }))
    // 1일차 근거에 둘 다 있으므로 통과여야 한다
    신고.행사정보.일정[1].핵심표현 = ['성산일출봉']
    check('3단계: 근거 있는 핵심표현은 통과한다',
      checkDeclaredTerms(신고).length === 0, checkDeclaredTerms(신고))

    const 창작 = structuredClone(신고)
    창작.행사정보.일정[0].핵심표현 = ['김해공항', '우도 잠수함']
    check('3단계: 근거 없는 핵심표현은 확정 위반이다', checkDeclaredTerms(창작).length === 1)
    check('3단계: 사유가 그 표현을 지목한다',
      checkDeclaredTerms(창작)[0].사유.includes('우도'))

    const 없음 = structuredClone(cd)
    check('3단계: 신고가 없는 옛 산출물은 검사를 건너뛴다', checkDeclaredTerms(없음).length === 0)
  }

  check('원문근거 위조는 확정 위반이다', verifyAxis0(fi, 위조, 4).items.length > 0)
}

/* ── 결과 ────────────────────────────────────────────────────── */
console.log(`\n${'─'.repeat(52)}`)
console.log(`통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
