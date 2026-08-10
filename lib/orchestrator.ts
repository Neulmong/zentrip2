import 'server-only'
import { db } from './supabase'
import { appendLog, detectAbnormalities } from './logging'
import { checkPrecondition, hasRetryBudget, type RouteKey } from './policy'
import { conflict, ok, unprocessable, type StepResultBody } from './http'
import type {
  LogStep, ProductRow, RetryCounter, RetryFrom, ValidationItem,
} from './types'

/**
 * 서버 라우트의 공통 계층 — 시작 조건 확인, 카운터·상태 갱신, 로그·플래그 기록,
 * 응답 코드 결정. 판정 규칙 자체는 `lib/policy.ts`가 갖는다.
 *
 * 이 계층은 **에이전트를 여러 개 연쇄 호출하지 않는다**. 라우트 1건은
 * AI를 최대 1회 호출하며(§4.2), 그 호출은 `work` 안에서 일어난다.
 */

/* ════════════════════════════════════════════════════════════════
 * 낙관적 잠금 (§16.1.1)
 *
 * 단일 공유 비밀번호이므로 여러 사람이 같은 상품을 동시에 조작할 수 있다.
 * 모든 쓰기는 `updated_at`을 조건으로 갱신하고, 영향 행이 0이면 409 stale이다.
 * 자동 재시도하지 않는다 — 클라이언트가 재조회 후 사용자에게 알린다.
 * ════════════════════════════════════════════════════════════════ */

export async function loadProduct(id: string): Promise<ProductRow | null> {
  const { data, error } = await db().from('products').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`상품 조회 실패: ${error.message}`)
  return (data as ProductRow | null) ?? null
}

export type UpdateResult =
  | { ok: true; row: ProductRow }
  | { ok: false; reason: 'stale' }

/**
 * `updated_at`은 트리거가 갱신하므로 patch에 넣지 않는다.
 * 조건부 UPDATE의 영향 행이 0이면 그 사이 다른 요청이 갱신한 것이다.
 */
export async function updateProduct(
  p: ProductRow, patch: Partial<ProductRow>,
): Promise<UpdateResult> {
  const { data, error } = await db()
    .from('products')
    .update(patch)
    .eq('id', p.id)
    .eq('updated_at', p.updated_at)
    .select()
    .maybeSingle()

  if (error) throw new Error(`상품 갱신 실패: ${error.message}`)
  if (!data) return { ok: false, reason: 'stale' }
  return { ok: true, row: data as ProductRow }
}

/* ════════════════════════════════════════════════════════════════
 * 단계 실행 래퍼
 *
 * 불변 부분(시작 조건·소요 시간·로그·플래그·조건부 갱신·응답 코드)만 담당하고,
 * 소진 시 상태는 단계마다 다르므로(§11.6) 호출부가 지정한다 —
 * 예: 페이지 생성 소진은 draft가 아니라 brochure_ready로 되돌린다(§9.5).
 * ════════════════════════════════════════════════════════════════ */

export type StepOutcome =
  /** 단계 성공 → patch 적용 후 200 */
  | {
      type: 'ok'
      patch: Partial<ProductRow>
      body: StepResultBody
      logOutput?: unknown
      /** 주 단계 **뒤에** 남길 단계명 — draft 전이처럼 순서가 규정인 경우(§9.5) */
      trailingLogs?: LogStep[]
    }
  /**
   * 생성 실패 또는 검증 실패.
   * 여력이 있으면 카운터 +1 후 409 retry, 소진되면 `exhausted`를 적용하고 200.
   * 생성 실패와 검증 실패는 같은 카운터를 공유한다 — 복귀 대상과 소진 시
   * 상태가 동일하므로 나눌 이유가 없다(§11.6).
   */
  | {
      type: 'fail'
      counter: RetryCounter
      retryFrom: RetryFrom
      items: ValidationItem[]
      /** 재시도 소진 시 확정할 상태·산출물 */
      exhausted: {
        patch: Partial<ProductRow>; body: StepResultBody; detail: string
        trailingLogs?: LogStep[]
      }
      logOutput?: unknown
    }
  /** 입력 문제로 중단 → 422. 검증 실패와 달리 카운터를 쓰지 않는다. */
  | {
      type: 'input_error'
      failure_reason: string
      patch?: Partial<ProductRow>
      logOutput?: unknown
    }

export interface StepConfig {
  route: RouteKey
  /** execution_logs에 남길 단계명 (§5.4) */
  step: LogStep
  /** 추가로 남길 단계명 — Step 02처럼 한 요청이 두 단계를 끝내는 경우 */
  extraSteps?: LogStep[]
  productId: string
  /** 일차 부족 채움이 있었다면 그 번호들 (itinerary_partial 판정용) */
  partialDays?: string[]
}

/**
 * 단계 하나를 실행하고 spec §14.6의 응답으로 변환한다.
 *
 * 처리 순서는 고정이다: 시작 조건 → 작업 → **로그 → 이상 플래그** → 조건부 갱신 → 응답.
 * 플래그는 기록된 이력을 근거로 판단하므로 로그가 먼저 쌓여야 한다.
 */
export async function runStep(
  cfg: StepConfig,
  work: (p: ProductRow) => Promise<StepOutcome>,
) {
  const startedAt = Date.now()

  const product = await loadProduct(cfg.productId)
  if (!product) {
    return conflict({ reason: 'precondition', detail: '상품을 찾을 수 없습니다.' })
  }

  const missing = checkPrecondition(cfg.route, product)
  if (missing) {
    // 재호출하지 말고 재조회하라는 신호다(§14.6).
    return conflict({ reason: 'precondition', detail: `시작 조건 미충족 — ${missing}` })
  }

  const outcome = await work(product)
  const elapsedMs = Date.now() - startedAt
  const counter: RetryCounter = outcome.type === 'fail' ? outcome.counter : 'brochure'
  const retryIndex = product.retry_counts[counter] ?? 0

  const flagBase = {
    execution_id: product.execution_id,
    product_id: product.id,
    attempt_no: product.attempt_no,
    step: cfg.step,
    elapsedMs,
  }

  /* ── 성공 ─────────────────────────────────────────────────── */
  if (outcome.type === 'ok') {
    const applied = await updateProduct(product, outcome.patch)
    if (!applied.ok) return conflict({ reason: 'stale' })

    await writeLogs(cfg, product, applied.row, 'pass', retryIndex, outcome.logOutput,
      outcome.trailingLogs)
    await detectAbnormalities({
      ...flagBase, retry_counts: applied.row.retry_counts, partialDays: cfg.partialDays,
    })
    return ok(outcome.body)
  }

  /* ── 입력 문제 → 422 ──────────────────────────────────────── */
  if (outcome.type === 'input_error') {
    const applied = await updateProduct(product, {
      status: 'input_error',
      failure_reason: outcome.failure_reason,
      ...outcome.patch,
    })
    if (!applied.ok) return conflict({ reason: 'stale' })

    await writeLogs(cfg, product, applied.row, 'fail', retryIndex, outcome.logOutput)
    await detectAbnormalities({
      ...flagBase, retry_counts: applied.row.retry_counts,
      aborted: `입력 문제로 확정: ${outcome.failure_reason}`,
    })
    return unprocessable(outcome.failure_reason)
  }

  /* ── 생성·검증 실패 ───────────────────────────────────────── */
  const { retryFrom, items, exhausted } = outcome

  if (hasRetryBudget(product.retry_counts, counter)) {
    const counts = { ...product.retry_counts, [counter]: product.retry_counts[counter] + 1 }
    const applied = await updateProduct(product, { retry_counts: counts })
    if (!applied.ok) return conflict({ reason: 'stale' })

    await writeLogs(cfg, product, applied.row, 'fail', retryIndex, outcome.logOutput ?? { items })
    await detectAbnormalities({
      ...flagBase, retry_counts: counts, bumped: counter, failedItems: items,
    })
    // 재호출 중에도 실패 사유를 화면에 표시할 수 있도록 items를 함께 담는다.
    return conflict({ reason: 'retry', retry_from: retryFrom, items })
  }

  // 재시도 소진 — 파이프라인을 "중단"하지 않는다.
  // 상태를 확정하고 다음 조작 경로를 남긴다(§10.1).
  const applied = await updateProduct(product, exhausted.patch)
  if (!applied.ok) return conflict({ reason: 'stale' })

  await writeLogs(cfg, product, applied.row, 'fail', retryIndex, outcome.logOutput ?? { items },
    exhausted.trailingLogs)
  await detectAbnormalities({
    ...flagBase, retry_counts: applied.row.retry_counts,
    failedItems: items, aborted: exhausted.detail,
  })
  return ok(exhausted.body)
}

/** 한 요청이 두 단계를 끝내는 경우(Step 02) 순서대로 모두 기록한다. */
async function writeLogs(
  cfg: StepConfig, before: ProductRow, after: ProductRow,
  verdict: 'pass' | 'fail', retryIndex: number, output: unknown,
  trailing: LogStep[] = [],
) {
  for (const step of [...(cfg.extraSteps ?? []), cfg.step, ...trailing]) {
    await appendLog({
      execution_id: before.execution_id,
      product_id: before.id,
      category: 'pipeline',
      step,
      attempt_no: before.attempt_no,
      retry_index: retryIndex,
      verdict: step === cfg.step ? verdict : 'pass',
      status: after.status,
      input: { current_step: before.current_step, retry_counts: before.retry_counts },
      output: step === cfg.step ? (output ?? null) : null,
    })
  }
}
