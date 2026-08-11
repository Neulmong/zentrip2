import {
  describeStatus, editBadge, verificationBadge,
  VERIFICATION_BADGE_LABEL, type StatusInput,
} from '@/lib/status-view'

/**
 * 배지 2종 (§10.4) — **순수 표시 컴포넌트**.
 *
 * 판정은 전부 `lib/status-view.ts`가 하고 여기서는 그리기만 한다.
 * 조건문을 컴포넌트에 두면 목록·상세·편집기 세 곳의 판정이 갈라진다.
 *
 * ## 왜 배지를 두는가
 *
 * AI 검증은 §11.4의 기준 시점에 고정되며 **편집 이후 재검증하지 않는다.**
 * 즉 게시된 페이지의 어떤 문장은 AI가 검증한 것이고 어떤 문장은 아니다.
 * 이 경계를 화면에 드러내지 않으면 편집분의 정확성이 누구 책임인지 흐려진다(§10.4).
 *
 * ## 두 축은 독립이다
 *
 * 합치면 조건이 겹치고 **검증 실패 시 편집 여부가 화면에서 사라진다.**
 * `AI 검증 실패` + `사람 편집됨`이 동시에 붙을 수 있어야 한다.
 */

const BASE = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium'

/** 검증축 3종 — 상호 배타. 미검증이면 아무것도 그리지 않는다. */
export function VerificationBadge({ p }: { p: StatusInput }) {
  const kind = verificationBadge(p)
  if (!kind) return null

  const tone = {
    pass: 'bg-emerald-50 text-emerald-800',
    fail: 'bg-red-50 text-red-800',
    // 책임 게시는 실패지만 기획자가 감수하고 내보낸 상태다 — 경고 톤으로 구분한다
    override: 'bg-amber-50 text-amber-900',
  }[kind]

  return <span className={`${BASE} ${tone}`}>{VERIFICATION_BADGE_LABEL[kind]}</span>
}

/** 편집축 — `human_edited = true`일 때만 그린다. 「편집 안 됨」 배지는 없다. */
export function EditBadge({ p }: { p: StatusInput }) {
  const label = editBadge(p)
  if (!label) return null

  return <span className={`${BASE} bg-sky-50 text-sky-800`}>{label}</span>
}

/** §15.1 「표시 이름」. DB의 영어 status를 화면에 그대로 노출하지 않는다. */
export function StatusLabel({ p }: { p: StatusInput }) {
  return (
    <span className={`${BASE} bg-neutral-100 text-neutral-800`}>
      {describeStatus(p).label}
    </span>
  )
}

/** 세 개를 한 줄로. 목록의 행과 상세의 머리말이 같은 배열을 쓴다. */
export function StatusBadges({ p, className = '' }: { p: StatusInput; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <StatusLabel p={p} />
      <VerificationBadge p={p} />
      <EditBadge p={p} />
    </div>
  )
}
