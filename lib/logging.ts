import 'server-only'
import { db } from './supabase'
import { maskPii } from './mask'
import {
  DELAY_THRESHOLD_MS, RETRY_LIMIT,
  type AbnormalityType, type LogCategory, type LogStep,
  type RetryCounts, type ValidationItem, type Verdict,
} from './types'

/* ────────────────────────────────────────────────────────────────
 * execution_logs (§5.4) — append 전용
 * ──────────────────────────────────────────────────────────────── */

export interface LogEntry {
  execution_id: string
  product_id: string | null
  category: LogCategory
  step: LogStep
  attempt_no: number
  /** 해당 시도 안의 재시도 회차. 0 = 최초 */
  retry_index: number
  /** 저장값은 영어다. 화면에서만 한글로 바꾼다(§5.4·§14.3) */
  verdict: Verdict
  status: string
  input?: unknown
  output?: unknown
}

/**
 * 성공·실패 **모두** 기록한다. 실패 행 누락은 성공 기준 위반이다.
 *
 * §16.1.1 — 로그 기록 실패가 본 동작을 실패시키지 않는다.
 * 트랜잭션 밖에서 실행하고, 실패하면 서버 오류 로그에만 남긴다.
 */
export async function appendLog(entry: LogEntry): Promise<void> {
  const masked = entry.category === 'application'
  try {
    const { error } = await db().from('execution_logs').insert({
      ...entry,
      input: masked ? maskPii(entry.input ?? null) : (entry.input ?? null),
      output: masked ? maskPii(entry.output ?? null) : (entry.output ?? null),
    })
    if (error) console.error('[execution_logs] 기록 실패', entry.step, error.message)
  } catch (e) {
    console.error('[execution_logs] 기록 예외', entry.step, e)
  }
}

/* ── 조회 (§14.3 실행 로그 뷰) ─────────────────────────────────── */

export interface LogRow extends LogEntry {
  id: number
  created_at: string
}

/**
 * 한 실행의 전체 이력. **필터를 걸지 않는다** — §14.3이 「단일 화면에서 전체
 * 이력과 이상 플래그를 모두 확인」을 요구하므로 탭 분류는 화면에서 한다.
 * 서버에서 `category`로 걸러 오면 탭을 바꿀 때마다 재조회가 필요하다.
 *
 * `id` 순서로 정렬한다. `created_at`은 밀리초까지만 저장되므로(§5.4) 같은
 * 요청 안에서 연달아 쓴 두 행이 같은 값을 가질 수 있고, 그러면 §13.2의
 * 「로그가 메일보다 먼저」 같은 순서가 화면에서 뒤집혀 보인다.
 */
export async function loadLogs(execution_id: string): Promise<LogRow[]> {
  const { data, error } = await db()
    .from('execution_logs').select('*')
    .eq('execution_id', execution_id)
    .order('id', { ascending: true })
  if (error) throw new Error(`로그 조회 실패: ${error.message}`)
  return (data ?? []) as LogRow[]
}

export interface FlagRow extends FlagEntry {
  id: number
  detected_at: string
}

/** 감지된 것만 있다(§5.5). 「이상 없음」 행은 애초에 기록되지 않는다. */
export async function loadFlags(execution_id: string): Promise<FlagRow[]> {
  const { data, error } = await db()
    .from('abnormality_flags').select('*')
    .eq('execution_id', execution_id)
    .order('id', { ascending: true })
  if (error) throw new Error(`이상 플래그 조회 실패: ${error.message}`)
  return (data ?? []) as FlagRow[]
}

/* ────────────────────────────────────────────────────────────────
 * abnormality_flags (§5.5)
 * ──────────────────────────────────────────────────────────────── */

export interface FlagEntry {
  execution_id: string
  product_id: string | null
  attempt_no: number
  type: AbnormalityType
  step: string
  detail: string
}

/**
 * 감지된 경우에만 기록한다. "이상 없음" 류는 남기지 않는다.
 *
 * 중복 범위는 `(execution_id, attempt_no, step, type)`이며 DB의 UNIQUE 제약이
 * 강제한다 — `attempt_no`가 올라가면 같은 단계·같은 유형도 새로 기록된다.
 * 중복 충돌은 정상 동작이므로 조용히 넘긴다.
 */
export async function raiseFlag(f: FlagEntry): Promise<void> {
  try {
    const { error } = await db().from('abnormality_flags').insert(f)
    if (error && error.code !== '23505') {
      console.error('[abnormality_flags] 기록 실패', f.type, error.message)
    }
  } catch (e) {
    console.error('[abnormality_flags] 기록 예외', f.type, e)
  }
}

/**
 * 같은 검증 항목이 같은 `attempt_no` 안에서 2회 이상 실패했는지 본다(§5.5).
 * `attempt_no`가 올라가면 자연히 초기화된다 — [다시 생성]은 새 시도다.
 */
async function repeatedFailures(
  execution_id: string, attempt_no: number, items: ValidationItem[],
): Promise<string[]> {
  if (items.length === 0) return []
  try {
    const { data, error } = await db()
      .from('execution_logs')
      .select('output')
      .eq('execution_id', execution_id)
      .eq('attempt_no', attempt_no)
      .eq('verdict', 'fail')
    if (error || !data) return []

    const seen = new Map<string, number>()
    for (const row of data) {
      const prior = (row.output as { items?: ValidationItem[] } | null)?.items ?? []
      for (const it of prior) seen.set(it.검증영역, (seen.get(it.검증영역) ?? 0) + 1)
    }
    // 방금 실패분은 이미 위 조회에 포함돼 있다(로그를 먼저 쓰므로).
    return items.map((i) => i.검증영역).filter((area) => (seen.get(area) ?? 0) >= 2)
  } catch {
    return []
  }
}

export interface DetectContext {
  execution_id: string
  product_id: string | null
  attempt_no: number
  step: string
  elapsedMs: number
  retry_counts: RetryCounts
  /** 이번 요청에서 카운터를 올렸다면 그 이름 */
  bumped?: keyof RetryCounts
  /** 재시도가 소진되어 상태가 확정됐다면 그 설명 */
  aborted?: string
  /** 검증 실패 항목 (반복 실패 판정용) */
  failedItems?: ValidationItem[]
  /** 일차가 부족해 `추후 추가 예정`으로 채운 일차 번호 */
  partialDays?: string[]
}

/**
 * 이상 5종을 정의된 조건대로 감지한다.
 *
 * **반드시 `appendLog` 다음에 호출한다** — 플래그는 기록된 이력을 근거로
 * 판단하므로 로그가 먼저 쌓여야 한다(순서 역전 금지).
 */
export async function detectAbnormalities(ctx: DetectContext): Promise<void> {
  const base = {
    execution_id: ctx.execution_id,
    product_id: ctx.product_id,
    attempt_no: ctx.attempt_no,
    step: ctx.step,
  }

  // 1. retry_accumulated — 카운터가 2에 도달한 시점(= 마지막 재시도 진입)
  if (ctx.bumped && ctx.retry_counts[ctx.bumped] >= RETRY_LIMIT) {
    await raiseFlag({
      ...base, type: 'retry_accumulated',
      detail: `${ctx.bumped} 카운터가 ${RETRY_LIMIT}에 도달했습니다. `
        + '다음 실패 시 해당 축이 fail로 확정됩니다.',
    })
  }

  // 2. pipeline_aborted — 재시도 소진으로 확정. "중단"이 아니라 "확정"이다.
  if (ctx.aborted) {
    await raiseFlag({ ...base, type: 'pipeline_aborted', detail: ctx.aborted })
  }

  // 3. validation_repeated_failure — 같은 항목이 같은 시도 안에서 2회 이상
  const repeated = await repeatedFailures(ctx.execution_id, ctx.attempt_no, ctx.failedItems ?? [])
  if (repeated.length > 0) {
    await raiseFlag({
      ...base, type: 'validation_repeated_failure',
      detail: `같은 검증 항목이 이번 시도에서 2회 이상 실패했습니다: ${repeated.join(', ')}`,
    })
  }

  // 4. processing_delayed — AI 호출이 없는 단계에도 적용한다(DB·Storage 신호)
  if (ctx.elapsedMs > DELAY_THRESHOLD_MS) {
    await raiseFlag({
      ...base, type: 'processing_delayed',
      detail: `요청 소요 ${(ctx.elapsedMs / 1000).toFixed(1)}초. `
        + `임계값 ${DELAY_THRESHOLD_MS / 1000}초(AI 타임아웃의 80%)를 초과했습니다.`,
    })
  }

  // 5. itinerary_partial — 일차 부족분을 `추후 추가 예정`으로 채운 경우
  if (ctx.partialDays && ctx.partialDays.length > 0) {
    await raiseFlag({
      ...base, type: 'itinerary_partial',
      detail: `일정 원문의 일차가 여행기간보다 적어 ${ctx.partialDays.join('·')}일차를 `
        + '`추후 추가 예정`으로 채웠습니다.',
    })
  }
}
