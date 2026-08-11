import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadFlags, loadLogs, type FlagRow, type LogRow } from '@/lib/logging'
import { loadProductByExecution } from '@/lib/orchestrator'
import {
  ABNORMALITY_LABEL, LOG_TABS, STEP_LABEL, rawJson, resolveTab, utcStamp,
} from '@/lib/log-view'
import { VERDICT_LABEL, type LogCategory, type LogStep, type Verdict } from '@/lib/types'

/**
 * §14.3 — 실행 로그 뷰. `/admin/logs/{execution_id}` **단일 화면**이다.
 *
 * §20 3분 시연의 마지막 컷이 이 화면이다. 「무엇이 어떤 판정으로 지나갔는가」가
 * 한 화면에서 읽혀야 하므로 단계별로 화면을 나누지 않는다.
 *
 * ## 탭을 클라이언트 상태로 두지 않았다
 *
 * `?tab=`으로 서버에서 갈라 그린다. 이유가 두 개다. 로그는 조회 전용이라
 * 상호작용이 「어느 부분집합을 볼까」뿐이고, URL에 실려 있으면 **특정 탭을
 * 그대로 공유·재방문**할 수 있다. 전체 행은 한 번에 다 읽어 오므로(§14.3
 * 「전체 이력을 모두 확인」) 탭 전환에 재조회가 붙지도 않는다.
 *
 * ## 캐시하지 않는다
 *
 * 로그는 append 전용이고(§5.4) 파이프라인이 도는 동안 계속 늘어난다.
 * 새로고침이 같은 화면을 돌려주면 진행 상황을 볼 수 없다.
 */

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ execution_id: string }>
  searchParams: Promise<{ tab?: string }>
}

/** §14.3 판정 열 — 저장값(영어)을 표시값(한글)으로 바꾼다. 반대 방향은 없다. */
function VerdictCell({ v }: { v: Verdict }) {
  const tone = v === 'pass' ? 'bg-emerald-50 text-emerald-700'
    : v === 'fail' ? 'bg-red-50 text-red-700'
    : 'text-neutral-400'
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>
      {VERDICT_LABEL[v] ?? v}
    </span>
  )
}

/**
 * 원본 JSON. 접어 두지만 자르지 않는다(§14.3 「가공·요약 없이」).
 * 넓은 내용은 자기 영역 안에서만 가로 스크롤한다 — 표 전체가 밀리면 못 읽는다.
 */
function JsonCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-neutral-300">-</span>
  }
  const json = rawJson(value)
  const oneLine = JSON.stringify(value)

  return (
    <details className="group max-w-[22rem]">
      <summary className="cursor-pointer truncate font-mono text-[11px] text-neutral-500
                          hover:text-neutral-900 group-open:text-neutral-900">
        {oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine}
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-neutral-50 p-2 text-[11px]
                      leading-relaxed text-neutral-700">{json}</pre>
    </details>
  )
}

function LogTable({ rows }: { rows: LogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
        이 분류에는 기록이 없습니다.
      </p>
    )
  }

  return (
    // 8열이라 좁은 화면에서는 표만 가로로 흐른다. 페이지 본문은 밀지 않는다.
    <div className="overflow-x-auto rounded-xl border border-neutral-200">
      <table className="w-full min-w-[64rem] text-left text-sm">
        <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
          {/* §14.3이 컬럼 순서를 규정한다: 타임스탬프 → 시도 → 재시도 → 단계명 → 판정 → 상태 → 입력 → 출력 */}
          <tr>
            <th className="px-3 py-2 font-medium">타임스탬프 (UTC)</th>
            <th className="px-3 py-2 font-medium">시도</th>
            <th className="px-3 py-2 font-medium">재시도</th>
            <th className="px-3 py-2 font-medium">단계명</th>
            <th className="px-3 py-2 font-medium">판정</th>
            <th className="px-3 py-2 font-medium">상태</th>
            <th className="px-3 py-2 font-medium">입력</th>
            <th className="px-3 py-2 font-medium">출력</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-neutral-500">
                {utcStamp(r.created_at)}
              </td>
              <td className="px-3 py-2 text-neutral-600">{r.attempt_no}</td>
              {/* 0 = 최초 시도. `-`로 감추지 않는다 — 「재시도 없음」과 「값 없음」은 다르다 */}
              <td className="px-3 py-2 text-neutral-600">{r.retry_index}</td>
              <td className="px-3 py-2">
                <span className="font-medium text-neutral-900">
                  {STEP_LABEL[r.step as LogStep] ?? r.step}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-neutral-400">
                  {r.step}
                </span>
              </td>
              <td className="px-3 py-2"><VerdictCell v={r.verdict} /></td>
              <td className="px-3 py-2 font-mono text-[11px] text-neutral-600">{r.status}</td>
              <td className="px-3 py-2"><JsonCell value={r.input} /></td>
              <td className="px-3 py-2"><JsonCell value={r.output} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** §5.5 — 감지된 것만 나열한다. 0건이면 「없음」 한 줄로 끝낸다. */
function Flags({ flags }: { flags: FlagRow[] }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold">
        {'이상 플래그 '}
        {flags.length > 0 && (
          // 숫자와 단위를 한 문자열로 넘긴다 — 나누면 SSR 결과에 주석 노드가 끼어
          // `2건`이라는 문자열이 HTML에 존재하지 않게 된다(검색·테스트가 어긋난다).
          <span className="text-amber-700">{`${flags.length}건`}</span>
        )}
      </h2>
      {flags.length === 0 ? (
        <p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
          감지된 이상이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {flags.map((f) => (
            <li key={f.id} className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-amber-900">
                  {ABNORMALITY_LABEL[f.type] ?? f.type}
                </span>
                <span className="font-mono text-[11px] text-amber-700">{f.type}</span>
                <span className="text-xs text-amber-700">
                  {`${f.attempt_no}회차 · ${f.step}`}
                </span>
                <span className="ml-auto font-mono text-[11px] text-amber-600">
                  {utcStamp(f.detected_at)}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-amber-900">{f.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default async function LogsPage({ params, searchParams }: Props) {
  const { execution_id } = await params
  const tab = resolveTab((await searchParams).tab)

  const [logs, flags, product] = await Promise.all([
    loadLogs(execution_id).catch(() => null),
    loadFlags(execution_id).catch(() => [] as FlagRow[]),
    loadProductByExecution(execution_id).catch(() => null),
  ])

  /*
   * 로그 조회 자체가 실패한 것과 「기록이 0건」은 구분한다. 0건이면 없는
   * `execution_id`이므로 404다 — 상품이 삭제돼도 로그는 남으므로(§12.4)
   * 상품 유무로 판정하면 삭제된 실행의 이력을 볼 수 없게 된다.
   */
  if (logs === null) throw new Error('로그를 불러올 수 없습니다.')
  if (logs.length === 0) notFound()

  const byCategory = (c: LogCategory) => logs.filter((r) => r.category === c)
  const rows = byCategory(tab)

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-neutral-200 pb-4">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">실행 로그</h1>
          <div className="flex shrink-0 gap-4 text-sm text-neutral-500">
            {product && (
              <Link href={`/admin/products/${product.id}`} className="hover:text-neutral-900">
                상품 상세
              </Link>
            )}
            <Link href="/admin" className="hover:text-neutral-900">목록</Link>
          </div>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600">
          <div>
            <dt className="inline text-neutral-400">실행 ID </dt>
            <dd className="inline font-mono text-xs">{execution_id}</dd>
          </div>
          {product ? (
            <>
              <div>
                <dt className="inline text-neutral-400">행사명 </dt>
                <dd className="inline">{product.form_input?.행사정보?.행사명 ?? '-'}</dd>
              </div>
              <div>
                <dt className="inline text-neutral-400">현재 상태 </dt>
                <dd className="inline font-mono text-xs">{product.status}</dd>
              </div>
              <div>
                <dt className="inline text-neutral-400">시도 </dt>
                <dd className="inline">{`${product.attempt_no}회차`}</dd>
              </div>
            </>
          ) : (
            // §12.4 — 상품이 삭제돼도 로그는 남는다. 그 사실을 화면에서 밝힌다.
            <div className="text-neutral-500">상품 행이 없습니다 (삭제됨)</div>
          )}
          <div>
            <dt className="inline text-neutral-400">전체 </dt>
            <dd className="inline">{`${logs.length}행`}</dd>
          </div>
        </dl>
      </header>

      {/* §14.3 탭 3종. 파이프라인이 기본이다 */}
      <nav className="mt-6 flex gap-1" aria-label="로그 분류">
        {LOG_TABS.map((t) => {
          const n = byCategory(t.key).length
          const active = t.key === tab
          return (
            <Link
              key={t.key}
              href={`/admin/logs/${execution_id}?tab=${t.key}`}
              aria-current={active ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'bg-neutral-900 font-medium text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-xs ${active ? 'text-neutral-300' : 'text-neutral-400'}`}>
                {n}
              </span>
            </Link>
          )
        })}
      </nav>

      <div className="mt-4">
        <LogTable rows={rows} />
      </div>

      {/* 이상 플래그는 탭과 무관하게 같은 화면 하단에 둔다(§14.3) */}
      <Flags flags={flags} />
    </main>
  )
}
