import Link from 'next/link'
import { loadApplications, retentionExpired, RETENTION_DAYS } from '@/lib/applications'
import { maskEmail, maskName, maskPhone } from '@/lib/mask'
import { utcStamp } from '@/lib/log-view'
import { ApplicationActions } from '@/components/admin/ApplicationActions'
import type { ApplicationRow, EmailStatus } from '@/lib/types'

/**
 * §14.1 — `/admin/applications`. 전체 신청 내역 · 이메일 발송 상태 · 재발송.
 *
 * ## 연락처는 기본 마스킹이고, 전체 표시는 요청해야 한다
 *
 * §13.1의 요건이다. **마스킹 해제를 클라이언트 토글로 두지 않았다** — 그러면
 * 원본이 이미 HTML에 실려 브라우저까지 와 있고, 「명시적 조작 시에만 표시」가
 * 화면 효과에 그친다. `?reveal={id}`로 **한 건씩 서버에 요청**하면 나머지 행의
 * 원본은 애초에 전송되지 않는다.
 *
 * 이름·이메일도 같은 규칙으로 가린다. §13.1이 이름을 든 곳은 연락처지만,
 * 신청자 명단이 그대로 보이는 화면을 열어 둘 이유가 없고 해제 경로가 이미 있다.
 *
 * ## 정렬 기본값은 최근순, 오래된순은 삭제 작업용이다
 *
 * §13.1이 보유 기간(1년) 경과분을 「관리 화면에서 접수일 기준으로 정렬해 수동
 * 처리」하도록 규정한다. 그 작업 방향이 오래된순이므로 토글로 둔다.
 *
 * ## 캐시하지 않는다
 *
 * 발송 상태는 `after()` 안에서 늦게 바뀌고(§13.2 7번) 재발송·삭제도 이 화면에서
 * 일어난다. 새로고침이 같은 화면을 돌려주면 결과를 볼 수 없다.
 */

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ reveal?: string; sort?: string; product_id?: string }>
}

const EMAIL_STATUS: Record<EmailStatus, { label: string; tone: string }> = {
  pending: { label: '발송 중', tone: 'bg-neutral-100 text-neutral-600' },
  sent: { label: '발송됨', tone: 'bg-emerald-50 text-emerald-700' },
  // §13.3 — 발송 실패는 신청 실패가 아니다. 재발송이 남은 경로라는 것을 톤으로 구분한다
  failed: { label: '발송 실패', tone: 'bg-red-50 text-red-700' },
}

function EmailBadge({ status }: { status: EmailStatus }) {
  const s = EMAIL_STATUS[status] ?? { label: status, tone: 'bg-neutral-100 text-neutral-600' }
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>
      {s.label}
    </span>
  )
}

/** 접수일은 UTC ISO로 고정한다(§14.3과 같은 이유 — 대조하는 화면이다). */
function received(a: ApplicationRow): string {
  return utcStamp(a.created_at)
}

export default async function ApplicationsPage({ searchParams }: Props) {
  const q = await searchParams
  const oldestFirst = q.sort === 'oldest'
  const reveal = q.reveal

  const rows = await loadApplications({
    product_id: q.product_id,
    oldestFirst,
  }).catch(() => null)

  if (rows === null) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          신청 내역을 불러올 수 없습니다.
        </p>
      </main>
    )
  }

  const expired = rows.filter((a) => retentionExpired(a.created_at)).length
  const failed = rows.filter((a) => a.email_status === 'failed').length
  const base = q.product_id ? `/admin/applications?product_id=${q.product_id}` : '/admin/applications'
  const sortHref = `${base}${base.includes('?') ? '&' : '?'}sort=${oldestFirst ? 'recent' : 'oldest'}`

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-neutral-200 pb-4">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">신청 내역</h1>
          <Link href="/admin" className="shrink-0 text-sm text-neutral-500 hover:text-neutral-900">
            목록
          </Link>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600">
          <div>
            <dt className="inline text-neutral-400">전체 </dt>
            <dd className="inline">{`${rows.length}건`}</dd>
          </div>
          {failed > 0 && (
            <div>
              <dt className="inline text-neutral-400">발송 실패 </dt>
              <dd className="inline text-red-700">{`${failed}건`}</dd>
            </div>
          )}
          {expired > 0 && (
            <div>
              <dt className="inline text-neutral-400">보유 기간 경과 </dt>
              <dd className="inline text-amber-700">{`${expired}건`}</dd>
            </div>
          )}
          {q.product_id && (
            <div>
              <dt className="inline text-neutral-400">상품 </dt>
              <dd className="inline">
                <Link href={`/admin/products/${q.product_id}`} className="underline">
                  이 상품의 신청만 보기 중
                </Link>
                {' · '}
                <Link href="/admin/applications" className="underline">전체 보기</Link>
              </dd>
            </div>
          )}
        </dl>
      </header>

      <div className="mt-6 flex items-center justify-between gap-4">
        <Link
          href={sortHref}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700
                     hover:border-neutral-900 hover:text-neutral-900"
        >
          {oldestFirst ? '오래된순 ↑' : '최근순 ↓'}
        </Link>
        <p className="text-xs text-neutral-500">
          {`개인정보 보유 기간은 접수일로부터 ${RETENTION_DAYS}일입니다. 경과분은 [삭제]로 처리합니다.`}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
          접수된 신청이 없습니다.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200">
          <table className="w-full min-w-[60rem] text-left text-sm">
            <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">접수일 (UTC)</th>
                <th className="px-3 py-2 font-medium">상품</th>
                <th className="px-3 py-2 font-medium">신청자</th>
                <th className="px-3 py-2 font-medium">이메일</th>
                <th className="px-3 py-2 font-medium">연락처</th>
                <th className="px-3 py-2 font-medium">인원</th>
                <th className="px-3 py-2 font-medium">발송</th>
                <th className="px-3 py-2 font-medium">동작</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((a) => {
                const shown = a.id === reveal
                const over = retentionExpired(a.created_at)
                return (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-neutral-500">
                      {received(a)}
                      {over && (
                        <span className="mt-1 block rounded bg-amber-50 px-1.5 py-0.5 text-center
                                         text-[10px] font-medium text-amber-800">
                          보유 기간 경과
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/products/${a.product_id}`}
                        className="text-neutral-900 underline decoration-neutral-300
                                   hover:decoration-neutral-900"
                      >
                        {a.product_snapshot?.행사명 ?? '(행사명 없음)'}
                      </Link>
                      <span className="mt-0.5 block text-[11px] text-neutral-400">
                        {a.product_snapshot?.여행기간 ?? '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-800">
                      {shown ? a.name : maskName(a.name)}
                    </td>
                    <td className="break-all px-3 py-2 font-mono text-[11px] text-neutral-700">
                      {shown ? a.email : maskEmail(a.email)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-neutral-700">
                      {shown ? a.phone : maskPhone(a.phone)}
                      {/* §13.1 — 전체 표시는 명시적 조작이다. 서버에 한 건씩 요청한다 */}
                      <Link
                        href={shown ? base : `${base}${base.includes('?') ? '&' : '?'}reveal=${a.id}${oldestFirst ? '&sort=oldest' : ''}`}
                        className="mt-1 block text-[10px] font-sans text-neutral-500 underline
                                   hover:text-neutral-900"
                      >
                        {shown ? '가리기' : '전체 보기'}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-neutral-700">{`${a.headcount}명`}</td>
                    <td className="px-3 py-2">
                      <EmailBadge status={a.email_status} />
                      {a.email_error && (
                        <p className="mt-1 max-w-[16rem] break-words text-[10px] leading-snug text-red-600">
                          {a.email_error}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ApplicationActions
                        id={a.id}
                        // 확인 모달에도 마스킹된 값을 넘긴다 — 해제 경로는 한 곳뿐이어야 한다
                        maskedName={maskName(a.name)}
                        received={received(a)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
