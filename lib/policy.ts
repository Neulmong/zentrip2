/**
 * spec의 판정 규칙만 모은 **순수 모듈**. DB·환경변수·네트워크를 건드리지 않는다.
 *
 * 분리한 이유: 여기가 2.2 → 2.4에서 뒤집힌 규정이 가장 많이 모인 곳이라
 * 단독으로 검증할 수 있어야 한다(`npm run test:policy`).
 */
import {
  RETRY_LIMIT,
  type AxisName, type CurrentStep, type ProductRow, type RetryCounter, type RetryCounts,
} from './types'
import { axisPassed } from './validation'

/* ════════════════════════════════════════════════════════════════
 * 시작 조건 — **재료 기준** (§14.5)
 *
 * ⚠ 조건을 `current_step`의 특정 값으로 걸면 안 된다. 그 값은 재시도·재생성
 *   시점에 이미 다음 단계로 넘어가 있어, §11.6·§15.3의 재시도 경로가
 *   첫 재호출에서 전부 거부된다. 재료(산출물 존재 여부, 선행 축의 판정값)는
 *   재호출해도 그대로이므로 이 문제가 생기지 않는다.
 * ════════════════════════════════════════════════════════════════ */

export type RouteKey =
  | 'decompose' | 'brochure' | 'validate-brochure'
  | 'page' | 'validate-page' | 'validate-consistency'
  | 'regenerate' | 'content' | 'slug' | 'unpublish' | 'form-input'

interface Precondition {
  ok: (p: ProductRow) => boolean
  detail: string
}

export const PRECONDITIONS: Record<RouteKey, Precondition> = {
  // #2
  decompose: {
    ok: (p) => p.status === 'generating' && !!p.form_input,
    detail: 'status = generating · form_input 존재',
  },
  // #3
  brochure: {
    ok: (p) => p.status === 'generating' && !!p.confirmed_data && axisPassed(p, 'axis_0'),
    detail: 'status = generating · confirmed_data 존재 · axis_0 = pass',
  },
  // #4
  'validate-brochure': {
    ok: (p) => p.status === 'generating' && !!p.brochure_content,
    detail: 'status = generating · brochure_content 존재',
  },
  // #5 — 두 상태를 허용한다. [상품 생성]을 누른 시점은 brochure_ready이고,
  //      2·3차 실패로 재호출할 때는 이미 generating이다.
  page: {
    ok: (p) => (p.status === 'brochure_ready' || p.status === 'generating')
      && !!p.brochure_content && axisPassed(p, 'axis_1'),
    detail: 'status ∈ {brochure_ready, generating} · brochure_content 존재 · axis_1 = pass',
  },
  // #6
  'validate-page': {
    ok: (p) => p.status === 'generating' && !!p.page_content,
    detail: 'status = generating · page_content 존재',
  },
  // #7
  'validate-consistency': {
    ok: (p) => p.status === 'generating' && !!p.page_content && axisPassed(p, 'axis_2'),
    detail: 'status = generating · page_content 존재 · axis_2 = pass',
  },
  // #8 — generating이 포함돼야 §15.1.1의 [처음부터 다시]가 성립한다.
  regenerate: {
    ok: (p) => ['brochure_ready', 'draft', 'generating'].includes(p.status),
    detail: 'status ∈ {brochure_ready, draft, generating}',
  },
  // #10
  content: {
    ok: (p) => !!p.page_content
      && ['draft', 'reviewing', 'published', 'unpublished'].includes(p.status),
    detail: 'page_content 존재 · status ∈ {draft, reviewing, published, unpublished}',
  },
  // #11
  slug: {
    ok: (p) => ['draft', 'reviewing'].includes(p.status),
    detail: 'status ∈ {draft, reviewing}',
  },
  // #13
  unpublish: {
    ok: (p) => p.status === 'published',
    detail: 'status = published',
  },
  // #17
  'form-input': {
    ok: (p) => p.status === 'input_error',
    detail: 'status = input_error',
  },
}

/**
 * `status = generating`은 재시도를 막지 않는다. 생성·검증 계열은 모두
 * generating 안에서 실행되고, 검증 실패로 재호출할 때도 상태가 유지된다.
 * 이 조건이 막는 것은 이미 draft·published가 된 상품에 생성 라우트를
 * 다시 호출하는 경우뿐이다.
 */
export function checkPrecondition(route: RouteKey, p: ProductRow): string | null {
  const pc = PRECONDITIONS[route]
  return pc.ok(p) ? null : pc.detail
}

/* ════════════════════════════════════════════════════════════════
 * 되돌림 범위 (§15.3) — [다시 생성] · [처음부터 다시] · 입력 재제출
 *
 * ⚠ `validation_snapshot`을 통째로 비우면 §14.5의 시작 조건
 *   (`axis_0 = pass` · `axis_1 = pass`)을 충족할 수 없어 **재실행 자체가
 *   거부된다.** 시작점 이전 축은 반드시 보존한다.
 * ════════════════════════════════════════════════════════════════ */

/** 재실행 시작점 — §14.4 표의 라우트 번호. `retry_from`과 같은 체계다. */
export type RestartPoint = 2 | 3 | 5

/** 되돌리며 비울 산출물 컬럼. */
export type OutputColumn = 'confirmed_data' | 'brochure_content' | 'page_content'

export interface RestartPlan {
  from: RestartPoint
  /** `current_step`을 이 값으로 되돌린다 — 시작점의 직전 단계다 */
  currentStep: CurrentStep
  /** 폐기할 축. 시작점 **이후**만 해당한다 */
  discard: AxisName[]
  /** 비울 산출물. 시작점 **이후**에 만들어지는 것 전부 */
  clear: OutputColumn[]
}

/**
 * 시작점별 되돌림 3종.
 *
 * ## 산출물을 「시작점 이후 전부」 비우는 근거
 *
 * §15.3의 표는 `brochure_ready` 행의 폐기 산출물로 `brochure_content`만
 * 적었지만, 같은 절의 본문 규칙은 **「폐기: 시작점 이후의 산출물」**이고
 * `generating` 행의 같은 칸도 「시작점 이후 산출물」이라고 적혀 있다.
 *
 * 소개서를 다시 만들면서 그 소개서에서 파생된 `page_content`를 남겨두면,
 * 페이지의 `source`가 **이미 사라진 소개서**를 가리키게 된다 —
 * §16.1의 값 무결성이 깨지는 상태다. 그래서 본문 규칙을 따른다.
 * 어차피 다음 [상품 생성]이 덮어쓰므로 잃는 것도 없다.
 */
const AT_DECOMPOSE: RestartPlan = {
  from: 2, currentStep: 'pipeline_started',
  discard: ['axis_0', 'axis_1', 'axis_2', 'axis_3'],
  clear: ['confirmed_data', 'brochure_content', 'page_content'],
}
const AT_BROCHURE: RestartPlan = {
  from: 3, currentStep: 'normalization_validated',
  discard: ['axis_1', 'axis_2', 'axis_3'],
  clear: ['brochure_content', 'page_content'],
}
const AT_PAGE: RestartPlan = {
  from: 5, currentStep: 'validation_1_completed',
  discard: ['axis_2', 'axis_3'],
  clear: ['page_content'],
}

/**
 * [다시 생성](§15.3) · [처음부터 다시](§15.1.1)의 되돌림 계획.
 *
 * | 이전 상태 | 시작점 | 근거 |
 * |---|---|---|
 * | `brochure_ready` | §8.3 ③ `/brochure` | 소개서가 불만이라 누르는 버튼이다 |
 * | `draft` | §9.5 ① `/page` | 소개서는 통과했고 페이지만 다시 만든다 |
 * | `generating` | 축 판정으로 결정 | 어디까지 진행됐는지 모른다 |
 *
 * `brochure_ready`에서 `axis_1 = pass`여도 §8.3 ③으로 간다 — 축으로 판정하면
 * ⑤로 가버려서 「소개서를 다시 만든다」는 이 버튼의 의미가 사라진다.
 * `generating`만 축으로 판정하는 이유는 그 상태에서 진행 지점을 알 수 없기 때문이다.
 */
export function planRestart(p: ProductRow): RestartPlan {
  if (p.status === 'brochure_ready') return AT_BROCHURE
  if (p.status === 'draft') return AT_PAGE

  // generating — §14.5와 같은 「재료 기준」이다
  if (axisPassed(p, 'axis_1')) return AT_PAGE
  if (axisPassed(p, 'axis_0')) return AT_BROCHURE
  return AT_DECOMPOSE
}

/**
 * 입력 재제출(§14.4 #17)의 되돌림. **언제나 §8.2 ②부터다.**
 * `form_input`이 바뀌었으므로 그것에서 파생된 모든 산출물과 축이 무효다.
 */
export const RESUBMIT_PLAN: RestartPlan = AT_DECOMPOSE

/* ════════════════════════════════════════════════════════════════
 * 재시도 카운터 (§11.6) — **4종**, 예산 비공유
 * ════════════════════════════════════════════════════════════════ */

export const ZERO_COUNTS: RetryCounts = {
  normalization: 0, brochure: 0, page: 0, consistency: 0,
}

/**
 * 초기화는 **사람이 조작한 시점에만** 한다. 시스템의 자동 재호출은 초기화하지 않는다.
 *
 * ⚠ `product-create`가 빠지면 페이지 생성·2·3차가 소진돼 brochure_ready로
 *   되돌아온 뒤 [상품 생성]을 다시 눌러도 즉시 실패한다(§11.6).
 */
export const RESET_ON: Record<
  'form-submit' | 'form-resubmit' | 'regenerate' | 'product-create',
  RetryCounter[]
> = {
  'form-submit': ['normalization', 'brochure', 'page', 'consistency'],
  'form-resubmit': ['normalization', 'brochure', 'page', 'consistency'],
  'regenerate': ['normalization', 'brochure', 'page', 'consistency'],
  'product-create': ['page', 'consistency'],
}

export function resetCounters(current: RetryCounts, which: RetryCounter[]): RetryCounts {
  const next = { ...current }
  for (const c of which) next[c] = 0
  return next
}

export function hasRetryBudget(counts: RetryCounts, counter: RetryCounter): boolean {
  return (counts[counter] ?? 0) < RETRY_LIMIT
}

/**
 * 카운터 ↔ 축 대응은 1:1이다(§11.6).
 * 0차가 `brochure`를 공유하면 소진 결과가 `input_error`인지
 * `brochure_ready + axis_1 = fail`인지 카운터 값만으로 판별할 수 없고,
 * 복귀 대상도 §8.2 ②와 §8.3 ③으로 갈린다.
 */
export const COUNTER_AXIS: Record<RetryCounter, 'axis_0' | 'axis_1' | 'axis_2' | 'axis_3'> = {
  normalization: 'axis_0',
  brochure: 'axis_1',
  page: 'axis_2',
  consistency: 'axis_3',
}
