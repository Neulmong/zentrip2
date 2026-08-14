'use client'

import type { PageSection } from '@/lib/pipeline/page'
import type { PageImage } from '@/components/page/types'
import { BLOCK_SPEC, LENGTH_LIMITS_SAVE, type BlockType } from '@/lib/edit-contract'
import { ENRICH_SUMMARY_MAX, type EnrichmentPlace } from '@/lib/pipeline/enrichment'
import { isDining } from '@/components/page/sections'
import { SHOP_KINDS } from '@/lib/types'

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
  /** 이름 → 웹 검색 설명(enrichment.요약). 숙박·상점 행 옆에 인라인으로 편집시킨다 */
  enrichSummaries?: Record<string, string>
  /** 설명 편집 콜백 — enrichment.요약을 이름 단위로 바꾼다 */
  onSummaryChange?: (이름: string, 요약: string) => void
  /** 그라운딩 장소 맵 — 식당·카페 판별(`isDining`)에 쓴다 */
  enrich?: Map<string, EnrichmentPlace>
  /** shop 섹션의 `상점들` — 식사 섹션이 식당·카페 설명을 여기서 골라 편집한다 */
  shopRows?: Record<string, string>[]
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

export function SectionForm({ section, images, errors, onChange, enrichSummaries, onSummaryChange, enrich, shopRows }: SectionFormProps) {
  const set = (key: string, value: unknown) => onChange({ ...section.data, [key]: value })

  const slots = [...new Set(images.map((i) => i.slot))].sort()
  const optional = new Set(
    (BLOCK_SPEC[section.type as BlockType]?.optional) ?? [],
  )
  const isItinerary = section.type === 'itinerary' || section.type === 'timeline'

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

        if (key === '숙소들' || key === '상점들') {
          return (
            <RowsField
              key={key} field={key} section={section} errors={errors}
              onChange={(rows) => set(key, rows)}
              enrichSummaries={enrichSummaries} onSummaryChange={onSummaryChange} enrich={enrich}
            />
          )
        }

        if (READONLY_KEYS.has(key)) {
          return <ReadonlyField key={key} label={key} value={value} />
        }

        if (key === 'image_slot') {
          return (
            <Field key={key} label="대표 사진 슬롯" error={err} hint="업로드된 슬롯 중에서 고릅니다.">
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
              hint="장수와 순서는 업로드 순서가 정합니다.">
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
              hint="편집기에서는 새로 올리지 않고 이미 올라간 사진 중에서 고릅니다.">
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

      {/* 일정 카드 장소 설명 — 일차 서술(DaysField)과 별개로 카드 소개를 편집한다 */}
      {isItinerary && enrichSummaries && onSummaryChange && (
        <ItineraryPlacesEditor
          section={section} enrichSummaries={enrichSummaries} onSummaryChange={onSummaryChange}
        />
      )}

      {/* 식사 섹션 — 식당·카페 카드 설명은 shop의 상점들에서 오므로 여기서 골라 편집시킨다 */}
      {section.type === 'meal' && shopRows && enrichSummaries && onSummaryChange && (
        <DiningDescriptions
          shopRows={shopRows} enrich={enrich}
          enrichSummaries={enrichSummaries} onSummaryChange={onSummaryChange}
        />
      )}
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

/* ── 값 배열 (`숙소들`·`상점들`) ───────────────────────────────────
 * **행의 개수는 편집 대상이 아니다.** `form_input`에서 온 사실이고 검증 4축이
 * 그 행 수를 기준으로 판정했다(§7.4·§11.1). 늘리면 입력에 없는 숙소·상점이
 * 생기고 줄이면 부분 삭제다 — 그래서 [행 추가] 버튼이 없다. 내용을 더하려면
 * 삽입 블록 3종을 쓴다(§10.2). 일정 배열과 정확히 같은 이유다.
 * ────────────────────────────────────────────────────────────────── */

const ROW_UNIT: Record<string, string> = { 숙소들: '숙소', 상점들: '상점' }
/** 그 행의 이름 필드 — enrichment 설명을 이 값으로 찾는다 */
const ROW_NAME_KEY: Record<string, string> = { 숙소들: '숙소명', 상점들: '상점명' }

function RowsField({
  field, section, errors, onChange, enrichSummaries, onSummaryChange, enrich,
}: {
  field: string
  section: PageSection
  errors: Record<string, string>
  onChange: (rows: Record<string, string>[]) => void
  enrichSummaries?: Record<string, string>
  onSummaryChange?: (이름: string, 요약: string) => void
  enrich?: Map<string, EnrichmentPlace>
}) {
  const rows = (Array.isArray(section.data[field])
    ? section.data[field] : []) as Record<string, string>[]
  const unit = ROW_UNIT[field] ?? '항목'
  const nameKey = ROW_NAME_KEY[field]

  const patch = (i: number, key: string, v: string) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, [key]: v } : r)))

  const isDiningRow = (row: Record<string, string>) =>
    field === '상점들' && !!enrich && isDining(row.상점명 ?? '', enrich)

  /** 카드 1장 — 원래 인덱스 `i`로 patch한다(그룹으로 나눠도 인덱스는 보존) */
  const renderRow = (row: Record<string, string>, i: number) => {
    // 카드에 보이는 웹 검색 설명(enrichment.요약) — 이름으로 찾아 인라인 편집시킨다.
    // 식당·카페(dining)는 「식사」 섹션에서 편집하므로 여기서는 리테일만 인라인 설명을 연다.
    const 이름 = nameKey ? row[nameKey] : undefined
    const 설명편집 = !!(onSummaryChange && 이름 && enrichSummaries && 이름 in enrichSummaries && !isDiningRow(row))
    const 설명 = 설명편집 ? (enrichSummaries![이름!] ?? '') : ''
    return (
      <div key={i} className="rounded-lg border border-neutral-200 p-3">
        <p className="mb-2 text-sm font-semibold">{unit} {i + 1}</p>
        <div className="space-y-3">
          {Object.entries(row).map(([k, v]) => {
            const str = typeof v === 'string' ? v : String(v ?? '')
            const err = errors[`${section.id}.${field}.${i}.${k}`]
            return (
              <Field key={k} label={k} error={err}>
                {k === '구분' ? (
                  <select value={str} onChange={(e) => patch(i, k, e.target.value)} className={inputClass}>
                    {SHOP_KINDS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : MULTILINE.has(k) || str.length > 60 ? (
                  <textarea value={str} rows={3} onChange={(e) => patch(i, k, e.target.value)} className={inputClass} />
                ) : (
                  <input type="text" value={str} onChange={(e) => patch(i, k, e.target.value)} className={inputClass} />
                )}
              </Field>
            )
          })}

          {/* 카드에 보이는 설명(웹 검색) — 담당자가 여기서 직접 고친다 */}
          {설명편집 && (
            <SummaryEditor label="설명 (카드에 보이는 소개)" 요약={설명} onChange={(v) => onSummaryChange!(이름!, v)} />
          )}
        </div>
      </div>
    )
  }

  // 상점들은 페이지처럼 식사·맛집 / 제휴·추천 상점으로 나눠 편집기 구조를 페이지와 맞춘다.
  // (한쪽이 0곳이면 나누지 않고 평평하게 — 데모처럼 전부 식당이면 아래 안내만 붙는다)
  const indexed = rows.map((row, i) => [row, i] as const)
  const dining = indexed.filter(([row]) => isDiningRow(row))
  const retail = indexed.filter(([row]) => !isDiningRow(row))
  const grouped = field === '상점들' && dining.length > 0 && retail.length > 0

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        {unit} 개수는 입력한 값이 정합니다. 여기서는 각 {unit}의 내용만 고칩니다.
      </p>

      {grouped ? (
        <>
          <div className="space-y-3">
            <p className="text-sm font-semibold text-neutral-800">
              식사·맛집 <span className="text-xs font-normal text-neutral-500">{dining.length}곳</span>
            </p>
            <p className="text-xs text-neutral-500">
              페이지의 「식사」 섹션 카드입니다. 설명은 <b>「식사」 섹션</b>에서 편집합니다.
            </p>
            {dining.map(([row, i]) => renderRow(row, i))}
          </div>
          <div className="space-y-3 border-t border-neutral-200 pt-4">
            <p className="text-sm font-semibold text-neutral-800">
              제휴·추천 상점 <span className="text-xs font-normal text-neutral-500">{retail.length}곳</span>
            </p>
            {retail.map(([row, i]) => renderRow(row, i))}
          </div>
        </>
      ) : (
        <>
          {dining.length > 0 && field === '상점들' && (
            <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              식당·카페의 설명은 <b>「식사」 섹션</b>에서 편집합니다.
            </p>
          )}
          {indexed.map(([row, i]) => renderRow(row, i))}
        </>
      )}
    </div>
  )
}

/* ── 설명(enrichment.요약) 편집 ─────────────────────────────────────
 * 카드에 보이는 「소개」는 `page_content.enrichment.요약`이다. 숙박·상점 행과
 * 일정 장소 카드 어디에 보이든 **같은 위젯**으로 편집시킨다 — 「설명 칸이 있는
 * 모든 곳에서 편집 가능」(사용자 규칙)을 한 컴포넌트로 보증한다.
 * ────────────────────────────────────────────────────────────────── */

function SummaryEditor({ label, 요약, onChange }: {
  label: string
  요약: string
  onChange: (v: string) => void
}) {
  return (
    <Field label={label} counter={`${요약.length} / ${ENRICH_SUMMARY_MAX}`} over={요약.length > ENRICH_SUMMARY_MAX}>
      <textarea value={요약} rows={4} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </Field>
  )
}

/**
 * 일정 섹션의 장소 설명 — 카루셀 카드에 보이는 여행지·장소 소개를 인라인 편집한다.
 * 일차 서술(`days.text`)은 `DaysField`가, 그 아래 장소 카드 설명은 여기가 맡는다.
 */
function ItineraryPlacesEditor({ section, enrichSummaries, onSummaryChange }: {
  section: PageSection
  enrichSummaries: Record<string, string>
  onSummaryChange: (이름: string, 요약: string) => void
}) {
  const days = (Array.isArray(section.data.days) ? section.data.days : []) as { text?: string }[]
  const texts = days.map((d) => (typeof d.text === 'string' ? d.text : ''))
  // 일정 서술에 등장하는 장소 = 카드에 보이는 장소(렌더러와 같은 규칙: text.includes(이름))
  const names = Object.keys(enrichSummaries).filter((n) => texts.some((t) => t.includes(n)))
  if (names.length === 0) return null
  return (
    <div className="border-t border-neutral-200 pt-5">
      <p className="text-sm font-semibold">일정 장소 설명</p>
      <p className="mb-3 mt-1 text-xs text-neutral-500">
        일정 카드에 보이는 장소 소개입니다. 여기서 바로 고칠 수 있습니다.
      </p>
      <div className="space-y-4">
        {names.map((n) => (
          <SummaryEditor key={n} label={n} 요약={enrichSummaries[n] ?? ''} onChange={(v) => onSummaryChange(n, v)} />
        ))}
      </div>
    </div>
  )
}

/**
 * 식사 섹션의 식당·카페 설명 — 데이터는 shop의 `상점들`에 있지만 페이지는 식당·카페를
 * 「식사」 섹션에 그린다. 그 분리(`isDining`)를 편집기에도 반영해, 담당자가 식사
 * 편집란에서 식당·카페 소개를 고치게 한다(설명은 이름 단위 enrichment라 어디서 고쳐도 같다).
 */
function DiningDescriptions({ shopRows, enrich, enrichSummaries, onSummaryChange }: {
  shopRows: Record<string, string>[]
  enrich?: Map<string, EnrichmentPlace>
  enrichSummaries: Record<string, string>
  onSummaryChange: (이름: string, 요약: string) => void
}) {
  const names = shopRows
    .filter((r) => isDining(r.상점명 ?? '', enrich))
    .map((r) => r.상점명)
    .filter((n) => n && n in enrichSummaries)
  if (names.length === 0) return null
  return (
    <div className="border-t border-neutral-200 pt-5">
      <p className="text-sm font-semibold">식당·카페 설명</p>
      <p className="mb-3 mt-1 text-xs text-neutral-500">
        일정의 식당·카페 카드에 보이는 소개입니다. 여기서 바로 고칠 수 있습니다.
      </p>
      <div className="space-y-4">
        {names.map((n) => (
          <SummaryEditor key={n} label={n} 요약={enrichSummaries[n] ?? ''} onChange={(v) => onSummaryChange(n, v)} />
        ))}
      </div>
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
