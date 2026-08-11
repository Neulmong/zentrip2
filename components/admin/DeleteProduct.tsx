'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteGate } from '@/lib/status-view'
import type { ProductStatus } from '@/lib/types'

/**
 * 상품 삭제 (§12.4 · #18).
 *
 * ## §15.1의 버튼이 아니다
 *
 * §15.1의 표에 [삭제]는 없다. 그 표는 「상태 × 화면 × 버튼」의 단일 출처이므로
 * `describeStatus()`에 삭제를 끼워 넣으면 표에 없는 버튼이 규칙에서 나오게 된다.
 * 삭제는 §12.4의 별도 규정이라 별도 자리에 둔다.
 *
 * ## 막힌 이유를 버튼에 붙여 둔다
 *
 * 게이트 판정은 `deleteGate()` 하나뿐이고 서버도 같은 함수를 쓴다. 숨기지 않고
 * 비활성으로 두는 이유: 「삭제 버튼이 없다」와 「지금은 못 지운다」가 화면에서
 * 같아 보이면, 게시 중단하면 지울 수 있다는 사실을 알 방법이 없다.
 *
 * ## 확인 절차에 행사명을 표시한다
 *
 * §12.4의 요건이다. 목록에서 상세로 들어온 뒤 삭제를 누르므로, 어느 상품인지
 * 다시 확인시키지 않으면 옆 행을 지우는 사고가 난다.
 */

interface Props {
  id: string
  행사명: string
  status: ProductStatus
  hasApplications: boolean
  /** §16.1.1 — 이 화면이 읽은 시점 */
  updated_at: string
}

export function DeleteProduct({ id, 행사명, status, hasApplications, updated_at }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const gate = deleteGate({ status, hasApplications })

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updated_at }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(
          body.reason === 'stale'
            ? '다른 곳에서 이 상품이 변경됐습니다. 새로고침 후 다시 시도해 주세요.'
            : body.detail ?? body.message ?? `삭제에 실패했습니다 (${res.status})`,
        )
        setBusy(false)
        return
      }
      const body = await res.json()
      if (body.storage_error) {
        // 요청은 성공이다(§12.4). 다만 고아 파일이 남았다는 사실은 알린다.
        console.warn('[storage] 고아 파일이 남았습니다:', body.storage_error)
      }
      router.replace('/admin')
    } catch {
      setError('네트워크 오류로 삭제하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-red-200 p-4">
      <h2 className="text-sm font-semibold text-red-800">상품 삭제</h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-600">
        상품과 업로드한 이미지가 삭제됩니다. <strong>실행 로그와 이상 플래그는 남습니다</strong>
        {' '}— 사후 추적을 위해 `execution_id`로 보존됩니다(§12.4).
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!gate.ok || busy}
        title={gate.ok ? undefined : gate.detail}
        className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium
                   text-red-700 hover:border-red-500 hover:bg-red-50
                   disabled:cursor-not-allowed disabled:border-neutral-200
                   disabled:text-neutral-400 disabled:hover:bg-transparent"
      >
        삭제
      </button>
      {!gate.ok && (
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">{gate.detail}</p>
      )}

      {open && (
        <div
          role="dialog" aria-modal="true" aria-label="상품 삭제 확인"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold">이 상품을 삭제할까요?</h3>
            {/* §12.4 — 확인 모달에 행사명을 표시한다 */}
            <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm font-medium">
              {행사명}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600">
              상품·이미지·편집 이력이 삭제되며 되돌릴 수 없습니다.
              실행 로그는 남습니다.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button" onClick={() => setOpen(false)} disabled={busy}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                취소
              </button>
              <button
                type="button" onClick={remove} disabled={busy}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white
                           hover:bg-red-700 disabled:opacity-40"
              >
                {busy ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
