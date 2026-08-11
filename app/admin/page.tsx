import Link from 'next/link'
import { db } from '@/lib/supabase'
import { PRODUCT_STATUSES, type ProductStatus, type ValidationSnapshot } from '@/lib/types'
import {
  buttonTarget, describeStatus, screenPath, STATUS_FILTERS, type StatusInput,
} from '@/lib/status-view'
import { StatusBadges } from '@/components/admin/badges'
import { isAvailable } from '@/components/admin/available'

/**
 * §14.1 — 상품 목록. **인증 필요**(`proxy.ts`가 `/admin/*`를 막는다).
 *
 * 요구는 3가지다.
 *   · 상태 필터: 전체 + 7개 상태 전부
 *   · 각 행에 배지 2종 (§10.4)
 *   · 각 행에 상태별 버튼 (§15.1)
 *
 * 판정은 전부 `lib/status-view.ts`가 한다 — 이 화면에 조건문을 두면 상세·편집기와
 * 갈라진다. 여기는 그리기만 한다.
 */

interface Row {
  id: string
  status: ProductStatus
  slug: string | null
  human_edited: boolean
  publish_override_at: string | null
  validation_snapshot: ValidationSnapshot | null
  updated_at: string
  form_input: { 행사정보?: { 행사명?: string; 여행지?: string } } | null
}

/** 한 화면에 담는 상한. 넘으면 잘렸다는 것을 화면에 알린다 — 조용히 자르지 않는다. */
const LIST_LIMIT = 200

/** 서버·사용자 시간대가 달라 헷갈리지 않게 UTC로 못박는다 (§14.3과 같은 기준). */
function stamp(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ') + ' UTC'
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: raw } = await searchParams
  const active: ProductStatus | 'all' =
    (PRODUCT_STATUSES as readonly string[]).includes(raw ?? '') ? (raw as ProductStatus) : 'all'

  /**
   * **조회는 한 번뿐이다.** 목록용·건수용으로 나눠 두 번 조회하면 둘 중 하나만
   * 실패했을 때 화면 절반이 조용히 틀린다 — 목록에는 6건이 보이는데 필터 칩은
   * 전부 0을 가리키는 식이다. 실제로 그렇게 렌더된 적이 있고, 오류를 삼키는
   * 구조라 화면만 봐서는 무엇이 잘못됐는지 알 수 없었다.
   *
   * 한 번 읽어 메모리에서 세면 목록과 건수가 **항상 같은 데이터에서 나온다.**
   * 기획자 1인용 내부 도구라 상한 200건이면 충분하고, 넘으면 화면에 알린다.
   */
  const { data, error } = await db()
    .from('products')
    .select('id, status, slug, human_edited, publish_override_at, validation_snapshot, updated_at, form_input')
    // 최근 손댄 것이 위로. 진행 중인 작업을 먼저 보게 된다.
    .order('updated_at', { ascending: false })
    // 초과 여부를 알아야 「200건까지만 표시」를 정직하게 띄울 수 있다
    .limit(LIST_LIMIT + 1)

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          목록을 불러오지 못했습니다: {error.message}
        </p>
      </main>
    )
  }

  const fetched = (data ?? []) as Row[]
  const truncated = fetched.length > LIST_LIMIT
  const allRows = truncated ? fetched.slice(0, LIST_LIMIT) : fetched

  const counts = new Map<string, number>()
  for (const r of allRows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
  counts.set('all', allRows.length)

  const rows = active === 'all' ? allRows : allRows.filter((r) => r.status === active)

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">상품 목록</h1>
          <p className="mt-1 text-sm text-neutral-500">기획자 전용 · 총 {counts.get('all') ?? 0}건</p>
        </div>
        <Link
          href="/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white
                     transition hover:bg-neutral-800"
        >
          새 상품 등록
        </Link>
      </header>

      {/* 상태 필터 — 7개 상태 전부 + 전체 (§14.1) */}
      <nav className="mt-5 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const n = counts.get(f.value) ?? 0
          const on = f.value === active
          return (
            <Link
              key={f.value}
              href={f.value === 'all' ? '/admin' : `/admin?status=${f.value}`}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                on ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 text-xs ${on ? 'text-neutral-300' : 'text-neutral-500'}`}>
                {n}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* 잘렸으면 숨기지 않고 말한다 — 「전체」가 실제 전체가 아닌 상황이다 */}
      {truncated && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          최근 {LIST_LIMIT}건까지만 표시합니다. 필터 건수도 이 범위 안에서 센 값입니다.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-10 rounded-lg bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">
          {active === 'all'
            ? '아직 등록된 상품이 없습니다. [새 상품 등록]으로 시작해 주세요.'
            : '이 상태의 상품이 없습니다.'}
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((r) => {
            const view = describeStatus(r as StatusInput)
            const name = r.form_input?.행사정보?.행사명 || '(행사명 없음)'

            return (
              <li key={r.id} className="rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-300">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* 행사명 → §14.1의 「도달 화면」 */}
                    <Link
                      href={screenPath(view.screen, r.id)}
                      className="block truncate font-medium hover:underline"
                    >
                      {name}
                    </Link>
                    <p className="mt-0.5 truncate text-sm text-neutral-500">
                      {r.form_input?.행사정보?.여행지 || '여행지 미입력'} · {stamp(r.updated_at)}
                    </p>
                  </div>

                  {/* 배지 2종 — 검증축·편집축은 서로 독립 (§10.4) */}
                  <StatusBadges p={r as StatusInput} />
                </div>

                {/* 공개 중이면 실제 주소를 바로 확인할 수 있게 (§12.2) */}
                {view.isPublic && r.slug && (
                  <a
                    href={`/p/${r.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block font-mono text-xs text-emerald-700 underline"
                  >
                    /p/{r.slug}
                  </a>
                )}

                {/*
                  상태별 버튼 (§15.1). 실행이 아니라 **입구**다 —
                  확인 모달·실패 항목 열람이 필요한 것들은 그 화면에서 한다.
                */}
                <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                  {view.buttons.filter((b) => isAvailable(b.key)).map((b) =>
                    b.disabled ? (
                      <span
                        key={b.key}
                        title={b.disabledReason}
                        className="cursor-not-allowed rounded-lg bg-neutral-100 px-3 py-1.5
                                   text-sm text-neutral-400"
                      >
                        {b.label}
                      </span>
                    ) : (
                      <Link
                        key={b.key}
                        href={buttonTarget(b.key, r.id)}
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm
                                   transition hover:bg-neutral-50"
                      >
                        {b.label}
                      </Link>
                    ),
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
