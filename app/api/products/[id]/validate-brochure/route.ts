import type { NextRequest } from 'next/server'
import { runStep } from '@/lib/orchestrator'
import { ai, toLogOutput, ERROR_LABEL } from '@/lib/ai'
import { withAxis, passedAxis } from '@/lib/validation'
import {
  FACTCHECK_SYSTEM, VALIDATION_SCHEMA, type ValidationResult,
} from '@/lib/pipeline/ai-contracts'
import type { ValidationItem } from '@/lib/types'

export const maxDuration = 60

/**
 * Step 04 — 1차 검증 (§8.4). **AI 1회.**
 * 기준값은 `form_input`이다 — `confirmed_data`는 0차의 검증 대상이지 기준이 아니다(§11.1).
 *
 * 재시도가 소진돼도 `input_error`가 아니라 `brochure_ready`가 된다.
 * 소개서는 이미 만들어졌고 사용자 입력에는 문제가 없으므로, 검토 화면에서
 * 실패 항목을 보여주고 [다시 생성]·[입력 수정]을 제공하는 것이 맞다(§8.4).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return runStep(
    { route: 'validate-brochure', step: 'validation_1_completed', productId: id },
    async (p) => {
      const exhaustedWith = (items: ValidationItem[]) => ({
        patch: {
          status: 'brochure_ready' as const,
          validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_1',
            { verdict: 'fail' as const, items }),
        },
        body: { current_step: 'validation_1_completed', items },
        detail: '1차 검증 재시도 소진 — brochure_ready + axis_1 = fail 확정. '
          + '[상품 생성]이 잠기고 [다시 생성]·[입력 수정]이 제공된다.',
      })

      const res = await ai().call<ValidationResult>({
        system: FACTCHECK_SYSTEM,
        user: `## 기준값 (form_input)\n${JSON.stringify(p.form_input, null, 2)}\n\n`
          + `## 참고 (confirmed_data — 정규화 표기 대조용)\n`
          + `${JSON.stringify(p.confirmed_data, null, 2)}\n\n`
          + `## 검사 대상 (brochure_content — 소개서 8개 섹션)\n`
          + `${JSON.stringify(p.brochure_content, null, 2)}\n\n`
          + `각 섹션의 source가 가리키는 경로를 form_input에 적용해 값을 대조하라.\n`
          + `source가 "generated"인 필드는 값 대조 대신 "입력에 없는 요소가 섞였는가"만 본다.`,
        schema: VALIDATION_SCHEMA,
        effort: 'validate',
        label: 'fact-check-1',
      })

      if (!res.ok) {
        const item: ValidationItem = {
          검증영역: '생성', source경로: null, 기준값: '1차 검증 결과',
          발견값: res.errorType, 사유: ERROR_LABEL[res.errorType], 위치: 'brochure_content',
        }
        return {
          type: 'fail', counter: 'brochure', retryFrom: 3, items: [item],
          retryAfterMs: res.retryAfterMs,
          exhausted: exhaustedWith([item]),
          logOutput: toLogOutput(res),
        }
      }

      const items: ValidationItem[] = (res.data.items ?? []).map((i) => ({
        검증영역: i.검증영역, source경로: i.source경로 ?? null,
        기준값: i.기준값, 발견값: i.발견값, 사유: i.사유, 위치: i.위치,
      }))

      if (res.data.판정 === 'fail' && items.length > 0) {
        return {
          type: 'fail', counter: 'brochure', retryFrom: 3, items,
          exhausted: exhaustedWith(items),
          logOutput: { ...toLogOutput(res), items },
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
        logOutput: toLogOutput(res),
      }
    },
  )
}
