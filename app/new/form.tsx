'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TRAVEL_STYLES, CHILD_NOT_OFFERED, tripDays } from '@/lib/form-validation'
import { TRIP_DAYS_MAX, type FormInput } from '@/lib/types'
import { runPipeline, phasesFrom, BROCHURE_PHASES, type Phase } from '@/lib/client/run-pipeline'
import { GenerationProgress } from '@/components/GenerationProgress'
import { slotLabel } from '@/lib/images'
import { FreeformPanel, type DraftNotes } from './freeform-panel'
import { emptyRow, RowGroup, SHOP_SPEC, STAY_SPEC, type Row, type RowSpec } from './rows'

/**
 * spec §7 — 필수 폼 그룹 6개 + 선택 항목 + 슬롯 지정 이미지 업로드.
 *
 * 화면 하나가 **두 경로**를 담당한다(§14.1).
 *
 *   `/new`                    신규 등록  → `POST /api/products` (#1)
 *   `/new?product_id={id}`    입력 재제출 → `PATCH .../form-input` (#17)
 *
 * 둘을 나누지 않는 이유: 필드 구성·검증 규칙이 완전히 같아서 나누면 §7.1 규칙이
 * 두 벌이 되고, 한쪽만 고치는 순간 어긋난다. 다른 것은 **어느 창구로 보내는가**뿐이다.
 *
 * ## 입력이 controlled인 이유 (2.7에서 바뀐 점)
 *
 * 전에는 `defaultValue`를 썼다. 자연어 초안(§7.5)이 **폼 값을 바깥에서 주입**하므로
 * 그 방식으로는 화면이 갱신되지 않는다 — DOM의 기본값을 바꿔도 이미 마운트된
 * 입력은 그대로다. 그래서 스칼라 값은 `values` 상태가, 배열 행은 `stays`·`shops`
 * 상태가 쥔다.
 *
 * **제출은 여전히 DOM의 `FormData`로 한다.** 이미지가 `type="file"`이라 상태로
 * 옮길 수 없고, controlled 입력에도 `name`이 붙어 있으므로 같이 실려 나간다.
 */

const ITINERARY_PLACEHOLDER = `1일: 김해공항 출발, 올레 7코스 걷기, 중식·석식 제공
2일: 성산일출봉, 해녀박물관 관람, 조식·중식 제공
3일: 자유 일정, 조식 제공
4일: 귀국`

type Errors = Record<string, string>

export interface ExistingImage {
  slot: string
  count: number
}

/** 스칼라 폼 필드 — 배열(`숙박`·`상점`)은 `rows.tsx`가 담당한다 */
const SCALARS = [
  '행사명', '여행지', '행사기간_시작', '행사기간_종료', '여행기간_시작', '여행기간_종료',
  '일정원문', '타겟층', '여행스타일', '여행주제', '기획메모',
  '가격_성인', '가격_아동', '가격_기타', '식사정보',
  '항공편_공항', '항공편_항공사', '항공편_편명', '항공편_출발시간', '항공편_도착시간',
] as const

/**
 * 폼 필드 이름 → `form_input` 경로. **오류 키와 `origin` 키가 이 경로다.**
 *
 * 배열은 필드 이름 자체가 경로(`숙박[0].숙소명`)이므로 이 표에 없다.
 */
const PATH: Record<string, string> = {
  행사명: '행사정보.행사명', 여행지: '행사정보.여행지',
  행사기간_시작: '행사정보.행사기간_시작', 행사기간_종료: '행사정보.행사기간_종료',
  여행기간_시작: '행사정보.여행기간_시작', 여행기간_종료: '행사정보.여행기간_종료',
  일정원문: '행사정보.일정원문', 타겟층: '행사정보.타겟층',
  여행스타일: '행사정보.여행스타일', 여행주제: '행사정보.여행주제',
  기획메모: '행사정보.기획메모',
  가격_성인: '가격.성인', 가격_아동: '가격.아동', 가격_기타: '가격.기타',
  식사정보: '식사.식사정보',
  항공편_공항: '항공편.공항', 항공편_항공사: '항공편.항공사', 항공편_편명: '항공편.편명',
  항공편_출발시간: '항공편.출발시간', 항공편_도착시간: '항공편.도착시간',
}

/**
 * 오류 키(`form_input` 경로) → 입력창의 `id`.
 *
 * 배열 행은 `id`가 곧 경로이므로(`rows.tsx` — `id={path}`) 이 표를 거치지 않는다.
 */
const ID_OF: Record<string, string> = Object.fromEntries(
  Object.entries(PATH).map(([id, path]) => [path, id]),
)

/**
 * 오류가 있는 **첫 칸으로 이동하고 커서를 놓는다**(§7.1).
 *
 * 이전 구현은 항상 `scrollTo({ top: 0 })`이었다. 폼이 길어서(필수 6그룹 + 선택 9)
 * 최상단으로 올라가면 **어느 칸이 문제인지 화면에 보이지 않는다** — 오류 문구는
 * 그 칸 옆에 있으므로 사람이 스크롤해서 찾아야 했다.
 *
 * 「첫」의 기준을 오류 객체의 키 순서로 잡지 않는다. 그 순서는 검증기가 만든
 * 순서이고 화면 순서와 무관하다. **화면에서 가장 위에 있는 칸**을 고른다.
 *
 * 폼 전체 오류(`_`)와 이미지 경고는 대응하는 입력창이 없다 — 그 문구는 폼 상단에
 * 뜨므로 최상단으로 올리는 것이 맞다.
 */
function focusFirstError(msg: Errors) {
  const targets = Object.keys(msg)
    .filter((k) => k !== '_' && k !== 'images')
    .map((k) => document.getElementById(ID_OF[k] ?? k))
    .filter((el): el is HTMLElement => el !== null)

  if (targets.length === 0) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }

  const first = targets.reduce((a, b) =>
    a.getBoundingClientRect().top <= b.getBoundingClientRect().top ? a : b)

  first.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // 스크롤은 위에서 이미 시작했으므로 포커스가 다시 튀지 않게 한다
  first.focus({ preventScroll: true })
}

type Values = Record<string, string>

const EMPTY_VALUES: Values = Object.fromEntries(SCALARS.map((k) => [k, '']))

/**
 * `form_input`(중첩·저장 형태) → 폼 필드(평면·입력 형태).
 *
 * 저장 형태와 입력 형태가 다른 지점이 두 곳 있다(§6.2·§7.4).
 *   · 금액은 `{숫자}원`으로 저장된다 → 입력창에는 숫자만 되돌린다
 *   · 아동 미운영은 `해당 없음`으로 저장된다 → 체크박스로 되돌린다
 */
function toValues(fi: FormInput): Values {
  const num = (v: string) => v.replace(/원$/, '')
  return {
    행사명: fi.행사정보.행사명,
    여행지: fi.행사정보.여행지,
    행사기간_시작: fi.행사정보.행사기간_시작,
    행사기간_종료: fi.행사정보.행사기간_종료,
    여행기간_시작: fi.행사정보.여행기간_시작,
    여행기간_종료: fi.행사정보.여행기간_종료,
    일정원문: fi.행사정보.일정원문,
    타겟층: fi.행사정보.타겟층,
    여행스타일: fi.행사정보.여행스타일,
    여행주제: fi.행사정보.여행주제,
    기획메모: fi.행사정보.기획메모,
    가격_성인: num(fi.가격.성인),
    가격_아동: fi.가격.아동 === CHILD_NOT_OFFERED ? '' : num(fi.가격.아동),
    가격_기타: fi.가격.기타,
    식사정보: fi.식사.식사정보,
    항공편_공항: fi.항공편.공항,
    항공편_항공사: fi.항공편.항공사,
    항공편_편명: fi.항공편.편명,
    항공편_출발시간: fi.항공편.출발시간,
    항공편_도착시간: fi.항공편.도착시간,
  }
}

/**
 * `form_input`의 배열 → 행 상태. 비어 있으면 빈 행 1개로 시작한다(§7.4 1건 이상).
 *
 * `Stay`·`Shop`을 그대로 받지 않고 인덱스 접근으로 읽는 이유: 두 타입은 필드가
 * 명시된 인터페이스라 `Record<string, string>`에 대입되지 않는다. 여기서 필요한
 * 것은 「`spec.fields`에 적힌 이름으로 값을 꺼내는 것」이므로 읽기 시점에만 넓힌다.
 */
function toRows(
  spec: RowSpec, list: readonly object[] | undefined, from: number,
): Row[] {
  /*
   * 2.6에 저장된 값은 배열이 아니라 **단일 객체**다(§7.4). `loadProduct`가
   * 읽는 시점에 올려 주지만(`coerceFormInput`), 여기서도 막아 둔다 — 이 함수는
   * 초안 응답(`draft.숙박`)도 받고, 그 경로는 `loadProduct`를 거치지 않는다.
   */
  const rows = Array.isArray(list) ? list : list ? [list] : []
  if (!rows.length) return [emptyRow(spec, from)]
  return rows.map((src, i) => {
    const bag = src as Record<string, unknown>
    const row = emptyRow(spec, from + i)
    for (const f of spec.fields) {
      const v = bag[f.name]
      if (typeof v === 'string') row[f.name] = v
    }
    return row
  })
}

function Field({
  name, label, error, hint, origin, children,
}: {
  name: string
  label: string
  error?: string
  hint?: string
  /** 초안 출처 (§7.5 ③). `planned`면 배지를 붙인다 */
  origin?: string
  children: React.ReactNode
}) {
  return (
    /*
     * `min-w-0` — 격자 자식의 기본값은 `min-width: auto`라 **내용의 최소 폭보다
     * 좁아지지 않는다.** `type="file"` 입력은 버튼 + 파일명이라 최소 폭이 크고,
     * 375px에서 이 칸이 버티면 페이지 전체가 가로로 밀린다(§17.1 「페이지 본문은
     * 가로 스크롤이 발생하지 않는다」).
     */
    <div className="min-w-0 space-y-1.5">
      <label
        htmlFor={name}
        className="flex items-center gap-2 text-sm font-medium text-neutral-800"
      >
        {label}
        {origin === 'planned' && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium
                           text-amber-900">AI 초안</span>
        )}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-neutral-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none '
  + 'focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900'

/** 타겟층 빠른 선택지 — 흔한 동행자 구성. 값은 사람이 고른 실제 문자열이 된다 */
const TARGET_PRESETS = [
  '20대 친구', '30~40대 부부', '가족 (아이 동반)', '시니어 부부', '나홀로 여행', '동호회·단체',
] as const

/**
 * 값을 채우는 칩 줄 (Task 1 — 선택형 UI). AI가 값을 만드는 것이 아니라 **사람이
 * 클릭으로 고르는** 보조 입력이다 — 사실값은 여전히 사람이 정하고 자유 수정된다.
 * 현재 값과 같은 칩이면 눌러서 해제한다.
 */
function ChipRow({
  presets, value, onPick,
}: {
  presets: readonly string[]
  value: string
  onPick: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((p) => {
        const active = value.trim() === p
        return (
          <button
            key={p} type="button"
            onClick={() => onPick(active ? '' : p)}
            aria-pressed={active}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              active
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-300 text-neutral-600 hover:border-neutral-500 hover:bg-neutral-50'}`}
          >
            {p}
          </button>
        )
      })}
    </div>
  )
}

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

export function ProductForm({
  productId, initial, failureReason, existing = [], updatedAt,
}: {
  /** 있으면 재제출 모드 (§14.4 #17) */
  productId?: string
  initial?: FormInput
  /** §16.1.1 — 재제출(#17)이 보낼 조회 시점 */
  updatedAt?: string
  /** `input_error`의 중단 사유. 폼 상단에 그대로 보여준다(§14.1) */
  failureReason?: string | null
  /** 이미 올라간 사진 — 교체하지 않으면 그대로 유지된다 */
  existing?: ExistingImage[]
}) {
  const router = useRouter()
  const resubmit = Boolean(productId)

  const [values, setValues] = useState<Values>(
    () => (initial ? toValues(initial) : EMPTY_VALUES),
  )
  const [stays, setStays] = useState<Row[]>(() => toRows(STAY_SPEC, initial?.숙박, 0))
  const [shops, setShops] = useState<Row[]>(() => toRows(SHOP_SPEC, initial?.상점, 1000))
  const [nextKey, setNextKey] = useState(2000)

  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  /** 소개서 파이프라인이 도는 동안만 채워진다 — 스켈레톤 오버레이가 뜬다 */
  const [genPhases, setGenPhases] = useState<Phase[] | null>(null)
  const [origin, setOrigin] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<DraftNotes | null>(null)
  const [childNotOffered, setChildNotOffered] = useState(
    initial?.가격.아동 === CHILD_NOT_OFFERED,
  )

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }))

  /** 여행기간 입력 후 일차 수만큼 슬롯을 자동 생성한다(§7.3). */
  const days = useMemo(() => {
    const { 여행기간_시작: s, 여행기간_종료: e } = values
    const d = s && e ? tripDays(s, e) : null
    return d !== null && d >= 1 && d <= TRIP_DAYS_MAX ? d : 0
  }, [values])

  function stop(msg: Errors) {
    setErrors(msg)
    setProgress(null)
    setGenPhases(null)
    setBusy(false)
    focusFirstError(msg)
  }

  /* ── §7.5 자연어 초안 — 폼을 채운다. 확정하지 않는다 ──────────── */
  async function fillFromText(text: string) {
    setDrafting(true)
    setErrors({})
    try {
      const res = await fetch('/api/plan-draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          // 연도를 못 읽었을 때 사람이 고른 날짜를 함께 보낸다(§7.5)
          여행기간_시작: values.여행기간_시작,
          여행기간_종료: values.여행기간_종료,
        }),
      })
      const body = await res.json().catch(() => ({}))

      if (res.status === 409) {
        throw new Error('초안 생성이 실패했습니다. [다시 채우기]를 눌러 주세요.')
      }
      if (!res.ok) {
        throw new Error(body.field_errors?.text ?? '초안을 만들지 못했습니다.')
      }

      const draft = body.draft as FormInput
      /*
       * 사람이 이미 채운 칸은 덮어쓰지 않는다 — 초안을 두 번 돌릴 때
       * 손으로 고친 값이 사라지면 [다시 채우기]를 누를 수 없게 된다.
       * 단 재제출 모드에서는 초안 패널을 쓰지 않는다(이미 값이 있다).
       */
      const 초안값 = toValues(draft)
      setValues((prev) => {
        const next = { ...prev }
        for (const k of SCALARS) {
          if (!next[k]?.trim() && 초안값[k]) next[k] = 초안값[k]
        }
        return next
      })

      // 배열은 통째로 교체한다. 행 단위 병합은 어느 행이 짝인지 정할 근거가 없다
      setStays(toRows(STAY_SPEC, draft.숙박, nextKey))
      setShops(toRows(SHOP_SPEC, draft.상점, nextKey + 500))
      setNextKey((k) => k + 1000)

      setOrigin(body.origin ?? {})
      setNotes(body.notes ?? null)
      // 초안이 채우지 못한 필수 칸을 미리 보여준다 — 제출을 막을 칸이 그것들이다
      setErrors(body.notes?.필수미입력 ?? {})
    } finally {
      setDrafting(false)
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    setProgress('저장 중…')

    const fd = new FormData(e.currentTarget)
    if (childNotOffered) fd.set('가격_아동', CHILD_NOT_OFFERED)
    // §16.1.1 — 재제출은 form_input을 통째로 교체한다. 낡은 화면에서 보내면
    // 다른 사람이 고친 입력을 덮어쓰므로 조회 시점을 함께 싣는다.
    if (resubmit && updatedAt) fd.set('updated_at', updatedAt)

    /*
     * ① 신규는 등록(#1), 재제출은 교체(#17). 둘 다 AI 0회이며
     *    검증 위반이면 400을 돌려주고 행을 만들거나 바꾸지 않는다.
     */
    const res = resubmit
      ? await fetch(`/api/products/${productId}/form-input`, { method: 'PATCH', body: fd })
      : await fetch('/api/products', { method: 'POST', body: fd })
    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      if (res.status === 409) {
        stop({ _: body.reason === 'stale'
          ? '다른 곳에서 이 상품이 변경됐습니다. 새로고침 후 다시 시도해 주세요.'
          : '지금은 입력을 교체할 수 없는 상태입니다. 목록에서 현재 상태를 확인해 주세요.' })
        return
      }
      stop(body.field_errors ?? { _: '저장에 실패했습니다.' })
      return
    }

    const id: string = productId ?? body.product_id

    // 이미지 교체만 실패한 경우 — 폼 교체는 확정됐으므로 진행하되 알린다
    if (body.image_warning) setErrors({ images: body.image_warning })

    /*
     * ②③④ 일차 분해 → 소개서 → 1차 검증 (§8.5). 각 요청이 AI를 1회씩 쓴다.
     * 재제출의 시작점도 ②지만, 서버가 준 값을 그대로 쓴다 — 클라이언트가 추측하지 않는다.
     */
    const phases = body.restart_from ? phasesFrom(body.restart_from) : BROCHURE_PHASES
    setGenPhases(phases)
    const outcome = await runPipeline(id, phases, (label, attempt) => {
      setProgress(attempt > 0 ? `${label} (재시도 ${attempt}회)` : label)
    })
    setGenPhases(null)

    if (outcome.kind === 'input_error') {
      // 입력 문제 — 폼 값을 유지한 채 사유를 표시한다(§14.1 · §15.1)
      if (!resubmit) { router.replace(`/new?product_id=${id}`); return }
      stop({ _: outcome.failure_reason })
      return
    }
    if (outcome.kind === 'error') { stop({ _: outcome.message }); return }

    // 축이 fail로 굳어도 소개서 자체는 만들어져 있다. 검토 화면에서 실패 항목과
    // [다시 생성]·[입력 수정]을 보여준다(§15.1) — "완료"라고 말하지 않는다.
    setProgress(outcome.kind === 'axis_failed'
      ? '검사에서 문제가 발견됐습니다. 검토 화면으로 이동합니다…'
      : '완료. 소개서 검토 화면으로 이동합니다…')
    router.push(`/admin/products/${id}`)
  }

  const err = (k: string) => errors[PATH[k] ?? k]
  const org = (k: string) => origin[PATH[k] ?? k]

  const patchRow = (
    setter: React.Dispatch<React.SetStateAction<Row[]>>,
  ) => (i: number, field: string, v: string) =>
    setter((prev) => prev.map((r, n) => (n === i ? { ...r, [field]: v } : r)))

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {genPhases && (
        <GenerationProgress
          phases={genPhases}
          progress={progress}
          variant="document"
          title="소개서를 작성하고 있습니다"
        />
      )}

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {resubmit ? '입력 수정 후 재제출' : '새 상품 등록'}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {resubmit
            ? '이전 입력이 채워져 있습니다. 문제가 된 부분만 고쳐 다시 제출해 주세요.'
            : '입력한 값은 그대로 소개서와 상품 페이지에 반영됩니다. AI가 값을 바꾸지 않습니다.'}
        </p>
      </header>

      {/* 중단 사유는 폼 상단에 그대로 보여준다 (§14.1 · §15.1) */}
      {failureReason && (
        <div role="alert" className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">이 입력으로는 진행할 수 없었습니다</p>
          <p className="mt-1 leading-relaxed">{failureReason}</p>
        </div>
      )}

      {errors._ && (
        <p role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {errors._}
        </p>
      )}

      {/*
        §7.5 — 자연어 초안. **신규 등록에서만 보인다.**
        재제출은 이미 확정된 입력을 고치는 화면이고(§14.4 #17), 거기서 초안을
        돌리면 사람이 승인한 값 위에 AI 산출물이 덮인다.
      */}
      {!resubmit && (
        <FreeformPanel busy={drafting} notes={notes} onFill={fillFromText} />
      )}

      <form onSubmit={submit} className="space-y-5">
        <Group title="행사정보" required>
          <Field name="행사명" label="행사명" error={err('행사명')} hint="2~40자"
            origin={org('행사명')}>
            <input id="행사명" name="행사명" className={inputClass} maxLength={40}
              value={values.행사명} onChange={(e) => set('행사명', e.target.value)}
              placeholder="제주 올레 바람 여행" />
          </Field>
          <Field name="여행지" label="여행지" error={err('여행지')} hint="2~60자"
            origin={org('여행지')}>
            <input id="여행지" name="여행지" className={inputClass} maxLength={60}
              value={values.여행지} onChange={(e) => set('여행지', e.target.value)}
              placeholder="제주" />
          </Field>
          {/*
            행사 기간은 **선택** — 축제·행사 자체의 날짜다. 실제 여행 날짜(아래 「여행
            기간」)와 다를 수 있다. 비우면 페이지에 나오지 않는다. 한쪽만 채우면 400.
          */}
          <div className="grid grid-cols-2 gap-3">
            <Field name="행사기간_시작" label="행사 시작일 (선택)" error={err('행사기간_시작')}
              origin={org('행사기간_시작')}>
              <input id="행사기간_시작" name="행사기간_시작" type="date" className={inputClass}
                value={values.행사기간_시작}
                onChange={(e) => set('행사기간_시작', e.target.value)} />
            </Field>
            <Field name="행사기간_종료" label="행사 종료일 (선택)" error={err('행사기간_종료')}
              origin={org('행사기간_종료')}
              hint="행사·축제 자체의 기간. 여행 날짜와 다르면 여기에, 같거나 없으면 비웁니다">
              <input id="행사기간_종료" name="행사기간_종료" type="date" className={inputClass}
                value={values.행사기간_종료}
                onChange={(e) => set('행사기간_종료', e.target.value)} />
            </Field>
          </div>
        </Group>

        {/*
          여행 기간 — 실제로 여행 가는 날짜다. **이 값이 일차 수·이미지 슬롯·일정을
          결정한다**(§6.2.1). 행사 기간과 분리해 별도 그룹으로 둔다.
        */}
        <Group title="여행 기간" required>
          <div className="grid grid-cols-2 gap-3">
            <Field name="여행기간_시작" label="시작일" error={err('여행기간_시작')}
              origin={org('여행기간_시작')}>
              <input id="여행기간_시작" name="여행기간_시작" type="date" className={inputClass}
                value={values.여행기간_시작}
                onChange={(e) => set('여행기간_시작', e.target.value)} />
            </Field>
            <Field name="여행기간_종료" label="종료일" error={err('여행기간_종료')}
              origin={org('여행기간_종료')}
              hint={days ? `${days}일 (최대 ${TRIP_DAYS_MAX}일)` : `최대 ${TRIP_DAYS_MAX}일`}>
              <input id="여행기간_종료" name="여행기간_종료" type="date" className={inputClass}
                value={values.여행기간_종료}
                onChange={(e) => set('여행기간_종료', e.target.value)} />
            </Field>
          </div>
        </Group>

        <Group title="일정" required>
          <Field name="일정원문" label="일정 원문" error={err('일정원문')} origin={org('일정원문')}
            hint="20~2000자. 일차 구분을 넣어 주세요 — '1일:', '2일차', 'Day 1', '첫째 날' 형식을 인식합니다.">
            <textarea id="일정원문" name="일정원문" rows={7} maxLength={2000}
              className={`${inputClass} font-mono text-[13px] leading-relaxed`}
              value={values.일정원문} onChange={(e) => set('일정원문', e.target.value)}
              placeholder={ITINERARY_PLACEHOLDER} />
          </Field>
        </Group>

        {/*
          숙박·상점은 **행이 여러 건**이다(§7.4). 숙소를 옮겨 다니는 일정과
          카페·음식점 목록이 단일 객체에 담기지 않는다.
        */}
        <Group title="숙박" required>
          <RowGroup
            spec={STAY_SPEC} rows={stays} errors={errors} origin={origin}
            onChange={patchRow(setStays)}
            onAdd={() => {
              setStays((prev) => [...prev, emptyRow(STAY_SPEC, nextKey)])
              setNextKey((k) => k + 1)
            }}
            onRemove={(i) => setStays((prev) => prev.filter((_, n) => n !== i))}
          />
        </Group>

        <Group title="제휴·추천 상점" required>
          <p className="text-xs text-neutral-500">
            구분이 <strong>제휴</strong>인 상점만 제휴 관계가 있는 곳입니다.
            AI 초안은 항상 <strong>추천</strong>으로 넣으며, 제휴로 올리는 것은 사람만 합니다.
          </p>
          <RowGroup
            spec={SHOP_SPEC} rows={shops} errors={errors} origin={origin}
            onChange={patchRow(setShops)}
            onAdd={() => {
              setShops((prev) => [...prev, emptyRow(SHOP_SPEC, nextKey)])
              setNextKey((k) => k + 1)
            }}
            onRemove={(i) => setShops((prev) => prev.filter((_, n) => n !== i))}
          />
        </Group>

        <Group title="가격" required>
          {/* 초안은 금액을 만들지 않는다(§7.5 ③) — 사람이 반드시 이 칸을 본다 */}
          {notes && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              금액은 AI가 채우지 않습니다. 공개 페이지와 신청 이메일에 그대로 실리는 값이라
              직접 입력해 주세요.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field name="가격_성인" label="성인" error={err('가격_성인')}>
              <div className="flex items-center gap-2">
                <input id="가격_성인" name="가격_성인" inputMode="numeric" pattern="[0-9]*"
                  className={inputClass} value={values.가격_성인}
                  onChange={(e) => set('가격_성인', e.target.value)} placeholder="120000" />
                <span className="shrink-0 text-sm text-neutral-500">원</span>
              </div>
            </Field>
            <Field name="가격_아동" label="아동" error={err('가격_아동')}>
              <div className="flex items-center gap-2">
                <input id="가격_아동" name="가격_아동" inputMode="numeric" pattern="[0-9]*"
                  className={inputClass} disabled={childNotOffered} value={values.가격_아동}
                  onChange={(e) => set('가격_아동', e.target.value)}
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
          <Field name="가격_기타" label="기타 (포함/불포함 사항)" error={err('가격_기타')} hint="0~300자">
            <textarea id="가격_기타" name="가격_기타" rows={2} maxLength={300} className={inputClass}
              value={values.가격_기타} onChange={(e) => set('가격_기타', e.target.value)}
              placeholder="항공료 별도" />
          </Field>
        </Group>

        <Group title="식사" required>
          <Field name="식사정보" label="식사정보" error={err('식사정보')} hint="1~500자"
            origin={org('식사정보')}>
            <textarea id="식사정보" name="식사정보" rows={3} maxLength={500} className={inputClass}
              value={values.식사정보} onChange={(e) => set('식사정보', e.target.value)}
              placeholder="조식 3회, 중식 2회, 석식 1회" />
          </Field>
        </Group>

        <Group title="추가 정보">
          <div className="grid grid-cols-2 gap-3">
            <Field name="타겟층" label="타겟층" origin={org('타겟층')}
              hint="자주 쓰는 구성을 눌러 채우거나 직접 입력합니다">
              <input id="타겟층" name="타겟층" className={inputClass} maxLength={100}
                value={values.타겟층} onChange={(e) => set('타겟층', e.target.value)}
                placeholder="30~40대 부부" />
              <div className="mt-2">
                <ChipRow presets={TARGET_PRESETS} value={values.타겟층}
                  onPick={(v) => set('타겟층', v)} />
              </div>
            </Field>
            <Field name="여행스타일" label="여행스타일" origin={org('여행스타일')}
              hint="페이지 색상 테마만 결정합니다. 문구는 바뀌지 않습니다">
              <select id="여행스타일" name="여행스타일" className={inputClass}
                value={values.여행스타일} onChange={(e) => set('여행스타일', e.target.value)}>
                <option value="">선택 안 함</option>
                {TRAVEL_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          {/*
            여행스타일이 6종 단일 선택이라 「걷기 + 맛집 + 휴식」처럼 복합 주제를
            담을 수 없다. 테마는 위 select가 정하고, 주제 문구는 이 칸이 담는다.
          */}
          <Field name="여행주제" label="여행주제" origin={org('여행주제')}
            hint="상품의 주제를 자유롭게 적습니다. 개요·요약 섹션에 표시됩니다 (최대 200자)">
            <input id="여행주제" name="여행주제" className={inputClass} maxLength={200}
              value={values.여행주제} onChange={(e) => set('여행주제', e.target.value)}
              placeholder="제주 걷기와 로컬 맛집·카페에서의 휴식" />
          </Field>
          <fieldset className="grid grid-cols-2 gap-3 rounded-lg bg-neutral-50 p-3">
            <legend className="px-1 text-xs font-medium text-neutral-600">항공편</legend>
            {[['항공편_공항', '공항', '김해공항'], ['항공편_항공사', '항공사', '대한항공'],
              ['항공편_편명', '편명', 'KE1234'], ['항공편_출발시간', '출발시간', '09:00'],
              ['항공편_도착시간', '도착시간', '10:10']].map(([n, l, ph]) => (
              <Field key={n} name={n} label={l} origin={org(n)}>
                <input id={n} name={n} className={inputClass}
                  value={values[n] ?? ''} onChange={(e) => set(n, e.target.value)}
                  placeholder={ph} />
              </Field>
            ))}
          </fieldset>
          <p className="text-xs text-neutral-500">
            비워두면 소개서·상품 페이지에 <strong>추후 추가 예정</strong>으로 표기되며,
            해당 섹션은 삭제되지 않습니다.
          </p>
        </Group>

        {/*
          기획 메모 — 고객에게 표시되지 않는 유일한 입력이다. 다른 칸과 섞어 두면
          「이것도 페이지에 나오나?」를 매번 헷갈리므로 **별도 그룹으로 분리**하고
          미노출임을 라벨·안내문 양쪽에 적는다.
        */}
        <section className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-neutral-900">
            기획 메모
            <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
              선택
            </span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
              고객에게 표시되지 않음
            </span>
          </h2>
          <p className="mb-4 text-xs text-neutral-600">
            페르소나·기획 의도처럼 <strong>어떤 어조로 쓸지</strong>를 정하는 재료입니다.
            소개서와 상품 페이지 어디에도 나오지 않으며, AI가 문장의 결을 잡는 데만 참고합니다.
            여기 적은 나이·인원·가격은 <strong>사실정보로 쓰이지 않습니다.</strong>
          </p>
          <Field name="기획메모" label="메모" origin={org('기획메모')}
            hint="최대 1000자. 예: 30대 초반 여성 2인, 회사 스트레스 해소와 재충전이 목적">
            <textarea id="기획메모" name="기획메모" rows={5} maxLength={1000}
              className={inputClass} value={values.기획메모}
              onChange={(e) => set('기획메모', e.target.value)}
              placeholder={'금융권 동기생 두 명이 함께 가는 여행.\n'
                + '혼자서는 부담되는 걷기 축제를 같이 즐기고,\n'
                + '맛집과 카페에서 재충전하고 싶어한다.'} />
          </Field>
        </section>

        <Group title="이미지">
          {errors.images && <p className="text-xs text-red-600">{errors.images}</p>}

          {/* 재제출에서 **고른 슬롯만** 교체된다 — 나머지는 다시 올리지 않아도 된다(§14.4 #17) */}
          {resubmit && (
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              {existing.length > 0
                ? <>현재 등록된 사진: {existing.map((e) => `${slotLabel(e.slot)} ${e.count}장`).join(' · ')}.{' '}
                    <strong>새로 고른 슬롯만 교체</strong>되고 나머지는 그대로 유지됩니다.</>
                : '등록된 사진이 없습니다.'}
            </p>
          )}

          {/* 375px에서는 1열로 내린다 — 파일 입력 2개를 나란히 둘 폭이 없다 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field name="image:hero" label="대표 이미지 (0~1장)">
              <input id="image:hero" name="image:hero" type="file"
                accept="image/jpeg,image/png,image/webp" className="w-full min-w-0 text-xs" />
            </Field>
            <Field name="image:accommodation" label="숙소 사진 (0~3장)">
              <input id="image:accommodation" name="image:accommodation" type="file" multiple
                accept="image/jpeg,image/png,image/webp" className="w-full min-w-0 text-xs" />
            </Field>
            <Field name="image:shop" label="제휴상점 사진 (0~2장)">
              <input id="image:shop" name="image:shop" type="file" multiple
                accept="image/jpeg,image/png,image/webp" className="w-full min-w-0 text-xs" />
            </Field>
          </div>

          {days > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-neutral-700">일차별 사진 (각 0~1장)</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {Array.from({ length: days }, (_, i) => i + 1).map((n) => (
                  <Field key={n} name={`image:itinerary_day_${n}`} label={`${n}일차`}>
                    <input id={`image:itinerary_day_${n}`} name={`image:itinerary_day_${n}`}
                      type="file" accept="image/jpeg,image/png,image/webp"
                      className="w-full min-w-0 text-xs" />
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
            {busy ? '처리 중…' : resubmit ? '수정 후 재제출' : '소개서 생성'}
          </button>
          {progress && <span className="text-sm text-neutral-600">{progress}</span>}
        </div>
      </form>
    </main>
  )
}
