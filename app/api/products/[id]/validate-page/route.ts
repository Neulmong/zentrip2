import type { NextRequest } from 'next/server'
import { runStep } from '@/lib/orchestrator'
import { db } from '@/lib/supabase'
import { ai, toLogOutput, ERROR_LABEL } from '@/lib/ai'
import { withAxis, passedAxis, contentHash } from '@/lib/validation'
import {
  FACTCHECK_SYSTEM, VALIDATION_SCHEMA, type ValidationResult,
} from '@/lib/pipeline/ai-contracts'
import type { PageContent } from '@/lib/pipeline/page'
import type { ValidationItem } from '@/lib/types'

export const maxDuration = 60

/**
 * Step 06 — 2차 검증 (§9.5 ②). **AI 1회. 주 검증이다.**
 *
 * 소진 시 `status = draft`로 전이하고 **`draft_registered`를 이 라우트가 기록한다** —
 * 2차가 실패로 확정되면 클라이언트가 ③을 호출하지 않으므로, 아무도 등록하지
 * 않으면 로그가 빠져 어떻게 임시저장에 도달했는지 알 수 없게 된다(§9.5).
 * 이때 `axis_3`은 `null`(미실행)로 남는다.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return runStep(
    { route: 'validate-page', step: 'validation_2_completed', productId: id },
    async (p) => {
      const page = p.page_content as PageContent

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
        body: { current_step: 'draft_registered', items },
        detail: '2차 검증 재시도 소진 — draft 확정, axis_3은 미실행(null). '
          + '편집·[다시 생성]·책임 게시 경로가 유지된다.',
        // ②가 draft 전이와 로그를 함께 담당한다(§9.5)
        trailingLogs: ['draft_registered' as const],
      })

      // 업로드 시 지정된 슬롯·대체 텍스트 (§11.2 이미지 검증)
      const { data: imageRows } = await db()
        .from('product_images').select('slot,alt').eq('product_id', p.id)

      const res = await ai().call<ValidationResult>({
        system: FACTCHECK_SYSTEM,
        user: `## 기준값 (form_input)\n${JSON.stringify(p.form_input, null, 2)}\n\n`
          + `## 참고 (confirmed_data — 정규화 표기 대조용)\n`
          + `${JSON.stringify(p.confirmed_data, null, 2)}\n\n`
          + `## 검사 대상 (page_content — 페이지 9개 섹션)\n`
          + `${JSON.stringify(page, null, 2)}\n\n`
          + `## 업로드된 이미지 슬롯\n${JSON.stringify(imageRows ?? [], null, 2)}\n\n`
          + `각 섹션의 source가 가리키는 경로를 form_input에 적용해 값을 대조하라.\n`
          + `추가로 확인할 것:\n`
          + `- image_slot·image_slots 값이 위 목록의 슬롯과 같은가 (빈 문자열은 미업로드로 정상)\n`
          + `- hero.headline이 행사명 그대로이고 40자 이내인가\n`
          + `- apply 내부의 가격요약·행사정보요약이 price·hero와 일치하는가\n`
          + `- 테마 적용으로 섹션 구성·문구·사실정보가 바뀌지 않았는가`,
        schema: VALIDATION_SCHEMA,
        effort: 'validate',
        label: 'fact-check-2',
      })

      if (!res.ok) {
        const item: ValidationItem = {
          검증영역: '생성', source경로: null, 기준값: '2차 검증 결과',
          발견값: res.errorType, 사유: ERROR_LABEL[res.errorType], 위치: 'page_content',
        }
        return {
          type: 'fail', counter: 'page', retryFrom: 5, items: [item],
          retryAfterMs: res.retryAfterMs,
          exhausted: exhaustedWith([item]), logOutput: toLogOutput(res),
        }
      }

      const items: ValidationItem[] = (res.data.items ?? []).map((i) => ({
        검증영역: i.검증영역, source경로: i.source경로 ?? null,
        기준값: i.기준값, 발견값: i.발견값, 사유: i.사유, 위치: i.위치,
      }))

      if (res.data.판정 === 'fail' && items.length > 0) {
        return {
          type: 'fail', counter: 'page', retryFrom: 5, items,
          exhausted: exhaustedWith(items),
          logOutput: { ...toLogOutput(res), items },
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
        logOutput: toLogOutput(res),
      }
    },
  )
}
