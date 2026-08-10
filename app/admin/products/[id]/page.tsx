import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadProduct } from '@/lib/orchestrator'
import { VERDICT_LABEL, type AxisName, type ValidationItem } from '@/lib/types'
import type { BrochureContent, BrochureSection } from '@/lib/pipeline/brochure'
import { BrochureActions } from './actions'

/**
 * spec §14.1·§8.9 — 상품 상세 = 소개서 검토 화면.
 * 소개서 8개 섹션을 **읽기 전용**으로 표시하고 1차 검증 결과(실패 항목 전체)를
 * 함께 보여준다. 버튼 구성은 §15.1 표를 따른다.
 */

const SECTION_TITLE: Record<string, string> = {
  b_title: '제목', b_overview: '개요', b_itinerary: '일정', b_accommodation: '숙박',
  b_flight: '항공', b_meal: '식사', b_price: '가격', b_shop: '제휴상점',
}

function SectionCard({ s }: { s: BrochureSection }) {
  const days = s.data.days as { day: string; text: string }[] | undefined

  return (
    <section className="rounded-xl border border-neutral-200 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {SECTION_TITLE[s.id] ?? s.id}
      </h3>

      {days ? (
        <ol className="space-y-2">
          {days.map((d) => (
            <li key={d.day} className="flex gap-3 text-sm">
              <span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium
                               text-neutral-600">{d.day}일차</span>
              <span className="leading-relaxed text-neutral-800">{d.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <dl className="space-y-2">
          {Object.entries(s.data).map(([k, v]) => (
            <div key={k} className="flex gap-3 text-sm">
              <dt className="w-24 shrink-0 text-neutral-500">
                {k === 'text' ? '행사명' : k}
              </dt>
              <dd className="leading-relaxed text-neutral-800">
                {String(v)}
                {s.source[k] === 'generated' && (
                  <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">
                    AI 서술
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await loadProduct(id).catch(() => null)
  if (!p) notFound()

  const snap = p.validation_snapshot
  const axes: AxisName[] = ['axis_0', 'axis_1', 'axis_2', 'axis_3']
  const brochure = p.brochure_content as BrochureContent | null
  const axis1 = snap?.axes?.axis_1
  const failedItems: ValidationItem[] = axes.flatMap((a) => snap?.axes?.[a]?.items ?? [])

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="border-b border-neutral-200 pb-4">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {p.form_input?.행사정보?.행사명 ?? '(행사명 없음)'}
          </h1>
          <Link href="/admin" className="shrink-0 text-sm text-neutral-500 hover:text-neutral-900">
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
        <div className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">입력을 확인해 주세요</p>
          <p className="mt-1 leading-relaxed">{p.failure_reason}</p>
          <Link href={`/new?product_id=${p.id}`}
            className="mt-2 inline-block font-medium underline">입력 수정 후 재제출</Link>
        </div>
      )}

      {/* 검증 4축 — §20 1:15의 배지 */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">검증 4축</h2>
        <div className="grid grid-cols-4 gap-2">
          {axes.map((a) => {
            const r = snap?.axes?.[a]
            const tone = !r ? 'bg-neutral-100 text-neutral-400'
              : r.verdict === 'pass' ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
            return (
              <div key={a} className={`rounded-lg px-3 py-2 text-center text-xs ${tone}`}>
                <div className="font-medium">{a.replace('axis_', '')}차</div>
                <div className="mt-0.5">{r ? VERDICT_LABEL[r.verdict] : '미실행'}</div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 실패 항목은 **전부** 보여준다 — 기획자가 전체를 열람해야 한다(§11.3) */}
      {failedItems.length > 0 && (
        <section className="mt-6 rounded-xl border border-red-200 bg-red-50/50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-red-800">
            검증 실패 항목 {failedItems.length}건
          </h2>
          <ul className="space-y-3">
            {failedItems.map((i, n) => (
              <li key={n} className="text-sm">
                <p className="font-medium text-red-900">{i.검증영역}</p>
                <p className="mt-0.5 text-red-800">
                  기준 <code className="rounded bg-white px-1">{i.기준값}</code>
                  {' → '}
                  발견 <code className="rounded bg-white px-1">{i.발견값}</code>
                </p>
                <p className="mt-0.5 text-xs text-red-700">{i.사유}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 소개서 8개 섹션 — 읽기 전용 (§8.9) */}
      {brochure ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">소개서 (간단버전)</h2>
          <div className="space-y-3">
            {brochure.sections.map((s) => <SectionCard key={s.id} s={s} />)}
          </div>
        </section>
      ) : (
        <p className="mt-8 rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
          아직 소개서가 생성되지 않았습니다. 현재 단계: {p.current_step}
        </p>
      )}

      {p.status === 'brochure_ready' && (
        <BrochureActions productId={p.id} canCreate={axis1?.verdict === 'pass'} />
      )}
    </main>
  )
}
