import type { StepOutcome } from '@/lib/orchestrator'
import { failedAxis, withAxis } from '@/lib/validation'
import type { ValidationItem } from '@/lib/types'
import { 계약실패, 생성실패 } from './shared'
import type { HarnessContext } from '../context'

/**
 * `content-writer-agent` — 라우트 ③의 응답 결정 (§8.3).
 *
 * 생성 실패는 1차 검증 실패와 **같은 카운터·같은 소진 상태**를 쓴다.
 * 기획자에게는 둘 다 "소개서가 제대로 안 나왔다"이고 복귀 대상도 동일하다.
 */
export function brochure(c: HarnessContext): StepOutcome {
  const p = c.p

  /** 소진 시 — 소개서 검토 화면으로 보내고 실패 항목을 남긴다(§8.3). */
  const exhaustedWith = (item: ValidationItem) => ({
    patch: {
      status: 'brochure_ready' as const,
      validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_1',
        failedAxis(item)),
    },
    body: { current_step: p.current_step, axes: { axis_1: 'fail' as const }, items: [item] },
    detail: '소개서 생성 재시도 소진 — brochure_ready + axis_1 = fail 확정',
  })

  if (c.aiFail) {
    const item = 생성실패(c.aiFail, '소개서 개요', 'b_overview.data.핵심일정')
    return {
      type: 'fail', counter: 'brochure', retryFrom: 3, items: [item],
      retryAfterMs: c.aiFail.retryAfterMs,
      exhausted: exhaustedWith(item),
      logOutput: c.aiLog,
    }
  }

  // 계약 검사(섹션·source·토큰·길이) + 보호값 검증 + 메모 유출 — 모아서 한 항목이다
  if (c.errors.length > 0) {
    const item = 계약실패(c.errors, '§8.7 스키마', 'brochure_content')
    return {
      type: 'fail', counter: 'brochure', retryFrom: 3, items: [item],
      exhausted: exhaustedWith(item),
      logOutput: { ...c.aiLog, server_checks: c.errors },
    }
  }

  return {
    type: 'ok',
    patch: { brochure_content: c.brochure, current_step: 'brochure_generated' },
    body: { current_step: 'brochure_generated' },
    logOutput: c.aiLog,
  }
}
