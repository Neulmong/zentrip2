import type { StepOutcome } from '@/lib/orchestrator'
import { failedAxis, passedAxis, withAxis } from '@/lib/validation'
import { ERROR_LABEL, 생성실패 } from './shared'
import type { HarnessContext } from '../context'

/**
 * `intake-agent` — 라우트 ②의 응답 결정 (§8.2).
 *
 * 스킬 체인이 만든 결과(`HarnessContext`)를 `StepOutcome`으로 옮기는 것이
 * 에이전트의 일이다. **판정은 스킬이 했고, 여기서는 그 판정을 응답 코드와
 * 복귀 경로로 번역한다** — 에이전트 문서가 규정하는 역할이다.
 *
 * 실패 갈래가 둘이다:
 *   · **입력 문제**(일차 초과·구분 불가) → 카운터를 쓰지 않고 즉시 422
 *   · **생성 문제**(AI 실패·0차 실패) → 카운터 +1 후 409 `retry_from: 2`
 */
export function decompose(c: HarnessContext): StepOutcome {
  const p = c.p

  /* ── AI 실패 → 생성 문제 ─────────────────────────────────── */
  if (c.aiFail) {
    const item = 생성실패(c.aiFail, '일차 분해 결과', 'confirmed_data.행사정보.일정')
    return {
      type: 'fail', counter: 'normalization', retryFrom: 2, items: [item],
      retryAfterMs: c.aiFail.retryAfterMs,
      exhausted: {
        patch: {
          status: 'input_error',
          failure_reason: `일정 분해에 반복 실패했습니다. ${ERROR_LABEL[c.aiFail.errorType]}`,
        },
        body: { current_step: p.current_step, failure_reason: '일정 분해 실패' },
        detail: '0차 재시도 소진으로 input_error 확정',
      },
      logOutput: c.aiLog,
    }
  }

  /* ── 분해 실패 → 입력 문제. 카운터를 쓰지 않는다 (§8.2 5항) ─ */
  if (c.stop === 'input_error') {
    if (c.분해판정 === 'day_overflow') {
      return {
        type: 'input_error',
        failure_reason: `일정에 적힌 일차 수가 여행기간(${c.days}일)보다 많습니다. `
          + '일정의 일수와 여행기간이 같아야 합니다. '
          + "입력 화면에서 '여행기간' 또는 '일정 > 일정 원문'을 맞춘 뒤 다시 제출해 주세요.",
        logOutput: c.aiLog,
      }
    }
    return {
      type: 'input_error',
      failure_reason: '일정에서 일차 구분을 찾을 수 없습니다. '
        + '어느 내용이 몇 일차인지 알 수 없으면 일정을 임의로 나눌 수 없습니다. '
        + "입력 화면에서 '일정 > 일정 원문'에 '1일:', '2일:'처럼 일차 구분을 넣어 다시 제출해 주세요.",
      logOutput: c.aiLog,
    }
  }

  /* ── 0차 검증 실패 ───────────────────────────────────────── */
  if (c.items.length > 0) {
    return {
      type: 'fail', counter: 'normalization', retryFrom: 2, items: c.items,
      /*
       * **분해는 성공했다.** 실패한 것은 0차 검증이다(§5.4).
       * 명시하지 않으면 주 판정(fail)을 따르므로, 여기서만 통과를 주장한다.
       * AI 실패·분해 실패 갈래에는 이 값이 없다 — 그때는 분해 자체가 없었다.
       */
      extraVerdicts: { itinerary_decomposed: 'pass' },
      exhausted: {
        patch: {
          status: 'input_error',
          failure_reason: '정규화·일차 분해가 반복 실패했습니다. '
            + '입력에 처리할 수 없는 요소가 있는지 확인한 뒤 다시 제출해 주세요.',
          validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_0',
            failedAxis(c.items[0])),
        },
        body: { current_step: p.current_step, axes: { axis_0: 'fail' as const }, items: c.items },
        detail: '0차 재시도 소진으로 input_error 확정 (§15.2)',
      },
      logOutput: { ...c.aiLog, items: c.items, changes: c.changes },
    }
  }

  /* ── 통과 ────────────────────────────────────────────────── */
  return {
    type: 'ok',
    patch: {
      confirmed_data: c.cd,
      current_step: 'normalization_validated',
      validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_0', passedAxis()),
    },
    body: { current_step: 'normalization_validated', axes: { axis_0: 'pass' } },
    partialDays: c.partialDays,
    logOutput: {
      ...c.aiLog, changes: c.changes, 부분채움: c.partialDays,
      // §6.3 2단계의 「표시」 — 실패가 아니다. 3단계(AI 판정)가 붙기 전까지 추적용이다
      ...(c.위반후보.length ? { 명사구_위반후보: c.위반후보.map((n) => n.후보) } : {}),
    },
  }
}
