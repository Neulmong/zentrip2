/**
 * spec의 판정 규칙만 모은 **순수 모듈**. DB·환경변수·네트워크를 건드리지 않는다.
 *
 * 분리한 이유: 여기가 2.2 → 2.4에서 뒤집힌 규정이 가장 많이 모인 곳이라
 * 단독으로 검증할 수 있어야 한다(`npm run test:policy`).
 */
import { RETRY_LIMIT, type ProductRow, type RetryCounter, type RetryCounts } from './types'
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
