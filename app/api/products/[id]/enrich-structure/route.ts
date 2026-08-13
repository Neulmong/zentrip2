import { NextResponse, type NextRequest } from 'next/server'
import { loadProduct, updateProduct } from '@/lib/orchestrator'
import { badRequest, conflict, notFound, serverError } from '@/lib/http'
import { runEnrichStructure } from '@/lib/harness/enrichment'
import type { ConfirmedData } from '@/lib/pipeline/normalize'
import type { PageContent } from '@/lib/pipeline/page'
import type { GroundingSource } from '@/lib/ai'
import type { ProductRow } from '@/lib/types'

/** AI 1회(구조화)를 쓰는 라우트다(§4.2). */
export const maxDuration = 60

interface Body {
  grounded_text?: unknown
  sources?: unknown
  /** §16.1.1 — 클라이언트가 읽은 시점 */
  updated_at?: unknown
}

/** {title, uri} 형태만 남긴다 — 클라이언트가 실어 보낸 값이라 방어한다 */
function validSources(v: unknown): GroundingSource[] {
  if (!Array.isArray(v)) return []
  const out: GroundingSource[] = []
  for (const s of v) {
    const uri = (s as { uri?: unknown })?.uri
    const title = (s as { title?: unknown })?.title
    if (typeof uri === 'string' && uri) {
      out.push({ uri, title: typeof title === 'string' && title ? title : uri })
    }
  }
  return out
}

/**
 * Task 2 — place-enrichment **2단계 (구조화·저장)**. AI 1회(responseSchema).
 *
 * 1단계가 돌려준 검색 텍스트·출처를 받아 장소별로 구조화하고, 실존 대조를 통과한
 * 장소만 `page_content.enrichment`에 병합해 조건부 갱신한다(§16.1.1). `sections`를
 * 건드리지 않으므로 `checkPage`·편집 계약·검증 4축과 무관하다 — 부가 데이터다.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let p: ProductRow | null
  try {
    p = await loadProduct(id)
  } catch (e) {
    return serverError((e as Error).message)
  }
  if (!p) return notFound('상품을 찾을 수 없습니다.')
  if (!p.confirmed_data) return badRequest({ _: '확정 데이터가 없습니다.' })
  if (!p.page_content) return badRequest({ _: '먼저 상품 페이지를 생성해 주세요.' })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return badRequest({ _: '본문을 읽을 수 없습니다.' })
  }

  const groundedText = typeof body.grounded_text === 'string' ? body.grounded_text : ''
  if (!groundedText.trim()) return badRequest({ _: '검색 결과가 비어 있습니다. 다시 검색해 주세요.' })

  if (typeof body.updated_at !== 'string' || !body.updated_at) {
    return badRequest({ _: '조회 시점(updated_at)이 없습니다. 화면을 새로고침해 주세요.' })
  }
  // 낡은 화면에서 보내면 다른 사람이 방금 바꾼 page_content를 덮어쓴다(§16.1.1)
  if (body.updated_at !== p.updated_at) return conflict({ reason: 'stale' })

  const sources = validSources(body.sources)

  try {
    const outcome = await runEnrichStructure(
      p.confirmed_data as ConfirmedData, groundedText, sources,
    )
    if (outcome.kind === 'ai_fail') {
      return NextResponse.json(
        { reason: 'retry', retry_after_ms: outcome.retryAfterMs ?? 0 },
        { status: 409 },
      )
    }

    // sections는 그대로 두고 enrichment 키만 얹는다 — 계약 밖 부가 데이터다
    const pc = p.page_content as PageContent
    const nextPageContent: PageContent = { ...pc, enrichment: outcome.enrichment }

    const updated = await updateProduct(p, { page_content: nextPageContent })
    if (!updated.ok) return conflict({ reason: 'stale' })

    return NextResponse.json(
      { enrichment: outcome.enrichment, updated_at: updated.row.updated_at },
      { status: 200 },
    )
  } catch (e) {
    return serverError(`구조화 실패: ${(e as Error).message}`)
  }
}
