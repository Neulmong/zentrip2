import { NextResponse, type NextRequest } from 'next/server'
import { badRequest, conflict, serverError } from '@/lib/http'
import { runPlanDraft } from '@/lib/harness/draft'

/** spec §4.2 — 서버리스 실행 시간 상한. AI 1회를 쓰는 라우트다(§7.5) */
export const maxDuration = 60

/**
 * #20 — 자연어 초안 (§7.5). **AI 1회.**
 *
 * 상품 행을 만들지 않고 DB에 쓰지 않는다. `execution_logs`에도 남지 않는다 —
 * 그 테이블이 `product_id`를 요구하고, 이 시점에는 상품이 없다(§5.4).
 *
 * 인증은 `proxy.ts`가 `/api/*` 전체에 걸어 둔다(§14.2). 여기서 다시 보지 않는다.
 *
 * 라우트가 하는 일은 **요청을 읽고 하네스를 한 번 부르는 것**뿐이다(규약 R1).
 * 체인 순서·AI 예산은 `manifest.json`에서 오고 `lib/harness/draft.ts`가 강제한다.
 */
export async function POST(req: NextRequest) {
  let body: { text?: unknown; 여행기간_시작?: unknown; 여행기간_종료?: unknown }
  try {
    body = await req.json()
  } catch {
    return badRequest({ text: '요청 본문을 읽을 수 없습니다.' })
  }

  if (typeof body.text !== 'string') {
    return badRequest({ text: '메모를 입력해 주세요.' })
  }

  /*
   * 사람이 고른 여행기간 — 텍스트에 연도가 없을 때만 온다(`11.04~11.08`).
   * 둘 다 있어야 쓴다. 한쪽만 오면 무시한다 — 반쪽 날짜로 일수를 계산하면
   * 일차 수가 어긋나고 그것이 이미지 슬롯 수까지 밀어낸다(§6.2.1).
   */
  const 시작 = typeof body.여행기간_시작 === 'string' ? body.여행기간_시작 : ''
  const 종료 = typeof body.여행기간_종료 === 'string' ? body.여행기간_종료 : ''
  const hint = 시작 && 종료 ? { 시작, 종료 } : undefined

  try {
    const outcome = await runPlanDraft({ text: body.text, hint })

    if (outcome.kind === 'input_error') {
      return badRequest({ [outcome.field]: outcome.reason })
    }

    /*
     * AI 실패는 §4.3의 정상 경로다. 카운터가 없으므로 소진도 없고, 복귀 대상은
     * **이 라우트 자신**이다(#20) — 화면의 [다시 채우기]가 그 경로다.
     */
    if (outcome.kind === 'ai_fail') {
      return conflict({ reason: 'retry', retry_from: 20 })
    }

    return NextResponse.json(outcome.body, { status: 200 })
  } catch (e) {
    // 배선 오류(등록되지 않은 스킬·예산 초과)는 여기로 온다. 재호출로 낫지 않는다
    return serverError(`초안 생성 실패: ${(e as Error).message}`)
  }
}
