import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPublishedBySlug } from '@/lib/orchestrator'
import { loadPageImages } from '@/lib/page-images'
import { PageRenderer } from '@/components/page/PageRenderer'
import { ApplyForm } from '@/components/page/ApplyForm'
import type { PageContent } from '@/lib/pipeline/page'

/**
 * §4.1 — 고객용 공개 상품 페이지. **인증 없음.**
 *
 * `proxy.ts`의 matcher는 `/admin/*` · `/new/*` · `/api/*`뿐이라 이 경로는
 * 인증 게이트 밖이다. 비로그인 접속이 §20 시연의 2:20 지점이고 「절대 자르지
 * 않는 것」 2개 중 하나다.
 *
 * ## `published`가 아니면 예외 없이 404다
 *
 * 판정을 이 파일에서 하지 않고 `loadPublishedBySlug()`가 쿼리로 건다 —
 * 조건을 호출부에 두면 언젠가 빠뜨리고, 그 순간 임시저장본이 공개된다.
 *
 * ## 캐시하지 않는다
 *
 * §12.2는 「`/p/{slug}`가 **즉시** 공개된다. 재빌드·배포 대기 시간은 없다」,
 * §12.3은 게시 중단 시 「404를 반환한다」고 규정한다. 정적 캐시가 끼면 둘 다
 * 깨진다 — 내린 페이지가 계속 열리는 쪽이 특히 위험하다(마감된 상품에 신청이
 * 들어온다). 그래서 매 요청 서버 렌더링한다.
 *
 * 게시가 DB 상태값 전환인 이유(§4.1)가 여기서 값을 한다: 렌더링 비용은
 * 쿼리 2회뿐이고, Deploy Hook 방식의 1~3분 지연이 없다.
 */
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

/**
 * §17.2의 LCP 요건과는 별개로, 링크를 공유했을 때 제목이 보여야 한다.
 * 본문은 `page_content`의 사실정보이므로 여기서 새 문장을 만들지 않는다(§16.1).
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const p = await loadPublishedBySlug(slug).catch(() => null)
  if (!p) return { title: '페이지를 찾을 수 없습니다' }

  const g = p.form_input?.행사정보
  const 기간 = [g?.여행기간_시작, g?.여행기간_종료].filter(Boolean).join(' ~ ')

  return {
    title: g?.행사명 ?? '여행 상품',
    description: [g?.여행지, 기간].filter(Boolean).join(' · ') || undefined,
    // 임시저장본이 검색에 걸릴 일은 없지만, 게시 중단 후 잔존 색인을 줄인다
    robots: { index: true, follow: true },
  }
}

export default async function PublicProductPage({ params }: Props) {
  const { slug } = await params

  const p = await loadPublishedBySlug(slug).catch(() => null)
  // 없는 slug와 게시되지 않은 상품을 **같은 404로** 돌려준다. 구분해서 알려주면
  // 「그 주소에 뭔가 있긴 하다」는 정보가 새 나간다.
  if (!p || !p.page_content) notFound()

  const images = await loadPageImages(p.id).catch(() => [])

  /*
   * 신청 폼(§13.1)에 `product_id`를 넘긴다. slug가 아닌 이유: `POST
   * /api/applications`는 인증이 없어 세션에서 대상을 알아낼 수 없고, slug를
   * 받으면 라우트가 slug → 상품을 다시 조회해야 한다. 이미 조회한 행의 id를 쓴다.
   */
  return (
    <PageRenderer
      content={p.page_content as PageContent}
      images={images}
      applyForm={<ApplyForm productId={p.id} />}
    />
  )
}
