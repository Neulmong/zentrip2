'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  runPipeline, phasesFrom, resumePhases, PAGE_PHASES, type Phase,
} from '@/lib/client/run-pipeline'
import {
  describeStatus, publishProcedure, type ActionButton, type StatusInput,
} from '@/lib/status-view'
import { isAvailable } from '@/components/admin/available'
import { PublishDialog } from '@/components/admin/PublishDialog'
import type { ValidationItem } from '@/lib/types'

/**
 * 상세 화면의 상태별 버튼 (§15.1) — **실행 지점**.
 *
 * 목록의 버튼은 여기로 데려오는 입구고(§14.1), 실제 실행은 이 화면에서 한다.
 * 검증 4축과 실패 항목 전체가 같은 화면에 있어 §11.5의 열람 요건을 만족하고,
 * AI 순차 호출의 진행 표시(§8.5·§9.6)를 놓을 자리도 여기다.
 *
 * 어떤 버튼을 그릴지는 `describeStatus()`가 정한다 — 이 파일에 상태 조건문을 두면
 * 목록·편집기와 갈라진다.
 */

export interface ActionsProps extends StatusInput {
  id: string
  current_step: string
  /** §16.1.1 — 게시·게시 중단이 되돌려 보낼 「읽은 시점」 */
  updated_at: string
  /** §11.5 책임 게시 모달이 **전부** 열람시켜야 하는 실패 항목 */
  failed_items: ValidationItem[]
}

export function ProductActions(p: ActionsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 열려 있으면 그 모드의 게시 확인 모달을 띄운다(§11.5) */
  const [dialog, setDialog] = useState<'override' | 'acknowledge' | null>(null)

  const view = describeStatus(p)
  const buttons = view.buttons.filter((b) => isAvailable(b.key))
  if (buttons.length === 0) return null

  const onProgress = (label: string, attempt: number) =>
    setProgress(attempt > 0 ? `${label} (재시도 ${attempt}회)` : label)

  /** 순차 호출을 돌리고 결과에 따라 화면을 갱신한다(§14.6). */
  async function run(phases: Phase[]) {
    if (phases.length === 0) {
      setError('재개할 단계를 찾지 못했습니다. 화면을 새로고침해 주세요.')
      return
    }
    const outcome = await runPipeline(p.id, phases, onProgress)
    setProgress(null)

    if (outcome.kind === 'error') { setError(outcome.message); return }
    if (outcome.kind === 'input_error') {
      // 입력 문제 — 값이 유지되는 폼으로 보낸다(§15.1)
      router.push(`/new?product_id=${p.id}`)
      return
    }
    // done · refetch 모두 서버에서 현재 상태를 다시 읽는다
    router.refresh()
  }

  /**
   * [다시 생성](§15.3) · [처음부터 다시](§15.1.1)는 **같은 라우트**를 쓴다.
   * 서버가 돌려준 `restart_from`부터 순차 호출을 재개한다 —
   * 시작점은 상태와 축이 정하므로 클라이언트가 추측하지 않는다.
   */
  async function regenerate() {
    setProgress('되돌리는 중…')
    const res = await fetch(`/api/products/${p.id}/regenerate`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      setProgress(null)
      if (res.status === 409 && body.reason === 'precondition') {
        setError('지금은 다시 생성할 수 없는 상태입니다. 화면을 새로고침해 주세요.')
      } else if (res.status === 409 && body.reason === 'stale') {
        setError('다른 곳에서 이 상품이 변경됐습니다. 새로고침 후 다시 시도해 주세요.')
      } else {
        setError(body.message ?? `되돌리기에 실패했습니다 (${res.status}).`)
      }
      return
    }
    await run(phasesFrom(body.restart_from))
  }

  /**
   * 게시 (§11.5 → #12) · 게시 중단 (#13).
   *
   * §14.6 — #12의 미통과는 **403**이다. 클라이언트는 재호출하지 않고 버튼을
   * 비활성 상태로 두고 사유를 표시한다. 재호출로 풀리는 문제가 아니다.
   */
  async function togglePublish(path: 'publish' | 'unpublish', override = false) {
    setBusy(true)
    setError(null)
    setProgress(path === 'publish' ? '게시 중…' : '게시 중단 중…')

    const res = await fetch(`/api/products/${p.id}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updated_at: p.updated_at, ...(override ? { override } : {}) }),
    }).catch(() => null)

    setProgress(null)
    setBusy(false)
    setDialog(null)

    if (!res) { setError('네트워크 오류가 발생했습니다. 다시 시도해 주세요.'); return }
    const body = await res.json().catch(() => ({}))

    if (res.ok) { router.refresh(); return }

    if (res.status === 403) {
      setError(`게시할 수 없습니다 — ${body.reason ?? '게시 게이트를 통과하지 못했습니다.'}`)
      return
    }
    if (res.status === 409 && (body.reason === 'stale' || body.reason === 'precondition')) {
      setError('다른 곳에서 이 상품이 변경됐습니다. 새로고침 후 다시 시도해 주세요.')
      return
    }
    setError(body.message ?? body.reason ?? `요청이 실패했습니다 (${res.status}).`)
  }

  async function handle(b: ActionButton) {
    /*
     * 게시는 확인 절차가 §11.5의 규정이라 `window.confirm`으로 대체할 수 없다 —
     * 실패 항목 **전체 열람**과 체크박스 게이트를 담을 수 없기 때문이다.
     * 나머지 확인(§15.3 [다시 생성], §12.3 [게시 중단])은 문장 하나라 확인창으로 족하다.
     */
    if (b.key === 'publish') {
      const proc = publishProcedure(p)
      if (proc.kind === 'plain') { await togglePublish('publish'); return }
      if (proc.kind === 'blocked') { setError(proc.reason); return }
      setDialog(proc.kind)
      return
    }

    if (b.confirm && !window.confirm(b.confirm)) return

    setBusy(true)
    setError(null)
    try {
      switch (b.key) {
        case 'create-page':
          // [상품 생성]은 page·consistency 카운터를 초기화한다 — 서버 ①이 담당(§11.6)
          await run(PAGE_PHASES)
          break
        case 'resume':
          await run(resumePhases(p.current_step))
          break
        case 'restart':
        case 'regenerate':
          await regenerate()
          break
        case 'edit':
          router.push(`/admin/products/${p.id}/edit`)
          break
        case 'unpublish':
          await togglePublish('unpublish')
          break
        case 'edit-input':
        case 'resubmit':
          router.push(`/new?product_id=${p.id}`)
          break
        default:
          setError(`아직 연결되지 않은 동작입니다: ${b.label}`)
      }
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 border-t border-neutral-200 pt-6">
      <div className="flex flex-wrap items-center gap-3">
        {buttons.map((b, i) => (
          <button
            key={b.key}
            onClick={() => handle(b)}
            disabled={busy || b.disabled}
            title={b.disabledReason}
            className={
              i === 0
                ? `rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white
                   transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40`
                : `rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition
                   hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40`
            }
          >
            {b.label}
          </button>
        ))}
        {progress && <span className="text-sm text-neutral-600">{progress}</span>}
      </div>

      {/* 잠긴 버튼은 왜 잠겼는지 함께 알린다 — 막힌 길이 아님을 알려야 한다(§15.1) */}
      {!busy && buttons.filter((b) => b.disabled && b.disabledReason).map((b) => (
        <p key={b.key} className="mt-3 text-sm text-amber-700">{b.disabledReason}</p>
      ))}

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

      {dialog && (
        <PublishDialog
          mode={dialog}
          items={p.failed_items}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={(override) => togglePublish('publish', override)}
        />
      )}
    </div>
  )
}
