import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadProduct } from '@/lib/orchestrator'
import { loadFlags, loadLogs } from '@/lib/logging'
import { loadApplications } from '@/lib/applications'
import { STEP_LABEL, utcStamp } from '@/lib/log-view'
import type { LogStep } from '@/lib/types'
import { VERDICT_LABEL, type AxisName, type ValidationItem } from '@/lib/types'
import type { BrochureContent, BrochureSection } from '@/lib/pipeline/brochure'
import { StatusBadges } from '@/components/admin/badges'
import { DeleteProduct } from '@/components/admin/DeleteProduct'
import { ProductActions } from './actions'

/**
 * spec §14.1·§8.9 — 상품 상세 = 소개서 검토 화면.
 * 소개서 8개 섹션을 **읽기 전용**으로 표시하고 1차 검증 결과(실패 항목 전체)를
 * 함께 보여준다. 버튼 구성은 §15.1 표를 따른다.
 */

const SECTION_TITLE: Record<string, string> = {
  b_title: '제목', b_overview: '개요', b_itinerary: '일정', b_accommodation: '숙박',
  b_flight: '항공', b_meal: '식사', b_price: '가격', b_shop: '제휴상점',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-24 shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words leading-relaxed text-neutral-800">{children}</dd>
    </div>
  )
}

/**
 * 값 배열(`숙소들`·`상점들`)을 행 단위로 그린다 (§8.7).
 *
 * `String(v)`로 찍으면 `[object Object]`가 나온다 — 배열이 3개로 늘어난 지금
 * 스칼라만 가정한 렌더링은 검토 화면에서 값을 **읽을 수 없게** 만든다.
 * 검토 화면의 목적이 사실정보 확인이므로(§8.9) 여기서 값이 보이지 않으면
 * 화면 자체가 쓸모없어진다.
 */
function ValueRows({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <ol className="space-y-2">
      {rows.map((row, i) => (
        <li key={i} className="rounded-lg bg-neutral-50 p-3">
          <dl className="space-y-1">
            {Object.entries(row).map(([k, v]) => (
              <Row key={k} label={k}>{String(v)}</Row>
            ))}
          </dl>
        </li>
      ))}
    </ol>
  )
}

function SectionCard({ s }: { s: BrochureSection }) {
  return (
    <section className="rounded-xl border border-neutral-200 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {SECTION_TITLE[s.id] ?? s.id}
      </h3>

      <dl className="space-y-3">
        {Object.entries(s.data).map(([k, v]) => {
          if (Array.isArray(v)) {
            // 일차 배열은 「n일차 + 서술」 한 줄로, 값 배열은 행 카드로 그린다
            if (k === 'days') {
              const days = v as { day: string; text: string }[]
              return (
                <ol key={k} className="space-y-2">
                  {days.map((d) => (
                    <li key={d.day} className="flex gap-3 text-sm">
                      <span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-xs
                                       font-medium text-neutral-600">{d.day}일차</span>
                      <span className="min-w-0 leading-relaxed text-neutral-800">{d.text}</span>
                    </li>
                  ))}
                </ol>
              )
            }
            return <ValueRows key={k} rows={v as Record<string, unknown>[]} />
          }

          return (
            <Row key={k} label={k === 'text' ? '행사명' : k}>
              {String(v)}
              {s.source[k] === 'generated' && (
                <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">
                  AI 서술
                </span>
              )}
            </Row>
          )
        })}
      </dl>
    </section>
  )
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await loadProduct(id).catch(() => null)
  if (!p) notFound()

  /*
   * §14.1은 이 경로에 「로그 요약, 신청 내역 요약」도 요구한다. 전체 이력은
   * §14.3의 단일 화면이 담당하므로 여기서는 **마지막 단계·이상 건수·신청 건수**만
   * 보여주고 각 화면으로 보낸다 — 두 화면이 같은 표를 그리면 §14.3의 「단일
   * 화면에서 확인」이 두 곳으로 갈라진다.
   */
  const [logs, flags, applications] = await Promise.all([
    loadLogs(p.execution_id).catch(() => []),
    loadFlags(p.execution_id).catch(() => []),
    loadApplications({ product_id: p.id }).catch(() => []),
  ])
  const lastLog = logs[logs.length - 1]
  const failedEmails = applications.filter((a) => a.email_status === 'failed').length

  const snap = p.validation_snapshot
  const axes: AxisName[] = ['axis_0', 'axis_1', 'axis_2', 'axis_3']
  const brochure = p.brochure_content as BrochureContent | null
  const failedItems: ValidationItem[] = axes.flatMap((a) => snap?.axes?.[a]?.items ?? [])

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="border-b border-neutral-200 pb-4">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {p.form_input?.행사정보?.행사명 ?? '(행사명 없음)'}
          </h1>
          <div className="flex shrink-0 gap-4 text-sm text-neutral-500">
            {/* §20 마지막 컷이 로그 화면이다. 상세에서 한 번에 넘어갈 수 있어야 한다 */}
            <Link href={`/admin/logs/${p.execution_id}`} className="hover:text-neutral-900">
              실행 로그
            </Link>
            <Link href="/admin" className="hover:text-neutral-900">목록</Link>
          </div>
        </div>
        {/* §10.4 — 검증축·편집축은 서로 독립이라 동시에 붙을 수 있다 */}
        <StatusBadges p={p} className="mt-3" />

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600">
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

      {/* 로그 요약 · 신청 내역 요약 (§14.1). 전체는 각 화면에서 본다 */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <section className="rounded-xl border border-neutral-200 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">실행 로그</h2>
            <Link href={`/admin/logs/${p.execution_id}`}
              className="text-xs text-neutral-500 underline hover:text-neutral-900">
              전체 보기
            </Link>
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-neutral-400">기록</dt>
              <dd className="text-neutral-800">{`${logs.length}행`}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-neutral-400">마지막</dt>
              <dd className="min-w-0 text-neutral-800">
                {lastLog ? STEP_LABEL[lastLog.step as LogStep] ?? lastLog.step : '-'}
                {lastLog && (
                  <span className="mt-0.5 block font-mono text-[11px] text-neutral-400">
                    {utcStamp(lastLog.created_at)}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-neutral-400">이상</dt>
              <dd className={flags.length > 0 ? 'text-amber-700' : 'text-neutral-800'}>
                {flags.length > 0 ? `${flags.length}건` : '없음'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-neutral-200 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">신청 내역</h2>
            <Link href={`/admin/applications?product_id=${p.id}`}
              className="text-xs text-neutral-500 underline hover:text-neutral-900">
              전체 보기
            </Link>
          </div>
          {applications.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">접수된 신청이 없습니다.</p>
          ) : (
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-neutral-400">접수</dt>
                <dd className="text-neutral-800">{`${applications.length}건`}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-neutral-400">발송 실패</dt>
                <dd className={failedEmails > 0 ? 'text-red-700' : 'text-neutral-800'}>
                  {failedEmails > 0 ? `${failedEmails}건 — 재발송 필요` : '없음'}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-neutral-400">최근</dt>
                <dd className="min-w-0 font-mono text-[11px] text-neutral-500">
                  {utcStamp(applications[0]?.created_at)}
                </dd>
              </div>
            </dl>
          )}
          {/* §12.4 — 신청이 있으면 상품을 삭제할 수 없다. 그 사실을 미리 알린다 */}
          {applications.length > 0 && (
            <p className="mt-3 text-[11px] leading-snug text-neutral-500">
              신청이 있는 상품은 삭제할 수 없습니다. 먼저 신청 내역을 삭제해야 합니다.
            </p>
          )}
        </section>
      </div>

      {/* 상태별 버튼 (§15.1) — 어떤 버튼을 그릴지는 규칙표가 정한다 */}
      <ProductActions
        id={p.id}
        current_step={p.current_step}
        status={p.status}
        validation_snapshot={p.validation_snapshot}
        human_edited={p.human_edited}
        publish_override_at={p.publish_override_at}
        updated_at={p.updated_at}
        // §11.5 책임 게시 모달은 실패 항목 **전체**를 열람시켜야 한다
        failed_items={failedItems}
      />

      {/* §12.4 — §15.1 표에 없는 별도 규정이라 별도 자리에 둔다 */}
      <DeleteProduct
        id={p.id}
        행사명={p.form_input?.행사정보?.행사명 ?? '(행사명 없음)'}
        status={p.status}
        hasApplications={applications.length > 0}
        updated_at={p.updated_at}
      />
    </main>
  )
}
