'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 신청 1건의 동작 버튼 — [재발송](§13.3) · [삭제](§12.4 #19).
 *
 * ## 두 버튼을 한 컴포넌트에 두면서도 확인 절차는 다르다
 *
 * 재발송은 되돌릴 수 있으므로(다시 누르면 된다) 확인을 받지 않는다. 삭제는
 * 되돌릴 수 없고 개인정보가 사라지므로 확인을 받는다 — §12.4가 상품 삭제에
 * 요구한 「명시적 확인」과 같은 이유다.
 *
 * ## 성공 후 `router.refresh()`
 *
 * 목록은 서버 컴포넌트라 클라이언트 상태를 갖고 있지 않다. 재발송은 `after()`
 * 안에서 끝나므로(§13.2 7번) 즉시 새로고침해도 `pending`이 보이고, 발송이
 * 끝난 뒤 한 번 더 새로고침해야 최종 상태가 나온다 — 그 사실을 문구로 알린다.
 */

interface Props {
  id: string
  /** 확인 모달에 표시할 신청자 표기. **마스킹된 값**을 받는다 */
  maskedName: string
  received: string
}

export function ApplicationActions({ id, maskedName, received }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'resend' | 'delete' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function call(kind: 'resend' | 'delete') {
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(
        kind === 'resend' ? `/api/applications/${id}/resend` : `/api/applications/${id}`,
        { method: kind === 'resend' ? 'POST' : 'DELETE' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.message ?? body.detail ?? `요청이 실패했습니다 (${res.status})`)
        return
      }
      if (kind === 'resend') {
        setNotice('발송을 시작했습니다. 잠시 후 새로고침하면 결과가 표시됩니다.')
      }
      setConfirming(false)
      router.refresh()
    } catch {
      setError('네트워크 오류로 요청을 보내지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <button
          type="button" onClick={() => call('resend')} disabled={busy !== null}
          className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium
                     text-neutral-700 hover:border-neutral-900 hover:text-neutral-900
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'resend' ? '발송 중…' : '재발송'}
        </button>
        <button
          type="button" onClick={() => setConfirming(true)} disabled={busy !== null}
          className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700
                     hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          삭제
        </button>
      </div>

      {notice && <p className="text-[11px] leading-snug text-neutral-500">{notice}</p>}
      {error && <p role="alert" className="text-[11px] leading-snug text-red-600">{error}</p>}

      {confirming && (
        <div
          role="dialog" aria-modal="true" aria-label="신청 삭제 확인"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold">이 신청을 삭제할까요?</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              {`${maskedName} · ${received} 접수분입니다. `}
              신청자의 이름·이메일·연락처가 함께 삭제되며 되돌릴 수 없습니다.
              삭제 기록은 실행 로그에 마스킹된 형태로 남습니다.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button" onClick={() => setConfirming(false)} disabled={busy !== null}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                취소
              </button>
              <button
                type="button" onClick={() => call('delete')} disabled={busy !== null}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white
                           hover:bg-red-700 disabled:opacity-40"
              >
                {busy === 'delete' ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
