import Link from 'next/link'

/**
 * spec §14.1 — 상품 목록. 상태 필터 7종 + 배지 2종 + 상태별 버튼은 #12에서 채운다.
 * 지금은 인증 게이트가 통과되는지 확인할 수 있는 최소 화면이다.
 */
export default function AdminPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex items-baseline justify-between border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">상품 목록</h1>
          <p className="mt-1 text-sm text-neutral-500">인증됨 · 기획자 전용</p>
        </div>
        <Link
          href="/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white
                     transition hover:bg-neutral-800"
        >
          새 상품 등록
        </Link>
      </header>

      <p className="mt-8 text-sm text-neutral-500">
        아직 등록된 상품이 없습니다.
      </p>
    </main>
  )
}
