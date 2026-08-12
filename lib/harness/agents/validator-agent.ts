import type { StepOutcome } from '@/lib/orchestrator'
import { contentHash, passedAxis, withAxis } from '@/lib/validation'
import type { PageContent } from '@/lib/pipeline/page'
import type { ValidationItem } from '@/lib/types'
import { 생성실패 } from './shared'
import type { HarnessContext } from '../context'

/**
 * `validator-agent` — 라우트 ④·⑥·⑦의 응답 결정 (§11.2~§11.4).
 *
 * 세 축 모두 「통과/실패와 항목만」 판정하고 **재시도 여부는 판단하지 않는다**.
 * 축마다 다른 것은 실패가 확정될 때의 **도달 화면**이다:
 *   · 1차 → `brochure_ready` (소개서 검토, [상품 생성] 잠김)
 *   · 2차 → `draft` (편집기. `draft_registered`를 여기서 기록한다)
 *   · 3차 → `draft` (통과·실패 어느 쪽이든 등록한다)
 */

/** AI가 fail을 냈지만 항목이 비었으면 실패로 세지 않는다 — 근거 없는 반려다 */
function 실패인가(c: HarnessContext): boolean {
  return c.verdict === 'fail' && c.items.length > 0
}

/* ── ④ 1차 — 소개서 사실정보 (§11.2) ────────────────────────── */

export function validateBrochure(c: HarnessContext): StepOutcome {
  const p = c.p

  const exhaustedWith = (items: ValidationItem[]) => ({
    patch: {
      status: 'brochure_ready' as const,
      validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_1',
        { verdict: 'fail' as const, items }),
    },
    body: { current_step: 'validation_1_completed', axes: { axis_1: 'fail' as const }, items },
    detail: '1차 검증 재시도 소진 — brochure_ready + axis_1 = fail 확정. '
      + '[상품 생성]이 잠기고 [다시 생성]·[입력 수정]이 제공된다.',
  })

  if (c.aiFail) {
    const item = 생성실패(c.aiFail, '1차 검증 결과', 'brochure_content')
    return {
      type: 'fail', counter: 'brochure', retryFrom: 3, items: [item],
      retryAfterMs: c.aiFail.retryAfterMs,
      exhausted: exhaustedWith([item]),
      logOutput: c.aiLog,
    }
  }

  if (실패인가(c)) {
    return {
      type: 'fail', counter: 'brochure', retryFrom: 3, items: c.items,
      exhausted: exhaustedWith(c.items),
      logOutput: { ...c.aiLog, items: c.items },
    }
  }

  // 통과 — 소개서 검토 화면으로. [상품 생성]이 활성된다(§15.1).
  return {
    type: 'ok',
    patch: {
      status: 'brochure_ready',
      current_step: 'validation_1_completed',
      validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_1', passedAxis()),
    },
    body: { current_step: 'validation_1_completed', axes: { axis_1: 'pass' }, items: [] },
    logOutput: c.aiLog,
  }
}

/* ── ⑥ 2차 — 페이지 사실정보 (§11.3). 주 검증이다 ───────────── */

export function validatePage(c: HarnessContext): StepOutcome {
  const p = c.p
  const page = p.page_content as PageContent

  /*
   * 소진 시 `draft`로 전이하고 **`draft_registered`를 여기서 기록한다** —
   * 2차가 실패로 확정되면 클라이언트가 ③을 호출하지 않으므로, 아무도
   * 등록하지 않으면 어떻게 임시저장에 도달했는지 알 수 없게 된다(§9.5).
   * 이때 `axis_3`은 `null`(미실행)로 남는다.
   */
  const exhaustedWith = (items: ValidationItem[]) => ({
    patch: {
      status: 'draft' as const,
      current_step: 'draft_registered' as const,
      validation_snapshot: {
        ...withAxis(p.validation_snapshot, p.attempt_no, 'axis_2',
          { verdict: 'fail' as const, items }),
        content_hash: contentHash(page),
      },
    },
    body: { current_step: 'draft_registered', axes: { axis_2: 'fail' as const }, items },
    detail: '2차 검증 재시도 소진 — draft 확정, axis_3은 미실행(null). '
      + '편집·[다시 생성]·책임 게시 경로가 유지된다.',
    trailingLogs: ['draft_registered' as const],
  })

  if (c.aiFail) {
    const item = 생성실패(c.aiFail, '2차 검증 결과', 'page_content')
    return {
      type: 'fail', counter: 'page', retryFrom: 5, items: [item],
      retryAfterMs: c.aiFail.retryAfterMs,
      exhausted: exhaustedWith([item]),
      logOutput: c.aiLog,
    }
  }

  if (실패인가(c)) {
    return {
      type: 'fail', counter: 'page', retryFrom: 5, items: c.items,
      exhausted: exhaustedWith(c.items),
      logOutput: { ...c.aiLog, items: c.items },
    }
  }

  // 통과 — 클라이언트가 ③(3차)을 호출한다. 여기서는 아직 draft가 아니다.
  return {
    type: 'ok',
    patch: {
      current_step: 'validation_2_completed',
      validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_2', passedAxis()),
    },
    body: { current_step: 'validation_2_completed', axes: { axis_2: 'pass' }, items: [] },
    logOutput: c.aiLog,
  }
}

/* ── ⑦ 3차 — 소개서 ↔ 페이지 정합성 + draft 등록 (§11.4) ────── */

export function validateConsistency(c: HarnessContext): StepOutcome {
  const p = c.p
  const page = p.page_content as PageContent

  /** 통과·소진 어느 쪽이든 `draft`로 등록한다. 생성물은 유지된다(§11.5). */
  const register = (axis3: { verdict: 'pass' | 'fail'; items: ValidationItem[] }) => ({
    status: 'draft' as const,
    current_step: 'draft_registered' as const,
    validation_snapshot: {
      ...withAxis(p.validation_snapshot, p.attempt_no, 'axis_3', { ...axis3, skipped: ['apply'] }),
      content_hash: contentHash(page),
    },
  })

  const exhaustedWith = (items: ValidationItem[]) => ({
    patch: register({ verdict: 'fail' as const, items }),
    body: { current_step: 'draft_registered', axes: { axis_3: 'fail' as const }, items },
    detail: '3차 검증 재시도 소진 — draft 확정, axis_3 = fail. '
      + '편집·[다시 생성]·책임 게시 경로가 유지된다.',
    trailingLogs: ['draft_registered' as const],
  })

  if (c.aiFail) {
    const item = 생성실패(c.aiFail, '3차 검증 결과', 'page_content')
    return {
      type: 'fail', counter: 'consistency', retryFrom: 5, items: [item],
      retryAfterMs: c.aiFail.retryAfterMs,
      exhausted: exhaustedWith([item]),
      logOutput: c.aiLog,
    }
  }

  if (실패인가(c)) {
    return {
      type: 'fail', counter: 'consistency', retryFrom: 5, items: c.items,
      exhausted: exhaustedWith(c.items),
      logOutput: { ...c.aiLog, items: c.items },
    }
  }

  return {
    type: 'ok',
    patch: register({ verdict: 'pass', items: [] }),
    body: {
      current_step: 'draft_registered',
      axes: { axis_3: 'pass' }, verdict: 'pass', slug: p.slug ?? undefined, items: [],
    },
    logOutput: c.aiLog,
    trailingLogs: ['draft_registered'],
  }
}
