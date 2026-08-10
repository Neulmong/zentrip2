import { createHash } from 'node:crypto'
import type {
  AxisName, AxisResult, ProductRow, ValidationItem, ValidationSnapshot,
} from './types'

/** §11.3 — 검증 스냅샷 구조와 판정 계산. */

export const ALL_AXES: AxisName[] = ['axis_0', 'axis_1', 'axis_2', 'axis_3']

export function emptySnapshot(attempt_no: number): ValidationSnapshot {
  return {
    attempt_no,
    verdict: 'pass',
    validated_at: new Date().toISOString(),
    content_hash: null,
    axes: { axis_0: null, axis_1: null, axis_2: null, axis_3: null },
  }
}

/** 축의 판정. 미실행이면 null. */
export function axisVerdict(p: ProductRow, axis: AxisName): 'pass' | 'fail' | null {
  return p.validation_snapshot?.axes?.[axis]?.verdict ?? null
}

export function axisPassed(p: ProductRow, axis: AxisName): boolean {
  return axisVerdict(p, axis) === 'pass'
}

/**
 * 최상위 verdict는 **완료된 전 축이 통과했을 때만** pass다.
 * 아직 실행되지 않은 축(null)은 계산에 넣지 않는다(§11.3).
 */
export function computeVerdict(axes: ValidationSnapshot['axes']): 'pass' | 'fail' {
  return ALL_AXES.some((a) => axes[a]?.verdict === 'fail') ? 'fail' : 'pass'
}

/** 한 축의 결과를 기록하고 최상위 verdict를 다시 계산한다. */
export function withAxis(
  snapshot: ValidationSnapshot | null,
  attempt_no: number,
  axis: AxisName,
  result: AxisResult,
): ValidationSnapshot {
  const base = snapshot ?? emptySnapshot(attempt_no)
  const axes = { ...base.axes, [axis]: result }
  return { ...base, attempt_no, axes, verdict: computeVerdict(axes), validated_at: new Date().toISOString() }
}

/**
 * [다시 생성]·재제출 시 시작점 **이후** 축만 폐기한다(§15.3).
 * 통째로 비우면 §14.5의 시작 조건(`axis_0 = pass`·`axis_1 = pass`)을
 * 충족할 수 없어 재실행 자체가 거부된다.
 */
export function discardAxes(
  snapshot: ValidationSnapshot | null,
  attempt_no: number,
  discard: AxisName[],
): ValidationSnapshot {
  const base = snapshot ?? emptySnapshot(attempt_no)
  const axes = { ...base.axes }
  for (const a of discard) axes[a] = null
  return { ...base, attempt_no, axes, verdict: computeVerdict(axes) }
}

/** 실패 1건짜리 축 결과. 생성 실패를 축 실패로 기록할 때 쓴다(§8.3). */
export function failedAxis(item: ValidationItem, skipped?: string[]): AxisResult {
  return { verdict: 'fail', items: [item], ...(skipped ? { skipped } : {}) }
}

export function passedAxis(skipped?: string[]): AxisResult {
  return { verdict: 'pass', items: [], ...(skipped ? { skipped } : {}) }
}

/* ── content_hash (§11.3) ──────────────────────────────────────── */

/** 키를 사전순 정렬해 직렬화한다. 정렬 없이 해싱하면 같은 내용이 다른 해시를 낸다. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * 검증 시점 `page_content`의 SHA-256.
 * 용도는 배지 판정이 아니라 **검증 시점 추적**이다 — 현재 해시와 다르면
 * 그 이후 편집이 있었다는 뜻이며 관리 화면에 "검증 이후 편집됨"으로 표시한다.
 */
export function contentHash(pageContent: unknown): string {
  return 'sha256:' + createHash('sha256').update(stableStringify(pageContent)).digest('hex')
}
