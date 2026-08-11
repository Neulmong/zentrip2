import { type NextRequest } from 'next/server'
import { loadProduct, updateProduct } from '@/lib/orchestrator'
import { checkPrecondition, planRestart, RESET_ON, resetCounters } from '@/lib/policy'
import { discardAxes } from '@/lib/validation'
import { appendLog } from '@/lib/logging'
import { conflict, notFound, ok, serverError } from '@/lib/http'
import type { ProductRow } from '@/lib/types'

export const maxDuration = 60

/**
 * §14.4 #8 — `POST /api/products/{id}/regenerate`. **AI 0회.**
 *
 * [다시 생성](§15.3, `brochure_ready`·`draft`)과 [처음부터 다시](§15.1.1,
 * `generating`)가 **같은 라우트를 쓴다.** 그래서 §14.5 #8의 시작 조건에
 * `generating`이 포함된다.
 *
 *   입력은 그대로 두고 AI 작업만 다시 실행한다.
 *   attempt_no +1 · 카운터 4종 0 · status = generating · current_step 되돌림
 *
 * 되돌림 범위는 `planRestart()`가 정한다(§15.3). 시작점 **이전** 축은 보존해야
 * §14.5의 시작 조건을 넘길 수 있다 — 통째로 비우면 재실행이 첫 호출에서 거부된다.
 *
 * 확인 모달(`human_edited`일 때 「편집한 내용이 사라집니다」)은 **클라이언트 몫**이다.
 * 서버가 강제할 수단이 없고, §15.3도 화면 규정으로 적었다.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let p: ProductRow | null
  try {
    p = await loadProduct(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')

  const detail = checkPrecondition('regenerate', p)
  if (detail) return conflict({ reason: 'precondition', detail })

  const plan = planRestart(p)
  const attempt_no = p.attempt_no + 1

  const patch: Partial<ProductRow> = {
    attempt_no,
    status: 'generating',
    current_step: plan.currentStep,
    // 사람이 조작한 시점이므로 카운터를 전부 초기화한다(§11.6 RESET_ON)
    retry_counts: resetCounters(p.retry_counts, RESET_ON.regenerate),
    // 시작점 이전 축은 남는다 — §14.5의 시작 조건이 그 값을 요구한다
    validation_snapshot: discardAxes(p.validation_snapshot, attempt_no, plan.discard),
    /**
     * 이전 시도의 중단 사유를 새 시도에 끌고 오지 않는다.
     * 남겨두면 진행 화면에 지난 실패 문구가 계속 붙어 있다.
     */
    failure_reason: null,
  }

  // 시작점 이후 산출물을 비운다
  for (const col of plan.clear) patch[col] = null

  /**
   * `page_content`를 버리면 그 안에 있던 편집분도 함께 사라진다.
   * 배지를 `사람 편집됨`으로 남겨두면 **없는 편집분을 가리키는 거짓말**이 된다(§10.4).
   * `edit_history`는 그대로 두므로 이력 추적은 유지된다.
   */
  if (plan.clear.includes('page_content')) patch.human_edited = false

  /**
   * `slug`는 어느 경우에도 폐기·재발급하지 않는다(§12.1·§15.3).
   * 주소를 바꾸면 이미 공유된 링크가 끊긴다. patch에 넣지 않는 것으로 보존된다.
   */

  const res = await updateProduct(p, patch).catch((e) => {
    return { ok: false as const, reason: 'error' as const, message: (e as Error).message }
  })
  if (!res.ok) {
    if ('message' in res) return serverError(res.message)
    // §16.1.1 — 그 사이 다른 요청이 갱신했다. 자동 재시도하지 않는다.
    return conflict({ reason: 'stale' })
  }

  await appendLog({
    execution_id: p.execution_id,
    product_id: p.id,
    category: 'pipeline',
    step: 'regenerate_requested',
    attempt_no,
    retry_index: 0,
    // 판정이 아니라 조작 기록이다 (§5.4)
    verdict: '-',
    status: 'generating',
    input: { from_status: p.status, from_step: p.current_step, human_edited: p.human_edited },
    output: {
      restart_from: plan.from,
      current_step: plan.currentStep,
      discarded_axes: plan.discard,
      cleared: plan.clear,
    },
  })

  return ok({
    current_step: plan.currentStep,
    /** 클라이언트는 이 번호부터 순차 호출을 재개한다 — `retry_from`과 같은 체계다 */
    restart_from: plan.from,
    axes: res.row.validation_snapshot?.axes,
  })
}
