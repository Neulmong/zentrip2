import type { NextRequest } from 'next/server'
import { runStep } from '@/lib/orchestrator'
import { ai, toLogOutput, ERROR_LABEL } from '@/lib/ai'
import { withAxis, failedAxis } from '@/lib/validation'
import { buildBrochure, checkBrochure } from '@/lib/pipeline/brochure'
import { OVERVIEW_SCHEMA, OVERVIEW_SYSTEM } from '@/lib/pipeline/ai-contracts'
import type { ConfirmedData } from '@/lib/pipeline/normalize'
import type { ValidationItem } from '@/lib/types'

export const maxDuration = 60

/**
 * Step 03 — 소개서 생성 (§8.3). **AI 1회.**
 *
 * 값 필드는 기계 치환하고 AI는 `overview.핵심일정`만 만든다 —
 * 근거는 `lib/pipeline/brochure.ts` 상단.
 *
 * 생성 실패는 1차 검증 실패와 **같은 카운터·같은 소진 상태**를 쓴다.
 * 기획자에게는 둘 다 "소개서가 제대로 안 나왔다"이고 복귀 대상도 동일하다(§8.3).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return runStep(
    { route: 'brochure', step: 'brochure_generated', productId: id },
    async (p) => {
      const cd = p.confirmed_data as ConfirmedData

      /** 소진 시 — 소개서 검토 화면으로 보내고 실패 항목을 남긴다(§8.3). */
      const exhaustedWith = (item: ValidationItem) => ({
        patch: {
          status: 'brochure_ready' as const,
          validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_1', failedAxis(item)),
        },
        body: { current_step: p.current_step, items: [item] },
        detail: '소개서 생성 재시도 소진 — brochure_ready + axis_1 = fail 확정',
      })

      const res = await ai().call<{ 핵심일정: string }>({
        system: OVERVIEW_SYSTEM,
        user: `아래 일차별 서술을 근거로 「핵심일정」을 2~3문장으로 요약하라.\n`
          + `여행지: ${cd.행사정보.여행지} / 여행기간: ${cd.행사정보.여행기간}\n\n`
          + cd.행사정보.일정.map((d) => `${d.day}일차: ${d.내용}`).join('\n'),
        schema: OVERVIEW_SCHEMA,
        effort: 'generate',
        label: 'intro-overview',
      })

      if (!res.ok) {
        return {
          type: 'fail', counter: 'brochure', retryFrom: 3,
          items: [{
            검증영역: '생성', source경로: null, 기준값: '소개서 개요',
            발견값: res.errorType, 사유: ERROR_LABEL[res.errorType], 위치: 'b_overview.data.핵심일정',
          }],
          exhausted: exhaustedWith({
            검증영역: '생성', source경로: null, 기준값: '소개서 개요',
            발견값: res.errorType, 사유: ERROR_LABEL[res.errorType], 위치: 'b_overview.data.핵심일정',
          }),
          logOutput: toLogOutput(res),
        }
      }

      const brochure = buildBrochure(cd, res.data.핵심일정.trim())

      // 서버 검사 (AI 호출 없음) — 섹션 8개·순서, source 누락, 미치환 토큰, 길이 계약
      const errors = checkBrochure(brochure)
      if (errors.length > 0) {
        const item: ValidationItem = {
          검증영역: '생성', source경로: null, 기준값: '§8.7 스키마',
          발견값: errors[0], 사유: errors.join(' / '), 위치: 'brochure_content',
        }
        return {
          type: 'fail', counter: 'brochure', retryFrom: 3, items: [item],
          exhausted: exhaustedWith(item),
          logOutput: { ...toLogOutput(res), server_checks: errors },
        }
      }

      return {
        type: 'ok',
        patch: { brochure_content: brochure, current_step: 'brochure_generated' },
        body: { current_step: 'brochure_generated' },
        logOutput: toLogOutput(res),
      }
    },
  )
}
