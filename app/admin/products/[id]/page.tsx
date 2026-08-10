import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadProduct } from '@/lib/orchestrator'
import { VERDICT_LABEL } from '@/lib/types'

/**
 * spec §14.1 — 상품 상세. §15.1의 「소개서 검토」·「상세」가 이 경로다.
 * 소개서 8개 섹션 읽기 전용 + 검증 결과 + 상태별 버튼은 #6·#12에서 채운다.
 */
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await loadProduct(id).catch(() => null)
  if (!p) notFound()

  const snap = p.validation_snapshot
  const axes = (['axis_0', 'axis_1', 'axis_2', 'axis_3'] as const)

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="border-b border-neutral-200 pb-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            {p.form_input?.행사정보?.행사명 ?? '(행사명 없음)'}
          </h1>
          <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-900">
            목록
          </Link>
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600">
          <div><dt className="inline text-neutral-400">상태 </dt><dd className="inline font-medium">{p.status}</dd></div>
          <div><dt className="inline text-neutral-400">단계 </dt><dd className="inline">{p.current_step}</dd></div>
          <div><dt className="inline text-neutral-400">시도 </dt><dd className="inline">{p.attempt_no}회차</dd></div>
          {p.slug && <div><dt className="inline text-neutral-400">slug </dt><dd className="inline font-mono text-xs">{p.slug}</dd></div>}
        </dl>
      </header>

      {p.failure_reason && (
        <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {p.failure_reason}
        </p>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">검증 4축</h2>
        <div className="grid grid-cols-4 gap-2">
          {axes.map((a) => {
            const r = snap?.axes?.[a]
            const label = r ? VERDICT_LABEL[r.verdict] : '미실행'
            const tone = !r ? 'bg-neutral-100 text-neutral-400'
              : r.verdict === 'pass' ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
            return (
              <div key={a} className={`rounded-lg px-3 py-2 text-center text-xs ${tone}`}>
                <div className="font-medium">{a.replace('axis_', '')}차</div>
                <div className="mt-0.5">{label}</div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">재시도 카운터</h2>
        <div className="grid grid-cols-4 gap-2 text-xs">
          {Object.entries(p.retry_counts).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-neutral-50 px-3 py-2 text-center">
              <div className="text-neutral-500">{k}</div>
              <div className="mt-0.5 font-medium">{v} / 2</div>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-10 text-sm text-neutral-400">
        소개서 8개 섹션과 상태별 버튼은 다음 단계에서 연결됩니다.
      </p>
    </main>
  )
}
