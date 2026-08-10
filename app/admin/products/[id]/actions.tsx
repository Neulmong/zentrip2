'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { runPipeline, PAGE_PHASES } from '@/lib/client/run-pipeline'

/**
 * §15.1의 상태별 버튼. 여기서는 `brochure_ready`에 해당하는 것만 둔다 —
 * [상품 생성]은 `axis_1 = pass`일 때만 활성된다.
 *
 * 소개서가 입력과 어긋난 상태로 페이지를 만들면 오류가 증폭되므로 잠근다.
 * 대신 [다시 생성]·[입력 수정]이 있어 막힌 길이 아니다(§15.1).
 */
export function BrochureActions({ productId, canCreate }: {
  productId: string; canCreate: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function createPage() {
    setBusy(true); setError(null)
    const outcome = await runPipeline(productId, PAGE_PHASES, (label, attempt) => {
      setProgress(attempt > 0 ? `${label} (재시도 ${attempt}회)` : label)
    })
    setProgress(null)
    setBusy(false)

    if (outcome.kind === 'error') { setError(outcome.message); return }
    if (outcome.kind === 'input_error') { setError(outcome.failure_reason); return }
    router.refresh()
  }

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-6">
      <button
        onClick={createPage}
        disabled={!canCreate || busy}
        title={canCreate ? undefined : '1차 검증을 통과해야 상품을 생성할 수 있습니다.'}
        className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white
                   transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? '생성 중…' : '상품 생성'}
      </button>

      {progress && <span className="text-sm text-neutral-600">{progress}</span>}
      {!canCreate && !busy && (
        <span className="text-sm text-amber-700">
          1차 검증 실패 — [다시 생성]하거나 입력을 수정해 주세요.
        </span>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  )
}
