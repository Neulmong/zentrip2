'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteGate } from '@/lib/status-view'
import type { ProductStatus } from '@/lib/types'

/**
 * 목록(`/admin`)의 **행별 삭제** (§12.4 · #18).
 *
 * `DeleteProduct`(상세 화면의 큰 섹션)와 판정·API는 같고 모양만 컴팩트하다.
 * 삭제는 §15.1 표에 없는 §12.4의 별도 규정이므로 상태별 버튼(`describeStatus`)에
 * 끼우지 않고 별도 버튼으로 둔다.
 *
 * ## 게이트는 서버와 같은 함수(`deleteGate`)로 판정한다
 *
 * 못 지우는 상태(게시 중·신청 있음)면 **숨기지 않고 비활성**으로 둔다 — 「버튼이
 * 없다」와 「지금은 못 지운다」가 같아 보이면 게시 중단하면 지울 수 있다는 사실을
 * 알 방법이 없다. 서버도 같은 게이트를 최종 판정하므로 화면만 우회해도 막힌다.
 *
 * ## 확인 모달에 행사명을 표시한다 (§12.4)
 *
 * 목록에는 여러 행이 나란히 있어 어느 것을 지우는지 헷갈리기 쉽다. 모달에
 * 행사명을 다시 보여 옆 행을 지우는 사고를 막는다.
 */

interface Props {
  id: string
  행사명: string
  status: ProductStatus
  hasApplications: boolean
  /** §16.1.1 — 이 목록이 읽은 시점. 조건부 삭제로 낡은 화면의 삭제를 막는다 */
  updated_at: string
}

export function DeleteRow({ id, 행사명, status, hasApplications, updated_at }: Props) {
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
            ? '다른 곳에서 변경됐습니다. 새로고침 후 다시 시도해 주세요.'
            : body.detail ?? body.message ?? `삭제 실패 (${res.status})`,
        )
        setBusy(false)
        return
      }
      const body = await res.json().catch(() => ({}))
      if (body.storage_error) console.warn('[storage] 고아 파일이 남았습니다:', body.storage_error)
      setOpen(false)
      // 목록 화면이므로 새 화면으로 가지 않고 이 자리에서 다시 그린다(§14.1)
      router.refresh()
    } catch {
      setError('네트워크 오류로 삭제하지 못했습니다.')
      setBusy(false)
    }
  }

  if (!gate.ok) {
    return (
      <span
        title={gate.detail}
        className="cursor-not-allowed rounded-lg px-3 py-1.5 text-sm text-neutral-300"
      >
        삭제
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600
                   transition hover:border-red-400 hover:bg-red-50"
      >
        삭제
      </button>

      {error && !open && (
        <span role="alert" className="text-xs text-red-700">{error}</span>
      )}

      {open && (
        <div
          role="dialog" aria-modal="true" aria-label="상품 삭제 확인"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold">이 상품을 삭제할까요?</h3>
            <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm font-medium">{행사명}</p>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600">
              상품·이미지·편집 이력이 삭제되며 되돌릴 수 없습니다. 실행 로그는 남습니다(§12.4).
            </p>
            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button" onClick={() => { setOpen(false); setError(null) }} disabled={busy}
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
    </>
  )
}
