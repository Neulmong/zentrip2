'use client'

import type { PageSection } from '@/lib/pipeline/page'
import type { PageImage } from '@/components/page/types'
import { BLOCK_SPEC, LENGTH_LIMITS_SAVE, type BlockType } from '@/lib/edit-contract'

/**
 * 중앙 편집 패널 (§10.1) — 선택한 섹션 1개의 `data`를 편집한다.
 *
 * ## 폼을 §9.3 표에서 만들지 않고 값에서 만드는 이유
 *
 * 섹션 9종 + 블록 3종의 필드 목록을 여기에 다시 적으면 §9.3·§10.2 표의 **사본**이
 * 하나 더 생긴다. 표가 바뀌면 두 곳을 고쳐야 하고, 한쪽을 잊으면 편집기에서만
 * 필드가 사라진다. 그래서 실제 `data`의 키를 그대로 훑고, 종류별로 다르게
 * 그려야 하는 것(이미지 참조·일정 배열·읽기 전용)만 이름으로 분기한다.
 *
 * 새 키를 만들거나 지우지 않는다 — 그건 서버가 400으로 거부한다(§9.3 키 고정).
 */

export interface SectionFormProps {
  section: PageSection
  images: PageImage[]
  errors: Record<string, string>
  onChange: (data: Record<string, unknown>) => void
}

/** 사실정보 요약 — `apply`에서만 나오며 편집 불가다(§10.2). */
const READONLY_KEYS = new Set(['가격요약', '행사정보요약'])

/** 여러 줄로 받아야 자연스러운 필드. 나머지는 한 줄 입력이다. */
const MULTILINE = new Set(['안내문구', '본문', '상점정보', '식사정보', '기타', '위치', '숙박일정'])

/** 길이 계약(§17.1)이 걸린 필드 — 남은 글자수를 보여준다. */
function limitOf(section: PageSection, key: string): number | null {
  if (section.type === 'hero' && key === 'headline') return LENGTH_LIMITS_SAVE['hero.headline']
  if (section.type === 'hero' && key === 'subcopy') return LENGTH_LIMITS_SAVE['hero.subcopy']
  if (key === '제목') return LENGTH_LIMITS_SAVE['섹션 제목']
  if (section.type === 'free_text' && key === '본문') return LENGTH_LIMITS_SAVE['free_text 블록']
  if (section.type === 'notice' && key === '본문') return LENGTH_LIMITS_SAVE['notice 블록']
  return null
}

export function SectionForm({ section, images, errors, onChange }: SectionFormProps) {
  const set = (key: string, value: unknown) => onChange({ ...section.data, [key]: value })

  const slots = [...new Set(images.map((i) => i.slot))].sort()
  const optional = new Set(
    (BLOCK_SPEC[section.type as BlockType]?.optional) ?? [],
  )

  return (
    <div className="space-y-5">
      {Object.entries(section.data).map(([key, value]) => {
        const err = errors[`${section.id}.${key}`]

        if (key === 'days') {
          return (
            <DaysField
              key={key} section={section} slots={slots} errors={errors}
              onChange={(days) => set('days', days)}
            />
          )
        }

        if (READONLY_KEYS.has(key)) {
          return <ReadonlyField key={key} label={key} value={value} />
        }

        if (key === 'image_slot') {
          return (
            <Field key={key} label="대표 사진 슬롯" error={err} hint="업로드된 슬롯 중에서 고릅니다(§7.3).">
              <select
                value={String(value ?? '')}
                onChange={(e) => set(key, e.target.value)}
                className={inputClass}
              >
                <option value="">사진 없음</option>
                {slots.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          )
        }

        if (key === 'image_slots') {
          const picked = new Set(Array.isArray(value) ? value.map(String) : [])
          return (
            <Field key={key} label="사진 슬롯" error={err}
              hint="장수와 순서는 업로드 순서가 정합니다(§9.3).">
              <div className="flex flex-wrap gap-3">
                {slots.length === 0 && <span className="text-sm text-neutral-500">업로드된 사진이 없습니다.</span>}
                {slots.map((s) => (
                  <label key={s} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.has(s)}
                      onChange={(e) => {
                        const next = new Set(picked)
                        if (e.target.checked) next.add(s); else next.delete(s)
                        set(key, [...next].sort())
                      }}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </Field>
          )
        }

        if (key === 'image_id') {
          return (
            <Field key={key} label="사진" error={err}
              hint="편집기에서는 새로 올리지 않고 이미 올라간 사진 중에서 고릅니다(§10.2).">
              <select
                value={String(value ?? '')}
                onChange={(e) => set(key, e.target.value)}
                className={inputClass}
              >
                <option value="">— 고르세요 —</option>
                {images.map((im) => (
                  <option key={im.id} value={im.id}>{im.slot} · {im.alt}</option>
                ))}
              </select>
            </Field>
          )
        }

        const str = typeof value === 'string' ? value : String(value ?? '')
        const limit = limitOf(section, key)

        return (
          <Field
            key={key}
            label={key + (optional.has(key) ? ' (선택)' : '')}
            error={err}
            counter={limit ? `${str.length} / ${limit}` : undefined}
            over={limit ? str.length > limit : false}
          >
            {MULTILINE.has(key) || str.length > 60 ? (
              <textarea
                value={str} rows={4}
                onChange={(e) => set(key, e.target.value)}
                className={inputClass}
              />
            ) : (
              <input
                type="text" value={str}
                onChange={(e) => set(key, e.target.value)}
                className={inputClass}
              />
            )}
          </Field>
        )
      })}
    </div>
  )
}

/* ── 일정 배열 ─────────────────────────────────────────────────────
 * 일차의 **개수와 번호는 편집 대상이 아니다.** `confirmed_data`의 일차 분해
 * 결과이고 검증 4축이 그 개수를 기준으로 판정했다(§6.3·§11.2). 서술과 사진만
 * 고친다 — 그래서 [일차 추가] 버튼이 없다.
 * ────────────────────────────────────────────────────────────────── */

interface Day { day: string; text: string; image_slot: string }

function DaysField({
  section, slots, errors, onChange,
}: {
  section: PageSection
  slots: string[]
  errors: Record<string, string>
  onChange: (days: Day[]) => void
}) {
  const days = (Array.isArray(section.data.days) ? section.data.days : []) as Day[]
  const limit = LENGTH_LIMITS_SAVE['일차별 서술']

  const patch = (i: number, key: keyof Day, v: string) =>
    onChange(days.map((d, n) => (n === i ? { ...d, [key]: v } : d)))

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        일차 개수는 입력한 여행기간이 정합니다. 여기서는 서술과 사진만 고칩니다.
      </p>
      {days.map((d, i) => (
        <div key={i} className="rounded-lg border border-neutral-200 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold">{d.day}일차</span>
            <span className={`text-xs ${d.text.length > limit ? 'text-red-700' : 'text-neutral-500'}`}>
              {d.text.length} / {limit}
            </span>
          </div>
          <textarea
            value={d.text} rows={3}
            onChange={(e) => patch(i, 'text', e.target.value)}
            className={inputClass}
          />
          {errors[`${section.id}.days.${i}.text`] && (
            <p className="mt-1 text-xs text-red-700">{errors[`${section.id}.days.${i}.text`]}</p>
          )}
          <label className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
            사진
            <select
              value={d.image_slot ?? ''}
              onChange={(e) => patch(i, 'image_slot', e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              <option value="">없음</option>
              {slots.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      ))}
    </div>
  )
}

/* ── 공용 조각 ───────────────────────────────────────────────────── */

const inputClass =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 ' +
  'focus:border-neutral-900 focus:outline-none'

function Field({
  label, error, hint, counter, over, children,
}: {
  label: string
  error?: string
  hint?: string
  counter?: string
  over?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium text-neutral-800">{label}</span>
        {counter && (
          <span className={`text-xs ${over ? 'text-red-700' : 'text-neutral-500'}`}>{counter}</span>
        )}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  )
}

/** 신청 섹션의 요약값 — 바꾸면 고객이 본 가격과 접수된 상품이 어긋난다(§10.2). */
function ReadonlyField({ label, value }: { label: string; value: unknown }) {
  const entries = value && typeof value === 'object'
    ? Object.entries(value as Record<string, unknown>)
    : [[label, value] as [string, unknown]]

  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <p className="text-sm font-medium text-neutral-800">{label}</p>
      <dl className="mt-1 space-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-sm">
            <dt className="w-20 shrink-0 text-neutral-500">{k}</dt>
            <dd className="text-neutral-900">{String(v ?? '')}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-xs text-neutral-500">
        확정 데이터를 그대로 쓰는 값이라 편집할 수 없습니다(§10.2).
      </p>
    </div>
  )
}
