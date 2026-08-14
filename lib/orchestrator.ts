import 'server-only'
import { db } from './supabase'
import { appendLog, detectAbnormalities } from './logging'
import { checkPrecondition, hasRetryBudget, type RouteKey } from './policy'
import { coerceFormInput } from './form-validation'
import { conflict, ok, unprocessable, type StepResultBody } from './http'
import {
  PUBLIC_STATUS,
  type LogStep, type ProductRow, type RetryCounter, type RetryFrom, type ValidationItem,
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

/**
 * 조회 결과 1건을 파이프라인이 쓸 수 있는 형태로 만든다.
 *
 * 지금 하는 일은 하나다 — 2.6에 저장된 `form_input`(숙박·상점이 단일 객체)을
 * 2.7의 배열 구조로 올린다(§7.4). 그 행을 그대로 넣으면 `normalizeFields`의
 * `fi.숙박.map(...)`에서 `TypeError`가 나고 **500이 된다.**
 *
 * **세 조회 함수가 전부 이걸 거친다.** 한 곳만 빠뜨리면 그 경로에서만 500이
 * 나는데, 그런 결함은 「특정 상품에서만 터진다」는 형태로 나타나 원인을 찾기 어렵다.
 */
function hydrate(data: unknown): ProductRow | null {
  if (!data) return null
  const row = data as ProductRow
  return { ...row, form_input: coerceFormInput(row.form_input) }
}

export async function loadProduct(id: string): Promise<ProductRow | null> {
  const { data, error } = await db().from('products').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`상품 조회 실패: ${error.message}`)
  return hydrate(data)
}

/**
 * 실행 로그 뷰(§14.3)의 조회 경로. `execution_id`에는 UNIQUE 제약이 있다(§5.1).
 *
 * 상품이 없어도 로그는 남아 있을 수 있다 — §12.4가 상품 삭제 시 로그를
 * `product_id = null`로 보존하도록 규정하므로, 호출부는 `null`을 「로그 화면을
 * 못 그린다」가 아니라 「상품 정보 없이 그린다」로 다뤄야 한다.
 */
export async function loadProductByExecution(execution_id: string): Promise<ProductRow | null> {
  const { data, error } = await db()
    .from('products').select('*').eq('execution_id', execution_id).maybeSingle()
  if (error) throw new Error(`상품 조회 실패: ${error.message}`)
  return hydrate(data)
}

/**
 * 공개 페이지(`/p/{slug}`)와 신청 접수(§13.2 2항)의 조회 경로.
 *
 * **상태 조건을 호출부에 맡기지 않고 쿼리에 넣는다.** §4.1은 「`published` 외
 * 6개 상태는 **예외 없이** 404」라고 규정하는데, 행을 먼저 읽어 오고 호출부가
 * `if (status !== 'published')`를 잊으면 임시저장본이 그대로 공개된다.
 * 여기서 걸러 두면 그 실수를 할 수 있는 자리 자체가 없다.
 *
 * `slug`에는 UNIQUE 제약이 있으므로(§12.1) 결과는 0건 아니면 1건이다.
 */
export async function loadPublishedBySlug(slug: string): Promise<ProductRow | null> {
  const { data, error } = await db()
    .from('products').select('*')
    .eq('slug', slug)
    .eq('status', PUBLIC_STATUS)
    .maybeSingle()
  if (error) throw new Error(`상품 조회 실패: ${error.message}`)
  /*
   * 공개 페이지·신청 접수가 이 경로다. `buildSnapshot`이 `form_input.숙박.map`을
   * 쓰므로(§13.2) 옛 상품에 고객이 신청하면 여기서 500이 난다 — 고객에게 보이는
   * 500이라 파이프라인 500보다 나쁘다.
   */
  return hydrate(data)
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

/**
 * 추가 단계(`cfg.extraSteps`)의 판정. **한 요청이 두 단계를 끝낼 때만 쓴다.**
 *
 * 기본값은 주 단계의 판정을 따른다 — 주 단계가 실패했는데 추가 단계를 통과로
 * 남기면 **하지도 않은 작업이 통과로 기록된다.** 실제로 그랬다: 일정 분해 AI가
 * 실패해도 `itinerary_decomposed`가 `pass`로 남았다.
 *
 * 추가 단계가 **정말로** 성공한 경우(예: 분해는 됐고 0차만 실패)에만 에이전트가
 * 여기에 명시한다. 명시하지 않으면 통과를 주장하지 않는다.
 */
export type ExtraVerdicts = Partial<Record<LogStep, 'pass' | 'fail'>>

export type StepOutcome =
  /** 단계 성공 → patch 적용 후 200 */
  | {
      type: 'ok'
      patch: Partial<ProductRow>
      body: StepResultBody
      logOutput?: unknown
      extraVerdicts?: ExtraVerdicts
      /** 주 단계 **뒤에** 남길 단계명 — draft 전이처럼 순서가 규정인 경우(§9.5) */
      trailingLogs?: LogStep[]
      /**
       * 일차 부족 채움이 있었다면 그 번호들 (`itinerary_partial` 판정용, §5.5).
       *
       * `cfg.partialDays`가 아니라 여기 있는 이유: 몇 일차가 채워졌는지는
       * **작업을 해 봐야 안다.** cfg는 작업 전에 만들어지므로 호출부가 그 값을
       * 넣을 수 없었고, 그래서 이상 5종 중 이 하나가 발화하지 않았다.
       */
      partialDays?: string[]
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
      /** 429 등으로 즉시 재호출이 무의미할 때, 클라이언트가 쉴 시간 */
      retryAfterMs?: number
      /** 재시도 소진 시 확정할 상태·산출물 */
      exhausted: {
        patch: Partial<ProductRow>; body: StepResultBody; detail: string
        trailingLogs?: LogStep[]
      }
      logOutput?: unknown
      extraVerdicts?: ExtraVerdicts
    }
  /** 입력 문제로 중단 → 422. 검증 실패와 달리 카운터를 쓰지 않는다. */
  | {
      type: 'input_error'
      failure_reason: string
      patch?: Partial<ProductRow>
      logOutput?: unknown
      extraVerdicts?: ExtraVerdicts
    }

export interface StepConfig {
  route: RouteKey
  /** execution_logs에 남길 단계명 (§5.4) */
  step: LogStep
  /** 추가로 남길 단계명 — Step 02처럼 한 요청이 두 단계를 끝내는 경우 */
  extraSteps?: LogStep[]
  /**
   * 이 라우트가 쓰는 재시도 카운터 (`manifest.json`의 `counter`).
   *
   * **성공·입력오류일 때 `retry_index`를 무엇으로 기록할지가 이 값에 달렸다.**
   * 이전에는 실패가 아니면 `'brochure'`로 고정돼 있었고, 그래서 0차를 두 번
   * 재시도한 뒤 성공하면 성공 로그의 회차가 `normalization`(2)이 아니라
   * `brochure`(0)로 남았다 — **몇 번 만에 됐는지가 로그에서 사라졌다**(§5.4).
   *
   * 카운터를 쓰지 않는 라우트는 `null`이며 회차는 0이다.
   */
  counter?: RetryCounter | null
  productId: string
  /** 일차 부족 채움이 있었다면 그 번호들 (itinerary_partial 판정용) */
  partialDays?: string[]
  /**
   * 클라이언트가 읽은 시점의 `updated_at` (§16.1.1).
   *
   * 주면 **작업 전에** 대조하고 어긋나면 409 `stale`이다. 주지 않으면
   * 그 검사를 건너뛴다 — 조건부 갱신은 어차피 뒤에서 걸리므로 안전은
   * 유지되고, 값을 아직 안 보내는 호출부가 400으로 죽지 않는다.
   */
  clientUpdatedAt?: string
}

/**
 * 요청 본문에서 조회 시점을 꺼낸다(§16.1.1).
 * 본문이 없거나 JSON이 아니어도 던지지 않는다 — 없으면 `undefined`다.
 */
export async function readUpdatedAt(req: Request): Promise<string | undefined> {
  const body = await req.json().catch(() => null)
  const v = (body as { updated_at?: unknown } | null)?.updated_at
  return typeof v === 'string' && v ? v : undefined
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

  /*
   * §16.1.1 낙관적 잠금 — **작업보다 먼저 본다.**
   *
   * 뒤의 조건부 갱신만으로도 덮어쓰기는 막히지만, 그때는 이미 AI를 25초
   * 호출한 뒤다. 그 비용이 통째로 버려지고 재시도 예산까지 걸린다.
   * 낡은 요청은 아무것도 하기 전에 돌려보낸다.
   *
   * 시작 조건보다 먼저 보는 이유: 클라이언트가 낡았다면 그가 믿고 있는
   * 상태 자체를 신뢰할 수 없다. `publish`·`content`·`slug` 등 이미 잠금이
   * 있던 라우트도 같은 순서다.
   */
  if (cfg.clientUpdatedAt && cfg.clientUpdatedAt !== product.updated_at) {
    return conflict({ reason: 'stale' })
  }

  const missing = checkPrecondition(cfg.route, product)
  if (missing) {
    // 재호출하지 말고 재조회하라는 신호다(§14.6).
    return conflict({ reason: 'precondition', detail: `시작 조건 미충족 — ${missing}` })
  }

  const outcome = await work(product)
  const elapsedMs = Date.now() - startedAt

  /*
   * 실패면 그 실패가 올릴 카운터, 아니면 **이 라우트가 쓰는 카운터**(§5.4).
   * 전에는 실패가 아닐 때 `'brochure'`로 고정해서 성공 로그의 회차가 틀렸다.
   */
  const counter: RetryCounter | null =
    outcome.type === 'fail' ? outcome.counter : (cfg.counter ?? null)
  const retryIndex = counter ? (product.retry_counts[counter] ?? 0) : 0

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
      outcome.trailingLogs, outcome.extraVerdicts)
    await detectAbnormalities({
      ...flagBase, retry_counts: applied.row.retry_counts,
      partialDays: outcome.partialDays ?? cfg.partialDays,
    })
    // 행이 갱신됐다 — 다음 단계가 쓸 새 조회 시점을 함께 준다(§16.1.1).
    return ok({ ...outcome.body, updated_at: applied.row.updated_at })
  }

  /* ── 입력 문제 → 422 ──────────────────────────────────────── */
  if (outcome.type === 'input_error') {
    const applied = await updateProduct(product, {
      status: 'input_error',
      failure_reason: outcome.failure_reason,
      ...outcome.patch,
    })
    if (!applied.ok) return conflict({ reason: 'stale' })

    await writeLogs(cfg, product, applied.row, 'fail', retryIndex, outcome.logOutput,
      [], outcome.extraVerdicts)
    await detectAbnormalities({
      ...flagBase, retry_counts: applied.row.retry_counts,
      aborted: `입력 문제로 확정: ${outcome.failure_reason}`,
    })
    return unprocessable(outcome.failure_reason)
  }

  /* ── 생성·검증 실패 ───────────────────────────────────────── */
  const { counter: failCounter, retryFrom, items, exhausted, retryAfterMs } = outcome

  if (hasRetryBudget(product.retry_counts, failCounter)) {
    const counts = {
      ...product.retry_counts, [failCounter]: product.retry_counts[failCounter] + 1,
    }
    const applied = await updateProduct(product, { retry_counts: counts })
    if (!applied.ok) return conflict({ reason: 'stale' })

    await writeLogs(cfg, product, applied.row, 'fail', retryIndex, outcome.logOutput ?? { items },
      [], outcome.extraVerdicts)
    await detectAbnormalities({
      ...flagBase, retry_counts: counts, bumped: failCounter, failedItems: items,
    })
    // 재호출 중에도 실패 사유를 화면에 표시할 수 있도록 items를 함께 담는다.
    // `updated_at`은 카운터를 올리며 바뀐 값이다 — 이걸 안 주면 클라이언트가
    // 낡은 값으로 재호출해 stale을 맞고 재시도가 시작도 못 한다(§16.1.1).
    return conflict({
      reason: 'retry', retry_from: retryFrom, items,
      updated_at: applied.row.updated_at,
      ...(retryAfterMs ? { retry_after_ms: retryAfterMs } : {}),
    })
  }

  // 재시도 소진 — 파이프라인을 "중단"하지 않는다.
  // 상태를 확정하고 다음 조작 경로를 남긴다(§10.1).
  const applied = await updateProduct(product, exhausted.patch)
  if (!applied.ok) return conflict({ reason: 'stale' })

  await writeLogs(cfg, product, applied.row, 'fail', retryIndex, outcome.logOutput ?? { items },
    exhausted.trailingLogs, outcome.extraVerdicts)
  await detectAbnormalities({
    ...flagBase, retry_counts: applied.row.retry_counts,
    failedItems: items, aborted: exhausted.detail,
  })

  /*
   * §14.6 — **`input_error` 확정은 422다.**
   *
   * 소진 결과가 `input_error`인 단계(0차, §8.2)를 200으로 돌려주면 클라이언트는
   * 「단계 완료」로 읽고 다음 단계를 호출한다. 그 뒤는 시작 조건 미충족이므로
   * 409 `precondition`이 연쇄로 터지고, §15.1이 규정한 도달 화면
   * (`/new?product_id={id}` — 값이 유지된 폼 + 사유)으로 **가지 못한다.**
   *
   * 즉 사용자에게 [입력 수정 후 재제출] 경로가 화면에서 사라진다.
   * 같은 `input_error` 상태인데 입력 문제로 즉시 중단할 때만 422이고
   * 소진으로 확정될 때는 200이던 것이 어긋난 지점이었다.
   *
   * 갈림은 **실제로 적용된 상태**로 판정한다 — 호출부가 어떤 의도였는지가
   * 아니라 행에 무엇이 쓰였는지가 클라이언트가 보게 될 현실이다.
   */
  if (applied.row.status === 'input_error') {
    return unprocessable(
      applied.row.failure_reason ?? exhausted.detail,
    )
  }

  return ok({ ...exhausted.body, updated_at: applied.row.updated_at })
}

/**
 * 한 요청이 두 단계를 끝내는 경우(라우트 ②) 순서대로 모두 기록한다.
 *
 * ## 판정을 세 갈래로 나눈다 (§5.4)
 *
 * | 종류 | 판정 | 근거 |
 * |---|---|---|
 * | 주 단계 | 실제 결과 | 이 요청이 한 일 그 자체다 |
 * | 추가 단계 | `extraVerdicts`에 있으면 그 값, **없으면 주 판정** | 통과를 함부로 주장하지 않는다 |
 * | 후행 단계 | `pass` | 실제로 수행된 조작이다(예: `draft_registered`) |
 *
 * 전에는 추가·후행이 모두 무조건 `pass`였다. 그래서 일정 분해 AI가 실패해도
 * `itinerary_decomposed`가 **통과로 기록됐다** — 하지도 않은 작업이 로그에 남았다.
 * 로그가 유일한 사후 추적 수단이므로 거짓이 들어가면 추적 자체가 무의미해진다.
 */
async function writeLogs(
  cfg: StepConfig, before: ProductRow, after: ProductRow,
  verdict: 'pass' | 'fail', retryIndex: number, output: unknown,
  trailing: LogStep[] = [], extraVerdicts?: ExtraVerdicts,
) {
  const verdictFor = (step: LogStep): 'pass' | 'fail' => {
    if (step === cfg.step) return verdict
    if (trailing.includes(step)) return 'pass'
    return extraVerdicts?.[step] ?? verdict
  }

  for (const step of [...(cfg.extraSteps ?? []), cfg.step, ...trailing]) {
    await appendLog({
      execution_id: before.execution_id,
      product_id: before.id,
      category: 'pipeline',
      step,
      attempt_no: before.attempt_no,
      retry_index: retryIndex,
      verdict: verdictFor(step),
      status: after.status,
      input: { current_step: before.current_step, retry_counts: before.retry_counts },
      output: step === cfg.step ? (output ?? null) : null,
    })
  }
}
