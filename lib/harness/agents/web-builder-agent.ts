import type { StepOutcome } from '@/lib/orchestrator'
import { failedAxis, withAxis } from '@/lib/validation'
import type { ValidationItem } from '@/lib/types'
import { 계약실패, 생성실패 } from './shared'
import type { HarnessContext } from '../context'

/**
 * `web-builder-agent` — 라우트 ⑤의 응답 결정 (§9.5 ①).
 *
 * 재시도 소진 시 **`draft`로 가지 않고 `brochure_ready`로 되돌린다** —
 * `page_content`가 없으면 편집기가 렌더링할 대상이 없고 §14.5 #10의 편집
 * 시작 조건도 `page_content` 존재를 요구한다.
 */
export function page(c: HarnessContext): StepOutcome {
  const p = c.p

  /** 소진 시 — 소개서 검토 화면으로 되돌린다(§9.5). */
  const exhaustedWith = (item: ValidationItem) => ({
    patch: {
      status: 'brochure_ready' as const,
      validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_2',
        failedAxis(item)),
    },
    body: { current_step: p.current_step, axes: { axis_2: 'fail' as const }, items: [item] },
    detail: '페이지 생성 재시도 소진 — draft가 아니라 brochure_ready로 되돌림 (§9.5)',
  })

  if (c.aiFail) {
    const item = 생성실패(c.aiFail, '페이지 콘텐츠', 'page_content')
    return {
      type: 'fail', counter: 'page', retryFrom: 5, items: [item],
      retryAfterMs: c.aiFail.retryAfterMs,
      exhausted: exhaustedWith(item),
      logOutput: c.aiLog,
    }
  }

  if (c.errors.length > 0) {
    const item = 계약실패(c.errors, '§9.3 스키마', 'page_content')
    return {
      type: 'fail', counter: 'page', retryFrom: 5, items: [item],
      exhausted: exhaustedWith(item),
      logOutput: { ...c.aiLog, server_checks: c.errors },
    }
  }

  if (c.slug충돌) {
    const item: ValidationItem = {
      검증영역: 'slug', source경로: null, 기준값: '고유 slug',
      발견값: c.slug충돌, 사유: 'slug 중복이 해소되지 않았습니다.', 위치: 'products.slug',
    }
    return {
      type: 'fail', counter: 'page', retryFrom: 5, items: [item],
      exhausted: exhaustedWith(item),
      logOutput: c.aiLog,
    }
  }

  return {
    type: 'ok',
    patch: { page_content: c.page, slug: c.slug, current_step: 'page_generated' },
    body: { current_step: 'page_generated', slug: c.slug ?? undefined },
    logOutput: {
      ...c.aiLog, theme: c.theme, slug: c.slug,
      slots: c.materials.imageSlots.map((r) => r.slot),
    },
  }
}
