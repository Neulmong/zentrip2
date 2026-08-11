import type { NextRequest } from 'next/server'
import { loadProduct, readUpdatedAt, runStep, updateProduct } from '@/lib/orchestrator'
import { RESET_ON, resetCounters } from '@/lib/policy'
import { db } from '@/lib/supabase'
import { ai, toLogOutput, ERROR_LABEL } from '@/lib/ai'
import { withAxis, failedAxis } from '@/lib/validation'
import { buildPage, checkPage } from '@/lib/pipeline/page'
import { findMemoLeaks } from '@/lib/pipeline/memo-leak'
import { resolveTheme } from '@/lib/pipeline/theme'
import { proposeSlug, withSuffix } from '@/lib/pipeline/slug'
import { EXPAND_SCHEMA, EXPAND_SYSTEM, type ExpandResult } from '@/lib/pipeline/ai-contracts'
import type { ConfirmedData } from '@/lib/pipeline/normalize'
import type { ValidationItem } from '@/lib/types'

export const maxDuration = 60

/**
 * Step 05 — 페이지 생성 + slug 발급 (§9.5 ①). **AI 1회.**
 *
 * 재시도 소진 시 **`draft`로 가지 않고 `brochure_ready`로 되돌린다** —
 * `page_content`가 없으면 편집기가 렌더링할 대상이 없고 §14.5 #10의 편집
 * 시작 조건도 `page_content` 존재를 요구한다. 소개서까지는 정상이므로
 * 소개서 검토 화면으로 돌려보낸다(§9.5).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const clientUpdatedAt = await readUpdatedAt(req)

  /*
   * [상품 생성] 진입 — `brochure_ready → generating` 전이는 이 라우트가 수행한다(§14.5 #5).
   * 이때 `page`·`consistency` 카운터를 초기화한다(§11.6) — 이 규칙이 없으면
   * 소진 후 되돌아와 [상품 생성]을 다시 눌러도 즉시 실패한다.
   */
  const entry = await loadProduct(id)

  // §16.1.1 — 전이 **전에** 조회 시점을 본다. 뒤로 미루면 낡은 요청이
  // 상태를 먼저 바꿔 놓고 거절당한다.
  if (entry && clientUpdatedAt && clientUpdatedAt !== entry.updated_at) {
    return Response.json({ reason: 'stale' }, { status: 409 })
  }

  /*
   * 이 라우트가 방금 행을 갱신하면 `updated_at`이 바뀐다. 클라이언트가 보낸
   * 값을 그대로 runStep에 넘기면 **정상 요청이 stale로 튕긴다** — 낡게 만든
   * 것이 이 라우트 자신이기 때문이다. 전이 후에는 새 값이 기준이다.
   */
  let effectiveUpdatedAt = clientUpdatedAt
  if (entry?.status === 'brochure_ready') {
    const moved = await updateProduct(entry, {
      status: 'generating',
      retry_counts: resetCounters(entry.retry_counts, RESET_ON['product-create']),
    })
    if (!moved.ok) {
      return Response.json({ reason: 'stale' }, { status: 409 })
    }
    effectiveUpdatedAt = clientUpdatedAt ? moved.row.updated_at : undefined
  }

  return runStep(
    { route: 'page', step: 'page_generated', productId: id, clientUpdatedAt: effectiveUpdatedAt },
    async (p) => {
      const cd = p.confirmed_data as ConfirmedData
      const theme = resolveTheme(cd.행사정보.여행스타일)

      // 업로드된 슬롯만 참조한다. 재배치·추론·교체 금지(§16.1)
      const { data: imageRows } = await db()
        .from('product_images').select('slot').eq('product_id', p.id)
      const slots = new Set<string>((imageRows ?? []).map((r: { slot: string }) => r.slot))

      /** 소진 시 — 소개서 검토 화면으로 되돌린다(§9.5). */
      const exhaustedWith = (item: ValidationItem) => ({
        patch: {
          status: 'brochure_ready' as const,
          validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_2', failedAxis(item)),
        },
        body: { current_step: p.current_step, axes: { axis_2: 'fail' as const }, items: [item] },
        detail: '페이지 생성 재시도 소진 — draft가 아니라 brochure_ready로 되돌림 (§9.5)',
      })

      const res = await ai().call<ExpandResult>({
        system: EXPAND_SYSTEM,
        user: `## 일차별 압축 서술 (소개서) — 이것을 확장하라\n`
          + cd.행사정보.일정.map((d) =>
            `${d.day}일차\n  원문근거: ${d.원문근거 || '(없음)'}\n  압축: ${d.내용}`).join('\n')
          + `\n\n## 상품 정보 (신청 안내문구 작성용)\n`
          + `행사명: ${cd.행사정보.행사명} / 여행지: ${cd.행사정보.여행지}\n`
          + `여행기간: ${cd.행사정보.여행기간}\n`
          + `여행주제: ${cd.행사정보.여행주제}\n`
          // 비어 있으면 싣지 않는다 — 프롬프트만 늘린다.
          + (cd.행사정보.기획메모?.trim()
            ? `\n## 기획 메모 (어조 참고용 · 인용 금지 · 고객 미노출)\n${cd.행사정보.기획메모}\n`
            : '')
          + `\n각 일차의 확장 서술과 신청 섹션의 제목·안내문구를 만들어라.`,
        schema: EXPAND_SCHEMA,
        effort: 'generate',
        label: 'content-structuring',
      })

      if (!res.ok) {
        const item: ValidationItem = {
          검증영역: '생성', source경로: null, 기준값: '페이지 콘텐츠',
          발견값: res.errorType, 사유: ERROR_LABEL[res.errorType], 위치: 'page_content',
        }
        return {
          type: 'fail', counter: 'page', retryFrom: 5, items: [item],
          retryAfterMs: res.retryAfterMs,
          exhausted: exhaustedWith(item), logOutput: toLogOutput(res),
        }
      }

      const expanded = new Map(res.data.days.map((d) => [d.day, d.text]))
      const pageContent = buildPage({ cd, theme, slots, expanded, apply: res.data.apply })

      // 서버 검사 (AI 호출 없음) — 섹션 9개·order·source·토큰·길이 계약 4종·슬롯 존재
      const errors = checkPage(pageContent, slots)

      // 기획 메모 유출 검사 — 서술 필드 전부를 본다(§17.1의 `source: generated` 필드).
      const { 기획메모, ...메모제외 } = cd.행사정보
      const 서술: [string, string][] = [
        ...res.data.days.map((d) => [`days[${d.day}].text`, d.text] as [string, string]),
        ['apply.제목', res.data.apply.제목],
        ['apply.안내문구', res.data.apply.안내문구],
      ]
      for (const l of findMemoLeaks(기획메모, JSON.stringify({ ...cd, 행사정보: 메모제외 }), 서술)) {
        errors.push(`${l.위치}에 기획 메모의 «${l.토큰}»이 노출됐습니다 (고객 미노출 필드).`)
      }

      if (errors.length > 0) {
        const item: ValidationItem = {
          검증영역: '생성', source경로: null, 기준값: '§9.3 스키마',
          발견값: errors[0], 사유: errors.join(' / '), 위치: 'page_content',
        }
        return {
          type: 'fail', counter: 'page', retryFrom: 5, items: [item],
          exhausted: exhaustedWith(item),
          logOutput: { ...toLogOutput(res), server_checks: errors },
        }
      }

      // slug — **이미 있으면 재발급하지 않는다.** 주소를 바꾸면 공유된 링크가 끊긴다(§12.1)
      let slug = p.slug
      if (!slug) {
        const { data: taken } = await db().from('products').select('slug').not('slug', 'is', null)
        const used = new Set<string>((taken ?? []).map((r: { slug: string }) => r.slug))
        const proposed = proposeSlug(cd.행사정보.행사명)
        slug = withSuffix(proposed.slug, used)
        if (!slug) {
          return {
            type: 'fail', counter: 'page', retryFrom: 5,
            items: [{
              검증영역: 'slug', source경로: null, 기준값: '고유 slug',
              발견값: proposed.slug, 사유: 'slug 중복이 해소되지 않았습니다.', 위치: 'products.slug',
            }],
            exhausted: exhaustedWith({
              검증영역: 'slug', source경로: null, 기준값: '고유 slug',
              발견값: proposed.slug, 사유: 'slug 중복이 해소되지 않았습니다.', 위치: 'products.slug',
            }),
            logOutput: toLogOutput(res),
          }
        }
      }

      return {
        type: 'ok',
        patch: { page_content: pageContent, slug, current_step: 'page_generated' },
        body: { current_step: 'page_generated', slug },
        logOutput: { ...toLogOutput(res), theme, slug, slots: [...slots] },
      }
    },
  )
}
