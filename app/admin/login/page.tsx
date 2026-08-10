'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      router.replace(params.get('next') || '/admin')
      router.refresh()
      return
    }

    const body = await res.json().catch(() => ({}))
    setError(
      res.status === 429
        ? (body.message ?? '시도가 너무 잦습니다. 1분 후 다시 시도해 주세요.')
        : '비밀번호가 올바르지 않습니다.',
    )
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">zentrip</h1>
        <p className="text-sm text-neutral-500">여행 상품 등록·배포 관리</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base
                     outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || password.length === 0}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white
                   transition hover:bg-neutral-800 disabled:opacity-40"
      >
        {busy ? '확인 중…' : '로그인'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  )
}
