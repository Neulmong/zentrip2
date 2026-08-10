'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TRAVEL_STYLES, CHILD_NOT_OFFERED, tripDays } from '@/lib/form-validation'
import { TRIP_DAYS_MAX } from '@/lib/types'

/** spec §7 — 필수 폼 그룹 6개 + 선택 4개 + 슬롯 지정 이미지 업로드. */

const ITINERARY_PLACEHOLDER = `1일: 김해공항 출발, 올레 7코스 걷기, 중식·석식 제공
2일: 성산일출봉, 해녀박물관 관람, 조식·중식 제공
3일: 자유 일정, 조식 제공
4일: 귀국`

type Errors = Record<string, string>

function Field({
  name, label, error, hint, children,
}: {
  name: string; label: string; error?: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-neutral-800">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-neutral-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none '
  + 'focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900'

function Group({ title, required, children }: {
  title: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-neutral-200 p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-900">
        {title}
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
          required ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'}`}>
          {required ? '필수' : '선택'}
        </span>
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

export default function NewProductPage() {
  const router = useRouter()
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [childNotOffered, setChildNotOffered] = useState(false)

  /** 여행기간 입력 후 일차 수만큼 슬롯을 자동 생성한다(§7.3). */
  const days = useMemo(() => {
    const d = start && end ? tripDays(start, end) : null
    return d !== null && d >= 1 && d <= TRIP_DAYS_MAX ? d : 0
  }, [start, end])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    setProgress('저장 중…')

    const fd = new FormData(e.currentTarget)
    if (childNotOffered) fd.set('가격_아동', CHILD_NOT_OFFERED)

    const res = await fetch('/api/products', { method: 'POST', body: fd })
    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      setErrors(body.field_errors ?? { _: '등록에 실패했습니다.' })
      setProgress(null)
      setBusy(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    // 이후 3개 요청(일차 분해 → 소개서 → 1차 검증)은 #9에서 이어 붙인다.
    setProgress('등록되었습니다. 소개서 생성으로 이동합니다…')
    router.push(`/admin/products/${body.product_id}`)
  }

  const err = (k: string) => errors[k]

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">새 상품 등록</h1>
        <p className="mt-1 text-sm text-neutral-500">
          입력한 값은 그대로 소개서와 상품 페이지에 반영됩니다. AI가 값을 바꾸지 않습니다.
        </p>
      </header>

      {errors._ && (
        <p role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {errors._}
        </p>
      )}

      <form onSubmit={submit} className="space-y-5">
        <Group title="행사정보" required>
          <Field name="행사명" label="행사명" error={err('행사정보.행사명')} hint="2~40자">
            <input id="행사명" name="행사명" className={inputClass} maxLength={40}
              placeholder="제주 올레 바람 여행" />
          </Field>
          <Field name="여행지" label="여행지" error={err('행사정보.여행지')} hint="2~60자">
            <input id="여행지" name="여행지" className={inputClass} maxLength={60} placeholder="제주" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field name="여행기간_시작" label="시작일" error={err('행사정보.여행기간_시작')}>
              <input id="여행기간_시작" name="여행기간_시작" type="date" className={inputClass}
                value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field name="여행기간_종료" label="종료일" error={err('행사정보.여행기간_종료')}
              hint={days ? `${days}일 (최대 ${TRIP_DAYS_MAX}일)` : `최대 ${TRIP_DAYS_MAX}일`}>
              <input id="여행기간_종료" name="여행기간_종료" type="date" className={inputClass}
                value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
        </Group>

        <Group title="일정" required>
          <Field name="일정원문" label="일정 원문" error={err('행사정보.일정원문')}
            hint="20~2000자. 일차 구분을 넣어 주세요 — '1일:', '2일차', 'Day 1', '첫째 날' 형식을 인식합니다.">
            <textarea id="일정원문" name="일정원문" rows={7} maxLength={2000}
              className={`${inputClass} font-mono text-[13px] leading-relaxed`}
              placeholder={ITINERARY_PLACEHOLDER} />
          </Field>
        </Group>

        <Group title="숙박" required>
          <Field name="숙소명" label="숙소명" error={err('숙박.숙소명')}>
            <input id="숙소명" name="숙소명" className={inputClass} maxLength={60}
              placeholder="롯데호텔 제주" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field name="객실타입" label="객실타입" error={err('숙박.객실타입')}>
              <input id="객실타입" name="객실타입" className={inputClass} maxLength={40}
                placeholder="디럭스룸" />
            </Field>
            <Field name="위치" label="위치" error={err('숙박.위치')}>
              <input id="위치" name="위치" className={inputClass} maxLength={60} placeholder="중문" />
            </Field>
          </div>
        </Group>

        <Group title="제휴상점" required>
          <Field name="상점명" label="상점명" error={err('상점.상점명')}>
            <input id="상점명" name="상점명" className={inputClass} maxLength={80}
              placeholder="제주 로컬 기념품 숍" />
          </Field>
          <Field name="상점정보" label="상점정보" error={err('상점.상점정보')} hint="1~500자">
            <textarea id="상점정보" name="상점정보" rows={3} maxLength={500} className={inputClass}
              placeholder="여행객 10% 할인" />
          </Field>
        </Group>

        <Group title="가격" required>
          <div className="grid grid-cols-2 gap-3">
            <Field name="가격_성인" label="성인" error={err('가격.성인')}>
              <div className="flex items-center gap-2">
                <input id="가격_성인" name="가격_성인" inputMode="numeric" pattern="[0-9]*"
                  className={inputClass} placeholder="120000" />
                <span className="shrink-0 text-sm text-neutral-500">원</span>
              </div>
            </Field>
            <Field name="가격_아동" label="아동" error={err('가격.아동')}>
              <div className="flex items-center gap-2">
                <input id="가격_아동" name="가격_아동" inputMode="numeric" pattern="[0-9]*"
                  className={inputClass} disabled={childNotOffered}
                  placeholder={childNotOffered ? CHILD_NOT_OFFERED : '80000'} />
                <span className="shrink-0 text-sm text-neutral-500">원</span>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
                <input type="checkbox" checked={childNotOffered}
                  onChange={(e) => setChildNotOffered(e.target.checked)} />
                아동 요금 미운영
              </label>
            </Field>
          </div>
          <Field name="가격_기타" label="기타 (포함/불포함 사항)" error={err('가격.기타')} hint="0~300자">
            <textarea id="가격_기타" name="가격_기타" rows={2} maxLength={300} className={inputClass}
              placeholder="항공료 별도" />
          </Field>
        </Group>

        <Group title="식사" required>
          <Field name="식사정보" label="식사정보" error={err('식사.식사정보')} hint="1~500자">
            <textarea id="식사정보" name="식사정보" rows={3} maxLength={500} className={inputClass}
              placeholder="조식 3회, 중식 2회, 석식 1회" />
          </Field>
        </Group>

        <Group title="추가 정보">
          <div className="grid grid-cols-2 gap-3">
            <Field name="타겟층" label="타겟층">
              <input id="타겟층" name="타겟층" className={inputClass} placeholder="30~40대 부부" />
            </Field>
            <Field name="여행스타일" label="여행스타일" hint="페이지 테마를 결정합니다">
              <select id="여행스타일" name="여행스타일" className={inputClass} defaultValue="">
                <option value="">선택 안 함</option>
                {TRAVEL_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field name="숙박일정" label="숙박일정">
            <input id="숙박일정" name="숙박일정" className={inputClass} placeholder="3박4일" />
          </Field>
          <fieldset className="grid grid-cols-2 gap-3 rounded-lg bg-neutral-50 p-3">
            <legend className="px-1 text-xs font-medium text-neutral-600">항공편</legend>
            {[['항공편_공항', '공항', '김해공항'], ['항공편_항공사', '항공사', '대한항공'],
              ['항공편_편명', '편명', 'KE1234'], ['항공편_출발시간', '출발시간', '09:00'],
              ['항공편_도착시간', '도착시간', '10:10']].map(([n, l, p]) => (
              <Field key={n} name={n} label={l}>
                <input id={n} name={n} className={inputClass} placeholder={p} />
              </Field>
            ))}
          </fieldset>
          <p className="text-xs text-neutral-500">
            비워두면 소개서·상품 페이지에 <strong>추후 추가 예정</strong>으로 표기되며,
            해당 섹션은 삭제되지 않습니다.
          </p>
        </Group>

        <Group title="이미지">
          {errors.images && <p className="text-xs text-red-600">{errors.images}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field name="image:hero" label="대표 이미지 (0~1장)">
              <input id="image:hero" name="image:hero" type="file"
                accept="image/jpeg,image/png,image/webp" className="text-xs" />
            </Field>
            <Field name="image:accommodation" label="숙소 사진 (0~3장)">
              <input id="image:accommodation" name="image:accommodation" type="file" multiple
                accept="image/jpeg,image/png,image/webp" className="text-xs" />
            </Field>
            <Field name="image:shop" label="제휴상점 사진 (0~2장)">
              <input id="image:shop" name="image:shop" type="file" multiple
                accept="image/jpeg,image/png,image/webp" className="text-xs" />
            </Field>
          </div>

          {days > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-neutral-700">일차별 사진 (각 0~1장)</p>
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: days }, (_, i) => i + 1).map((n) => (
                  <Field key={n} name={`image:itinerary_day_${n}`} label={`${n}일차`}>
                    <input id={`image:itinerary_day_${n}`} name={`image:itinerary_day_${n}`}
                      type="file" accept="image/jpeg,image/png,image/webp" className="text-xs" />
                  </Field>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-neutral-500">
            장당 5MB 이하 · JPG·PNG·WebP.
            업로드 이미지의 <strong>저작권·초상권 확보는 등록자 책임</strong>입니다.
          </p>
        </Group>

        <div className="sticky bottom-0 flex items-center gap-3 border-t border-neutral-200
                        bg-white/90 py-4 backdrop-blur">
          <button type="submit" disabled={busy}
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white
                       transition hover:bg-neutral-800 disabled:opacity-40">
            {busy ? '처리 중…' : '소개서 생성'}
          </button>
          {progress && <span className="text-sm text-neutral-600">{progress}</span>}
        </div>
      </form>
    </main>
  )
}
