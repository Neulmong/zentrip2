import { notFound, redirect } from 'next/navigation'
import { loadProduct } from '@/lib/orchestrator'
import { loadPageImages } from '@/lib/page-images'
import { checkPrecondition } from '@/lib/policy'
import { Editor } from '@/components/admin/editor/Editor'
import type { PageContent } from '@/lib/pipeline/page'

/**
 * §10.1 — `/admin/products/{id}/edit` (인증 필요).
 *
 * 서버가 하는 일은 **재료를 모아 넘기는 것**뿐이다. 편집 규칙은
 * `lib/edit-contract.ts`가, 화면은 `components/admin/editor/`가 갖는다.
 *
 * ## 들어올 수 있는지 판정하는 기준
 *
 * 화면 접근도 §14.5의 **재료 기준**을 그대로 쓴다 — 저장 라우트(#10)가 받아
 * 주지 않을 상품의 편집기를 열어주면, 다 고치고 [저장]을 누른 뒤에야 409를
 * 만나게 된다. 조건이 한 곳(`PRECONDITIONS.content`)에 있으므로 둘이 갈라지지 않는다.
 *
 * 「임시저장 페이지의 미리보기는 이 화면에서만 가능하며 공개 URL로 노출되지
 * 않는다」(§10.1) — 미리보기는 iframe 안의 React 트리이고 별도 라우트가 없다.
 */
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const p = await loadProduct(id).catch(() => null)
  if (!p) notFound()

  // 편집할 수 없는 상품은 상세로 돌려보낸다. §15.1 표가 그 화면을 정한다.
  if (checkPrecondition('content', p)) redirect(`/admin/products/${p.id}`)

  const images = await loadPageImages(p.id).catch(() => [])

  return (
    <Editor
      productId={p.id}
      eventName={p.form_input?.행사정보?.행사명 ?? '(행사명 없음)'}
      status={p.status}
      slug={p.slug}
      initialContent={p.page_content as PageContent}
      images={images}
      // §16.1.1 — 저장 요청이 되돌려 보낼 「읽은 시점」이다
      updatedAt={p.updated_at}
    />
  )
}
