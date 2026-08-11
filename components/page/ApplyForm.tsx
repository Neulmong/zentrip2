'use client'

import { useState } from 'react'
import {
  CONSENT_NOTICE, HEADCOUNT_MAX, HEADCOUNT_MIN,
  validateApplication, type ApplicationErrors,
} from '@/lib/application-validation'

/**
 * 신청 폼 (§13.1) — 공개 페이지의 `apply` 섹션에 주입된다.
 *
 * ## 필드 구성은 고정이다
 *
 * 이름·이메일·연락처·인원수·동의 5개. `page_content.data`에서 읽지 않고 이
 * 컴포넌트가 직접 그린다 — 편집기에서 바꿀 수 없는 계약이라(§10.2·§13.1)
 * 데이터로 두면 「바꿀 수 있는 것」처럼 보인다.
 *
 * ## 검증 규칙을 여기서 다시 쓰지 않는다
 *
 * `lib/application-validation.ts`를 그대로 호출한다. 클라이언트 표시용 규칙을
 * 따로 두면 서버가 400을 돌려주는 조건과 어긋나고, 사용자는 「통과했는데
 * 거절당하는」 폼을 보게 된다.
 *
 * ## 동의 미체크 시 제출 버튼 비활성
 *
 * §13.1이 규정한 동작이다. 다만 이것은 안내일 뿐이고 판정은 서버가 한다 —
 * 버튼 비활성은 우회할 수 있다.
 */

interface Props {
  productId: string
}

type Phase =
  | { kind: 'form' }
  | { kind: 'sending' }
  | { kind: 'done' }
  /** 게시가 중단된 상품 — 폼을 닫고 안내만 남긴다(§14.6 `product_not_published`) */
  | { kind: 'closed' }
  | { kind: 'error'; message: string }

const FIELDS = [
  { name: 'name', label: '이름', type: 'text', maxLength: 30, placeholder: '홍길동',
    autoComplete: 'name' },
  { name: 'email', label: '이메일', type: 'email', maxLength: 254,
    placeholder: 'name@example.com', autoComplete: 'email' },
  { name: 'phone', label: '연락처', type: 'tel', maxLength: 15,
    placeholder: '010-1234-5678', autoComplete: 'tel' },
] as const

const inputClass =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[15px] text-neutral-900 '
  + 'outline-none focus:border-[var(--t-primary)] focus:ring-1 focus:ring-[var(--t-primary)]'

export function ApplyForm({ productId }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  const [errors, setErrors] = useState<ApplicationErrors>({})
  const [consent, setConsent] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const body = {
      product_id: productId,
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      phone: String(fd.get('phone') ?? ''),
      headcount: String(fd.get('headcount') ?? ''),
      consent,
    }

    // 서버와 같은 규칙으로 먼저 본다. 통과하지 못하면 요청을 보내지 않는다.
    const check = validateApplication(body)
    if (!check.ok) { setErrors(check.errors); return }

    setErrors({})
    setPhase({ kind: 'sending' })

    let res: Response
    try {
      res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      setPhase({ kind: 'error', message: '네트워크 오류로 신청을 보내지 못했습니다. 다시 시도해 주세요.' })
      return
    }

    if (res.ok) { setPhase({ kind: 'done' }); return }

    const data = await res.json().catch(() => ({}))

    if (res.status === 400) {
      setErrors((data as { field_errors?: ApplicationErrors }).field_errors ?? {})
      setPhase({ kind: 'form' })
      return
    }
    /*
     * 409는 재호출로 풀리지 않는다(§14.6). 이 라우트에서 나올 수 있는 reason은
     * `product_not_published` 하나이므로 폼을 닫고 안내만 남긴다.
     */
    if (res.status === 409) { setPhase({ kind: 'closed' }); return }

    setPhase({
      kind: 'error',
      message: '신청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    })
  }

  if (phase.kind === 'done') {
    return (
      <div
        role="status"
        className="rounded-xl border border-[var(--t-primary)] bg-[var(--t-secondary)]/30 px-4 py-6 text-center"
      >
        <p className="text-[15px] font-semibold">신청이 접수되었습니다.</p>
        <p className="mt-2 text-sm leading-relaxed">
          입력하신 이메일로 신청 내역을 보내 드립니다.
          {' '}메일이 보이지 않으면 스팸함을 확인해 주세요.
        </p>
      </div>
    )
  }

  if (phase.kind === 'closed') {
    return (
      <div
        role="alert"
        className="rounded-xl border border-dashed border-[var(--t-primary)] px-4 py-6 text-center text-[15px]"
      >
        이 상품은 현재 신청을 받지 않습니다. 문의처로 연락해 주세요.
      </div>
    )
  }

  const sending = phase.kind === 'sending'

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {phase.kind === 'error' && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {phase.message}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.name} className={f.name === 'name' ? '' : 'sm:col-span-1'}>
            <label htmlFor={`apply-${f.name}`} className="block text-sm font-medium">
              {f.label}
            </label>
            <input
              id={`apply-${f.name}`} name={f.name} type={f.type}
              maxLength={f.maxLength} placeholder={f.placeholder} autoComplete={f.autoComplete}
              className={`mt-1.5 ${inputClass}`} disabled={sending}
            />
            {errors[f.name] && (
              <p className="mt-1 text-xs text-red-600">{errors[f.name]}</p>
            )}
          </div>
        ))}

        <div>
          <label htmlFor="apply-headcount" className="block text-sm font-medium">인원수</label>
          <input
            id="apply-headcount" name="headcount" type="number" inputMode="numeric"
            min={HEADCOUNT_MIN} max={HEADCOUNT_MAX} step={1} defaultValue={1}
            className={`mt-1.5 ${inputClass}`} disabled={sending}
          />
          {errors.headcount && <p className="mt-1 text-xs text-red-600">{errors.headcount}</p>}
        </div>
      </div>

      {/* 동의 영역 — 수집 항목·목적·보유 기간 3개를 표시한다(§13.1) */}
      <fieldset className="rounded-xl bg-[var(--t-secondary)]/25 px-4 py-4">
        <legend className="sr-only">개인정보 수집·이용 동의</legend>
        <dl className="space-y-1 text-[13px] leading-relaxed">
          {([
            ['수집 항목', CONSENT_NOTICE.수집항목],
            ['수집 목적', CONSENT_NOTICE.수집목적],
            ['보유 기간', CONSENT_NOTICE.보유기간],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex flex-wrap gap-x-2">
              <dt className="font-semibold whitespace-nowrap">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox" name="consent" checked={consent} disabled={sending}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--t-primary)]"
          />
          <span>개인정보 수집·이용에 동의합니다. <span aria-hidden>(필수)</span></span>
        </label>
        {errors.consent && <p className="mt-1 text-xs text-red-600">{errors.consent}</p>}
      </fieldset>

      {errors.product_id && (
        <p role="alert" className="text-xs text-red-600">{errors.product_id}</p>
      )}

      <button
        type="submit"
        // §13.1 — 동의 미체크 시 비활성. 판정은 서버가 다시 한다.
        disabled={!consent || sending}
        className="w-full rounded-lg bg-[var(--t-primary)] px-4 py-3 text-[15px] font-semibold
                   text-white transition-opacity hover:opacity-90
                   disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sending ? '접수 중…' : '신청하기'}
      </button>
    </form>
  )
}
