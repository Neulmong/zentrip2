import type { NextRequest } from 'next/server'
import { runStep } from '@/lib/orchestrator'
import { ai, toLogOutput, ERROR_LABEL } from '@/lib/ai'
import { withAxis, contentHash } from '@/lib/validation'
import {
  CONSISTENCY_SYSTEM, VALIDATION_SCHEMA, type ValidationResult,
} from '@/lib/pipeline/ai-contracts'
import type { PageContent } from '@/lib/pipeline/page'
import type { ValidationItem } from '@/lib/types'

export const maxDuration = 60

/**
 * Step 07 — 3차 검증 + draft 등록 (§9.5 ③). **AI 1회.**
 *
 * 1·2차가 모두 통과하면 3차는 논리적으로 통과해야 한다(둘 다 `form_input`과
 * 일치하므로). 따라서 3차는 사실정보 재확인이 아니라 **교차 검증·회귀 감지**다 —
 * `source` 맵 누락, 두 생성 경로의 스키마 드리프트, 검증에서 빠진 필드를 잡는다.
 *
 * **2차 실패 시 이 라우트는 호출되지 않는다**(§11.1). 시작 조건이 `axis_2 = pass`다.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return runStep(
    { route: 'validate-consistency', step: 'validation_3_completed', productId: id },
    async (p) => {
      const page = p.page_content as PageContent

      /** 통과·소진 어느 쪽이든 `draft`로 등록한다. 생성물은 유지된다(§11.5). */
      const register = (axis3: { verdict: 'pass' | 'fail'; items: ValidationItem[] }) => ({
        status: 'draft' as const,
        current_step: 'draft_registered' as const,
        validation_snapshot: {
          ...withAxis(p.validation_snapshot, p.attempt_no, 'axis_3',
            { ...axis3, skipped: ['apply'] }),
          content_hash: contentHash(page),
        },
      })

      const exhaustedWith = (items: ValidationItem[]) => ({
        patch: register({ verdict: 'fail', items }),
        body: { current_step: 'draft_registered', items },
        detail: '3차 검증 재시도 소진 — draft 확정, axis_3 = fail. '
          + '편집·[다시 생성]·책임 게시 경로가 유지된다.',
        trailingLogs: ['draft_registered' as const],
      })

      const res = await ai().call<ValidationResult>({
        system: CONSISTENCY_SYSTEM,
        user: `## 소개서 (brochure_content)\n${JSON.stringify(p.brochure_content, null, 2)}\n\n`
          + `## 상품 페이지 (page_content)\n${JSON.stringify(page, null, 2)}\n\n`
          + `섹션 대응표대로 사실정보 값을 대조하라. sec_apply는 제외한다.\n`
          + `원문근거는 대조하지 않는다 — 그 필드는 confirmed_data에만 있고 0차의 몫이다.`,
        schema: VALIDATION_SCHEMA,
        effort: 'validate',
        label: 'consistency-check',
      })

      if (!res.ok) {
        const item: ValidationItem = {
          검증영역: '생성', source경로: null, 기준값: '3차 검증 결과',
          발견값: res.errorType, 사유: ERROR_LABEL[res.errorType], 위치: 'page_content',
        }
        return {
          type: 'fail', counter: 'consistency', retryFrom: 5, items: [item],
          exhausted: exhaustedWith([item]), logOutput: toLogOutput(res),
        }
      }

      const items: ValidationItem[] = (res.data.items ?? []).map((i) => ({
        검증영역: i.검증영역, source경로: i.source경로 ?? null,
        기준값: i.기준값, 발견값: i.발견값, 사유: i.사유, 위치: i.위치,
      }))

      if (res.data.판정 === 'fail' && items.length > 0) {
        return {
          type: 'fail', counter: 'consistency', retryFrom: 5, items,
          exhausted: exhaustedWith(items),
          logOutput: { ...toLogOutput(res), items },
        }
      }

      // 통과 — verdict = pass 확정 후 draft 등록(§9.5)
      return {
        type: 'ok',
        patch: register({ verdict: 'pass', items: [] }),
        body: {
          current_step: 'draft_registered',
          axes: { axis_3: 'pass' }, verdict: 'pass', slug: p.slug, items: [],
        },
        logOutput: toLogOutput(res),
        trailingLogs: ['draft_registered'],
      }
    },
  )
}
