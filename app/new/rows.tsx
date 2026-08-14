'use client'

import { SHOP_KINDS } from '@/lib/types'

/**
 * 배열 그룹(`숙박`·`상점`)의 행 편집 UI (§7.1·§7.4).
 *
 * ## 폼 필드 이름이 `source` 경로다
 *
 * `name="숙박[0].숙소명"` — 검증 오류 키(`form-validation`)·`source` 경로(§8.7)·
 * 폼 필드 이름이 **같은 문자열**이다. 벌을 하나로 두면 오류를 어느 칸에 붙일지
 * 정하는 변환 표가 필요 없어진다. 서버는 이 이름을 정규식으로 묶어 배열로 만든다
 * (`buildFormInput`의 `collectRows`).
 *
 * ## 인덱스는 화면의 행 위치다
 *
 * 가운데 행을 지우면 남은 행이 0..n-1로 다시 번호를 받는다. §7.4가 순서 보존을
 * 요구하므로 **화면 순서 = 배열 순서 = 인덱스**를 항상 같게 유지한다. React `key`는
 * 인덱스가 아니라 행의 고유 번호(`_k`)를 쓴다 — 인덱스를 키로 쓰면 행을 지웠을 때
 * 입력 중인 값이 다른 행으로 옮겨 붙는다.
 */

export interface Row {
  /** React key 전용. 서버에 보내지 않는다 */
  _k: number
  [field: string]: string | number
}

export interface RowSpec {
  /** `숙박` · `상점` — 폼 필드 이름과 오류 키의 접두사 */
  key: '숙박' | '상점'
  /** 사람에게 보이는 단위 이름 */
  unit: string
  fields: { name: string; label: string; hint?: string; kind?: 'text' | 'area' | 'kind' }[]
}

export const STAY_SPEC: RowSpec = {
  key: '숙박',
  unit: '숙소',
  fields: [
    { name: '숙소명', label: '숙소명', hint: '2~60자' },
    { name: '위치', label: '위치', hint: '주소 또는 지역' },
    { name: '객실타입', label: '객실타입 (선택)' },
    { name: '숙박일정', label: '숙박일정 (선택)', hint: '예: 1~2박' },
  ],
}

export const SHOP_SPEC: RowSpec = {
  key: '상점',
  unit: '상점',
  fields: [
    { name: '상점명', label: '상점명', hint: '1~80자' },
    { name: '구분', label: '구분', kind: 'kind' },
    { name: '위치', label: '위치 (선택)', hint: '주소' },
    { name: '상점정보', label: '상점정보 (선택)', kind: 'area' },
  ],
}

export function emptyRow(spec: RowSpec, k: number): Row {
  const row: Row = { _k: k }
  for (const f of spec.fields) row[f.name] = f.kind === 'kind' ? SHOP_KINDS[0] : ''
  return row
}

const inputClass =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none '
  + 'focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900'

export function RowGroup({
  spec, rows, errors, origin, onChange, onAdd, onRemove,
}: {
  spec: RowSpec
  rows: Row[]
  errors: Record<string, string>
  /** 필드 경로 → 초안 출처. 없으면 배지를 안 붙인다 (§7.5 ③) */
  origin: Record<string, string>
  onChange: (i: number, field: string, v: string) => void
  onAdd: () => void
  onRemove: (i: number) => void
}) {
  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={row._k} className="rounded-lg border border-neutral-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-800">
              {spec.unit} {i + 1}
            </span>
            {/* 1행은 지울 수 없다 — 두 그룹 모두 1건 이상이 필수다(§7.4) */}
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="rounded px-2 py-1 text-xs text-neutral-500 transition
                           hover:bg-red-50 hover:text-red-700"
              >
                이 {spec.unit} 삭제
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {spec.fields.map((f) => {
              const path = `${spec.key}[${i}].${f.name}`
              const err = errors[path]
              const v = String(row[f.name] ?? '')

              return (
                <div key={f.name} className="min-w-0 space-y-1.5">
                  <label
                    htmlFor={path}
                    className="flex items-center gap-2 text-sm font-medium text-neutral-800"
                  >
                    {f.label}
                    {origin[path] === 'planned' && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px]
                                       font-medium text-amber-900">AI 초안</span>
                    )}
                  </label>

                  {f.kind === 'kind' ? (
                    <select
                      id={path} name={path} value={v} className={inputClass}
                      onChange={(e) => onChange(i, f.name, e.target.value)}
                    >
                      {SHOP_KINDS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : f.kind === 'area' ? (
                    <textarea
                      id={path} name={path} value={v} rows={2} maxLength={500}
                      className={inputClass}
                      onChange={(e) => onChange(i, f.name, e.target.value)}
                    />
                  ) : (
                    <input
                      id={path} name={path} value={v} className={inputClass}
                      onChange={(e) => onChange(i, f.name, e.target.value)}
                    />
                  )}

                  {f.hint && !err && <p className="text-xs text-neutral-500">{f.hint}</p>}
                  {err && <p className="text-xs text-red-600">{err}</p>}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {errors[spec.key] && <p className="text-xs text-red-600">{errors[spec.key]}</p>}

      <button
        type="button"
        onClick={onAdd}
        className="rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm
                   text-neutral-600 transition hover:border-neutral-900 hover:text-neutral-900"
      >
        + {spec.unit} 추가
      </button>
    </div>
  )
}
