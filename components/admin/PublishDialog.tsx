'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { ValidationItem } from '@/lib/types'

/**
 * 게시 확인 모달 (§11.5) — **두 얼굴을 한 컴포넌트로 둔다.**
 *
 * | `verdict` | §11.5가 요구하는 절차 |
 * |---|---|
 * | `pass` + `human_edited` | 「편집된 내용은 AI 검증 대상이 아닙니다」 표시 + 명시적 확인 |
 * | `fail` | **[검증 실패 항목 확인]** — 실패 항목 **전체**를 열람하고 「내용을 확인했으며 책임하에 게시합니다」 체크 시 게시 활성 |
 *
 * ## `window.confirm`으로는 §11.5를 만족할 수 없다
 *
 * 브라우저 기본 확인창은 목록을 담지 못하고 스크롤도 되지 않는다. 실패 항목이
 * 12건이면 「전체 열람」이라는 요건이 형식만 남는다. 체크박스로 게이트를 여는
 * 것도 확인창으로는 불가능하다.
 *
 * ## 항목을 접지 않는다
 *
 * 실패 항목을 「N건 더 보기」로 접으면 열람 요건이 다시 형식이 된다. 전부
 * 펼치고 모달 안에서만 스크롤한다(§17.1 — 가로 스크롤은 자체 컨테이너 안에서만).
 */

export interface PublishDialogProps {
  /** `override`면 실패 항목 열람 + 체크박스가 필요하다 */
  mode: 'override' | 'acknowledge'
  /** `override` 모드에서 **전부** 표시한다 */
  items: ValidationItem[]
  busy?: boolean
  onCancel: () => void
  /** `override` 여부를 그대로 요청 본문에 실어 보낸다 */
  onConfirm: (override: boolean) => void
}

export function PublishDialog({
  mode, items, busy, onCancel, onConfirm,
}: PublishDialogProps) {
  const [agreed, setAgreed] = useState(false)
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  // Esc로 닫히지 않으면 키보드만 쓰는 사람이 갇힌다(§17.2 접근성)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const isOverride = mode === 'override'
  const canPublish = !busy && (!isOverride || agreed)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl"
      >
        <header className="shrink-0 border-b border-neutral-200 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {isOverride ? '검증 실패 항목 확인' : '게시하기 전에 확인해 주세요'}
          </h2>
          <p className="mt-1 text-sm text-neutral-700">
            {isOverride
              ? `AI 검증에서 ${items.length}건이 기준과 어긋났습니다. 아래를 모두 확인한 뒤 게시하세요.`
              : '편집된 내용은 AI 검증 대상이 아닙니다. 편집분의 사실 정확성은 기획자 책임입니다.'}
          </p>
        </header>

        {isOverride && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {items.length === 0 ? (
              <p className="text-sm text-neutral-600">
                실패 항목 목록이 비어 있습니다. 검증 결과를 다시 확인해 주세요.
              </p>
            ) : (
              <ul className="space-y-3">
                {items.map((i, n) => (
                  <li key={n} className="rounded-lg border border-red-200 bg-red-50/60 p-3">
                    <p className="text-sm font-medium text-red-900">{i.검증영역}</p>
                    <p className="mt-1 text-sm text-red-900">
                      기준 <code className="rounded bg-white px-1">{i.기준값}</code>
                      {' → '}
                      발견 <code className="rounded bg-white px-1">{i.발견값}</code>
                    </p>
                    <p className="mt-1 text-xs text-red-800">{i.사유}</p>
                    <p className="mt-1 text-xs text-red-800">
                      위치 {i.위치}
                      {i.source경로 && <> · 출처 <code>{i.source경로}</code></>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <footer className="shrink-0 border-t border-neutral-200 px-5 py-4">
          {isOverride && (
            <label className="mb-3 flex items-start gap-2 text-sm text-neutral-900">
              <input
                type="checkbox" checked={agreed} className="mt-0.5"
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>내용을 확인했으며 책임하에 게시합니다.</span>
            </label>
          )}

          <div className="flex justify-end gap-2">
            <button
              ref={closeRef} type="button" onClick={onCancel} disabled={busy}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm
                         hover:bg-neutral-50 disabled:opacity-40"
            >취소</button>
            <button
              type="button" onClick={() => onConfirm(isOverride)} disabled={!canPublish}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white
                          disabled:cursor-not-allowed disabled:opacity-40 ${
                isOverride ? 'bg-amber-700 hover:bg-amber-800' : 'bg-neutral-900 hover:bg-neutral-800'
              }`}
            >{busy ? '게시 중…' : isOverride ? '책임하에 게시' : '게시'}</button>
          </div>

          {isOverride && (
            <p className="mt-2 text-xs text-neutral-600">
              게시 시점이 기록되고 목록에 「검증 실패 · 책임 게시됨」 배지가 붙습니다.
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}
