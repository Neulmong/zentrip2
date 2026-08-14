/**
 * 편집 계약 (§10.2·§10.3·§17.1) — **순수 모듈**.
 *
 * DB·환경변수·네트워크를 건드리지 않는다. 편집기 화면(클라이언트)과 저장
 * 라우트(서버)가 **같은 규칙을 공유**해야 하기 때문이다 — 화면에서 막은 것과
 * 서버에서 거부하는 것이 갈라지면, 화면이 허용한 입력이 저장에서 400으로
 * 튕기거나 그 반대가 된다.
 *
 * 서버는 화면을 신뢰하지 않는다. 여기 있는 검사는 **저장 경로에서 반드시 다시**
 * 돌린다 — 클라이언트 검사는 사용자 편의이고, 규정을 강제하는 것은 서버다.
 */
import { type PageContent, type PageSection } from './pipeline/page'
import { ENRICH_SUMMARY_MAX, type Enrichment, type EnrichmentPlace } from './pipeline/enrichment'
import { VOCABULARY, isItineraryType, type BlockType as VocabType } from './pipeline/vocabulary'

/* ════════════════════════════════════════════════════════════════
 * 콘텐츠 길이 계약 (§17.1) — **편집 저장 시 6종**
 *
 * 생성 시(§9.5 ①)는 4종이다. `free_text`·`notice`는 편집기에서 사람이 끼워
 * 넣는 블록이라 생성 시점에 존재하지 않는다. 강제 시점이 다른 것이지 상한이
 * 다른 게 아니므로, 앞 4종의 값은 `LENGTH_LIMITS_GENERATE`와 같아야 한다.
 * ════════════════════════════════════════════════════════════════ */

export const LENGTH_LIMITS_SAVE = {
  'hero.headline': 40,
  'hero.subcopy': 80,
  '일차별 서술': 200,
  '섹션 제목': 30,
  'free_text 블록': 500,
  'notice 블록': 300,
} as const

/* ════════════════════════════════════════════════════════════════
 * 삽입 블록 3종 (§10.2)
 * ════════════════════════════════════════════════════════════════ */

export const BLOCK_TYPES = ['free_text', 'image', 'notice'] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

export const BLOCK_PREFIX = 'blk_'

/**
 * `data` 키와 `source` (§10.2 삽입 블록 스키마 표).
 *
 * `image` 블록에 `source`가 없는 이유: 사실정보가 아니라 이미지 참조다.
 * §9.3도 같은 이유로 `image_slot`·`image_slots`에 `source`를 붙이지 않는다.
 */
export const BLOCK_SPEC: Record<BlockType, {
  required: string[]
  optional: string[]
  /** 전 필드 공통 `source` 값. `null`이면 `source`를 붙이지 않는다 */
  source: 'generated' | null
  label: string
}> = {
  free_text: { required: ['본문'], optional: ['제목'], source: 'generated', label: '자유 문단' },
  image: { required: ['image_id'], optional: ['캡션'], source: null, label: '사진' },
  notice: { required: ['본문'], optional: [], source: 'generated', label: '안내' },
}

/** 새 블록의 빈 껍데기. 화면과 서버가 같은 모양을 만든다. */
export function emptyBlock(type: BlockType, id: string): PageSection {
  const data: Record<string, unknown> = {}
  for (const k of BLOCK_SPEC[type].required) data[k] = ''
  const source: Record<string, string> = {}
  if (BLOCK_SPEC[type].source) {
    for (const k of [...BLOCK_SPEC[type].required, ...BLOCK_SPEC[type].optional]) {
      source[k] = BLOCK_SPEC[type].source as string
    }
  }
  // order는 저장 시 다시 매긴다(§10.2). 여기서는 자리만 잡는다.
  return { id, type, order: 0, visible: true, locked: false, data, source }
}

export function isBlock(s: PageSection): boolean {
  return s.id.startsWith(BLOCK_PREFIX)
}

/* ════════════════════════════════════════════════════════════════
 * 생성된 집합의 불변 부분 (spec 2.8 §10.2 · 명령서 ⑤)
 *
 * 2.7은 고정 9종(`PAGE_SECTION_IDS`)을 불변으로 잡았다. 2.8은 구성이 자유로워져
 * 「고정 9종」이 없다 — 대신 **그 상품이 생성한 집합**(저장 직전 DB의 non-insert
 * 섹션)이 불변이다. 사람이 바꿀 수 있는 것은 `data` 값·`visible`·`order`뿐이고,
 * `id`·`type`·`locked`·`source`·`data`의 **키 구성**은 생성 시점이 단일 출처다.
 *
 * 삽입 블록(`blk_`)은 이 집합에 없다 — 편집기가 통째로 걷어낼 수 있다(§10.2).
 * ════════════════════════════════════════════════════════════════ */

function baseIdsOf(before: PageContent): Set<string> {
  return new Set(before.sections.filter((s) => !s.id.startsWith(BLOCK_PREFIX)).map((s) => s.id))
}

/**
 * `apply` 예외 (§10.2) — **안내 문구·제목만** 편집할 수 있다.
 *
 * `가격요약`·`행사정보요약`은 `가격.*`·`행사정보.*`를 그대로 승계한 사실정보다.
 * 신청 폼 옆에 붙는 요약값이라 여기서 바뀌면 고객이 본 가격과 접수된 상품의
 * 가격이 어긋난다. 신청 폼의 **필드 구성**은 애초에 `data`에 없다(§9.3·§13.1).
 */
const APPLY_EDITABLE = new Set(['제목', '안내문구'])

/* ════════════════════════════════════════════════════════════════
 * 검증
 * ════════════════════════════════════════════════════════════════ */

export interface EditContext {
  /** 저장 직전 DB의 값. 불변 항목의 기준이다 */
  before: PageContent
  /** 업로드된 `product_images.id` — `image` 블록의 참조 대상(§10.2) */
  imageIds: Set<string>
  /** 업로드된 슬롯 이름 — `image_slot`·`image_slots`의 참조 대상(§9.3) */
  slots: Set<string>
}

/** 키는 화면이 어느 입력칸에 붙일지 알 수 있도록 `섹션id.필드` 형태로 만든다. */
export type FieldErrors = Record<string, string>

export interface EditResult {
  errors: FieldErrors
  /** 오류가 없을 때만 채워진다. `order`가 다시 매겨진 최종 값이다 */
  content?: PageContent
}

/**
 * 편집 결과를 검사하고 저장할 값을 만든다.
 *
 * 순서: 껍데기 → 불변 항목 → 섹션별 규칙 → 이미지 참조 → 길이 → `order` 재부여.
 * 길이를 마지막에 두는 이유는, 구조가 깨진 값에 길이를 재봐야 의미가 없어서다.
 */
export function validateEdit(input: unknown, ctx: EditContext): EditResult {
  const errors: FieldErrors = {}
  const fail = (k: string, m: string) => { if (!(k in errors)) errors[k] = m }

  /* ── 껍데기 ─────────────────────────────────────────────────── */
  if (!input || typeof input !== 'object') return { errors: { _: '본문이 비어 있습니다.' } }
  const next = input as Partial<PageContent>
  if (!Array.isArray(next.sections)) return { errors: { _: 'sections 배열이 없습니다.' } }

  /* ── 편집으로 바뀌지 않는 것 (§9.4 테마 변경 불가) ────────────
   * 2.8에서 `theme`은 객체다 — `!==`는 참조 비교라 클라이언트가 같은 값을 다시
   * 직렬화하기만 해도 위반이 된다. 값 비교(`same`)로 바꾼다. */
  if (!same(next.theme, ctx.before.theme)) {
    fail('theme', '테마는 편집기에서 변경할 수 없습니다(§9.4).')
  }
  if (next.schema_version !== ctx.before.schema_version) {
    fail('schema_version', 'schema_version은 변경할 수 없습니다.')
  }

  const baseIds = baseIdsOf(ctx.before)
  const beforeById = new Map(ctx.before.sections.map((s) => [s.id, s]))
  const seen = new Set<string>()
  const sections: PageSection[] = []

  for (const raw of next.sections) {
    const s = raw as Partial<PageSection>
    const id = typeof s.id === 'string' ? s.id : ''
    if (!id) { fail('_', 'id가 없는 섹션이 있습니다.'); continue }
    if (seen.has(id)) { fail(id, `섹션 id가 중복됩니다: ${id}`); continue }
    seen.add(id)

    if (typeof s.type !== 'string' || !s.data || typeof s.data !== 'object') {
      fail(id, '섹션의 모양이 올바르지 않습니다.')
      continue
    }

    const prev = beforeById.get(id)
    const data = s.data as Record<string, unknown>
    const visible = s.visible !== false

    if (prev && baseIds.has(id)) {
      checkBaseSection(id, prev, s, data, visible, fail)
      sections.push({
        ...prev, visible, order: numberOr(s.order, prev.order), data,
      })
      continue
    }

    if (!id.startsWith(BLOCK_PREFIX)) {
      // 기본 9종도 아니고 삽입 블록도 아닌 것 — §9.3·§10.2 어디에도 없는 섹션이다
      fail(id, `알 수 없는 섹션입니다: ${id}`)
      continue
    }

    checkBlock(id, s, data, fail)
    sections.push({
      id, type: String(s.type), order: numberOr(s.order, 0),
      visible, locked: false,
      data,
      source: BLOCK_SPEC[s.type as BlockType]?.source
        ? Object.fromEntries(Object.keys(data)
            .filter((k) => k !== 'image_id')
            .map((k) => [k, 'generated']))
        : {},
    })
  }

  /* ── 생성된 집합은 **사라질 수 없다** (§10.2 삭제 불가·soft delete) ── */
  for (const id of baseIds) {
    if (!seen.has(id)) fail(id, `생성된 섹션이 빠졌습니다: ${id}. 삭제는 숨김으로만 합니다.`)
  }

  /* ── 이미지 참조 (§9.3·§10.2) ───────────────────────────────── */
  for (const s of sections) checkImageRefs(s, ctx, fail)

  /* ── 길이 계약 6종 (§17.1) ──────────────────────────────────── */
  for (const s of sections) checkLength(s, fail)

  if (Object.keys(errors).length > 0) return { errors }

  // 장소 설명(enrichment.요약) 편집 반영 + 보존. before가 없으면 그대로 없다.
  const enrichment = mergeEnrichment(ctx.before.enrichment, next.enrichment)

  return {
    errors,
    content: {
      schema_version: ctx.before.schema_version, theme: ctx.before.theme,
      sections: renumber(sections),
      ...(enrichment ? { enrichment } : {}),
    },
  }
}

/**
 * 편집 저장 시 장소 설명(enrichment) 보존 + **요약만** 편집 반영.
 *
 * 예전엔 `validateEdit`가 enrichment를 반환에서 빠뜨려 **저장할 때마다 장소 설명이
 * 통째로 사라졌다**(잠재 버그). 이제 before의 장소를 기준으로, 편집된 요약만 덮어쓴다 —
 * 이름·출처·태그는 before 그대로 둔다. 그래야 출처 없는 서술을 새로 만들거나 장소를
 * 추가·삭제할 수 없다(§8.8 실존 대조 유지). before에 enrichment가 없으면 undefined.
 */
function mergeEnrichment(before: Enrichment | undefined, edited: Enrichment | undefined): Enrichment | undefined {
  if (!before?.places?.length) return before
  const edits = new Map<string, string>()
  for (const raw of edited?.places ?? []) {
    const 이름 = String((raw as EnrichmentPlace)?.이름 ?? '').trim()
    const 요약 = (raw as EnrichmentPlace)?.요약
    if (이름 && typeof 요약 === 'string') edits.set(이름, 요약.replace(/\s+/g, ' ').trim().slice(0, ENRICH_SUMMARY_MAX))
  }
  return {
    ...before,
    places: before.places.map((p) => {
      const 요약 = edits.get(p.이름)
      // 빈 편집은 무시(원문 유지) — 설명 없는 카드가 되는 사고를 막는다
      return 요약 ? { ...p, 요약 } : p
    }),
  }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function checkBaseSection(
  id: string, prev: PageSection, s: Partial<PageSection>,
  data: Record<string, unknown>, visible: boolean,
  fail: (k: string, m: string) => void,
) {
  if (s.type !== prev.type) fail(id, `섹션 종류는 바꿀 수 없습니다: ${id}`)

  // §10.2 삭제 불가 — locked 섹션은 숨길 수도 없다. 숨김이 곧 삭제이기 때문이다.
  if (prev.locked && !visible) {
    fail(id, `${id}는 숨길 수 없습니다(§10.2 locked).`)
  }

  // 키 구성은 §9.3 표가 단일 출처다. 늘리거나 줄이지 않는다.
  const before = new Set(Object.keys(prev.data))
  const after = new Set(Object.keys(data))
  for (const k of after) if (!before.has(k)) fail(`${id}.${k}`, `없는 필드입니다: ${k}`)
  for (const k of before) if (!after.has(k)) fail(`${id}.${k}`, `필드가 빠졌습니다: ${k}`)

  // 섹션 종류는 id가 아니라 **type으로** 판정한다 — 구성이 자유로워 id가 고정이 아니다
  if (prev.type === 'apply') {
    for (const k of after) {
      if (APPLY_EDITABLE.has(k)) continue
      if (!same(data[k], prev.data[k])) {
        fail(`${id}.${k}`, `신청 섹션은 제목·안내문구만 편집할 수 있습니다(§10.2).`)
      }
    }
  }

  if (isItineraryType(prev.type)) checkDays(id, prev, data, fail)
  if (prev.type === 'accommodation') checkRows(id, '숙소들', prev, data, fail)
  if (prev.type === 'shop') checkRows(id, '상점들', prev, data, fail)
}

/**
 * 일차 배열은 개수·번호가 `confirmed_data`에서 온 사실이라 편집으로 늘리지 않는다.
 *
 * ⚠️ 개수 검사는 **이 주석이 원래 규정한 것인데 구현에 없었다.** `text` 유무만
 * 보았으므로 편집기가 일차를 하나 더 붙여 저장하면 그대로 통과했다 —
 * 그러면 일차 수가 여행기간과 어긋나고(§11.2), 다시 검증을 돌리는 순간
 * 3차가 「일차 수가 다릅니다」로 실패한다. 저장 시점에 막는다.
 */
function checkDays(
  id: string, prev: PageSection, data: Record<string, unknown>,
  fail: (k: string, m: string) => void,
) {
  const days = data.days
  if (!Array.isArray(days)) { fail(`${id}.days`, '일정 배열이 없습니다.'); return }

  const before = Array.isArray(prev.data.days) ? prev.data.days.length : days.length
  if (days.length !== before) {
    fail(`${id}.days`,
      `일차는 ${before}개여야 합니다(현재 ${days.length}개). `
      + '일차 수는 여행기간에서 오므로 편집으로 늘리거나 줄일 수 없습니다.')
    return
  }

  for (const [i, d] of days.entries()) {
    const day = d as Record<string, unknown>
    if (typeof day?.text !== 'string') fail(`${id}.days.${i}`, `${i + 1}번째 일차의 서술이 없습니다.`)
  }
}

/**
 * 값 배열(`숙소들`·`상점들`)의 편집 계약 (§9.3·§10.2).
 *
 * **값은 편집할 수 있고 행은 편집할 수 없다.** 행은 `form_input`에서 온 사실이라
 * 편집기에서 늘리면 입력에 없는 숙소·상점이 생기고(§16.1), 줄이면 부분 삭제다.
 * 새 내용을 더하고 싶으면 삽입 블록 3종을 쓴다(§10.2).
 *
 * 행 안의 **키 구성**도 고정이다 — 키가 사라지면 렌더러가 필드를 찾지 못하고,
 * 늘어나면 `source`가 없는 사실정보 필드가 생긴다(§8.8).
 */
function checkRows(
  id: string, field: string, prev: PageSection, data: Record<string, unknown>,
  fail: (k: string, m: string) => void,
) {
  /*
   * 2.6에 만든 `page_content`에는 이 배열 키가 없다 — `숙소명`이 섹션 data의
   * 최상위 키였다. 그 상품은 편집으로 구조를 바꿀 수 없으므로(§9.3의 키 구성은
   * 편집 대상이 아니다) **무엇을 하면 되는지** 알려준다. 「배열이 없습니다」만
   * 보여주면 사람은 자기가 무엇을 잘못했는지 찾다가 못 찾는다.
   */
  if (!(field in prev.data)) {
    fail(`${id}.${field}`,
      '이전 판본으로 만들어진 상품입니다. [다시 생성]으로 상품 페이지를 새로 만든 뒤 편집해 주세요.')
    return
  }

  const rows = data[field]
  if (!Array.isArray(rows)) { fail(`${id}.${field}`, `${field} 배열이 없습니다.`); return }

  const prevRows = Array.isArray(prev.data[field]) ? (prev.data[field] as unknown[]) : []
  if (rows.length !== prevRows.length) {
    fail(`${id}.${field}`,
      `${field}은(는) ${prevRows.length}건이어야 합니다(현재 ${rows.length}건). `
      + '행은 입력에서 오므로 편집으로 늘리거나 줄일 수 없습니다. '
      + '내용을 더하려면 삽입 블록을 쓰세요(§10.2).')
    return
  }

  for (const [i, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      fail(`${id}.${field}.${i}`, `${i + 1}번째 행의 모양이 올바르지 않습니다.`)
      continue
    }
    const before = new Set(Object.keys((prevRows[i] ?? {}) as object))
    const after = new Set(Object.keys(row as object))
    for (const k of after) {
      if (!before.has(k)) fail(`${id}.${field}.${i}.${k}`, `없는 필드입니다: ${k}`)
    }
    for (const k of before) {
      if (!after.has(k)) fail(`${id}.${field}.${i}.${k}`, `필드가 빠졌습니다: ${k}`)
    }
  }
}

function checkBlock(
  id: string, s: Partial<PageSection>, data: Record<string, unknown>,
  fail: (k: string, m: string) => void,
) {
  const type = s.type as BlockType
  if (!(BLOCK_TYPES as readonly string[]).includes(type)) {
    fail(id, `삽입할 수 있는 블록은 3종뿐입니다: ${BLOCK_TYPES.join(' · ')}`)
    return
  }

  const spec = BLOCK_SPEC[type]
  const allowed = new Set([...spec.required, ...spec.optional])
  for (const k of Object.keys(data)) {
    if (!allowed.has(k)) fail(`${id}.${k}`, `${spec.label} 블록에 없는 필드입니다: ${k}`)
  }
  for (const k of spec.required) {
    if (typeof data[k] !== 'string' || !(data[k] as string).trim()) {
      fail(`${id}.${k}`, `${spec.label} 블록의 ${k}은(는) 비울 수 없습니다.`)
    }
  }
}

/**
 * 이미지 참조는 **있는 것만** 가리킨다(§16.1 — 입력에 없는 값을 만들지 않는다).
 *
 * `image_slot`(단수)·`image_slots`(복수)는 슬롯 **이름**이고, `image` 블록의
 * `image_id`는 `product_images.id`다 — 셋을 같은 것으로 다루면 안 된다(§9.3·§10.2).
 */
function checkImageRefs(s: PageSection, ctx: EditContext, fail: (k: string, m: string) => void) {
  const slot = s.data.image_slot
  if (typeof slot === 'string' && slot && !ctx.slots.has(slot)) {
    fail(`${s.id}.image_slot`, `업로드되지 않은 슬롯입니다: ${slot}`)
  }

  const slots = s.data.image_slots
  if (Array.isArray(slots)) {
    for (const v of slots) {
      if (typeof v === 'string' && v && !ctx.slots.has(v)) {
        fail(`${s.id}.image_slots`, `업로드되지 않은 슬롯입니다: ${v}`)
      }
    }
  }

  const days = s.data.days
  if (Array.isArray(days)) {
    for (const [i, d] of days.entries()) {
      const v = (d as Record<string, unknown>)?.image_slot
      if (typeof v === 'string' && v && !ctx.slots.has(v)) {
        fail(`${s.id}.days.${i}.image_slot`, `업로드되지 않은 슬롯입니다: ${v}`)
      }
    }
  }

  if (s.type === 'image') {
    const id = s.data.image_id
    if (typeof id !== 'string' || !ctx.imageIds.has(id)) {
      // 편집기에서 새 업로드를 하지 않으므로(§7.3), 고를 수 있는 것은 이미 올라간 사진뿐이다
      fail(`${s.id}.image_id`, '이미 업로드된 사진 중에서 골라 주세요(§10.2).')
    }
  }
}

/**
 * 길이 계약은 **타입별로 `VOCABULARY[type].lengths`가 단일 출처다.** 생성 시점
 * (`checkPage`)과 저장 시점이 같은 표를 읽으므로 상한이 갈릴 수 없다(§17.1).
 * 저장 시점의 「6종」은 삽입 블록(`free_text` 500·`notice` 300)이 이 표에
 * 포함돼 자연히 늘어난 것이다 — 생성 시점엔 그 블록이 존재하지 않을 뿐이다.
 */
function checkLength(s: PageSection, fail: (k: string, m: string) => void) {
  const lengths = VOCABULARY[s.type as VocabType]?.lengths
  if (!lengths) return
  const over = (k: string, v: unknown, limit: number, what: string) => {
    const str = typeof v === 'string' ? v : ''
    // 값을 잘라내는 것은 §16.1 위반이므로 자르지 않고 거부한다.
    if (str.length > limit) fail(k, `${what}은(는) ${limit}자를 넘을 수 없습니다 (현재 ${str.length}자).`)
  }

  for (const [key, limit] of Object.entries(lengths)) {
    if (key === 'days.text') {
      const days = Array.isArray(s.data.days) ? s.data.days : []
      for (const [i, d] of days.entries()) {
        over(`${s.id}.days.${i}.text`, (d as Record<string, unknown>)?.text, limit, `${i + 1}일차 서술`)
      }
    } else if (key === '문구들.item') {
      const arr = Array.isArray(s.data.문구들) ? s.data.문구들 : []
      for (const [i, v] of arr.entries()) over(`${s.id}.문구들.${i}`, v, limit, `강조 문구 ${i + 1}`)
    } else {
      over(`${s.id}.${key}`, s.data[key], limit, `${key}`)
    }
  }
}

/* ════════════════════════════════════════════════════════════════
 * order 재부여 (§10.2)
 *
 * 「저장 시 전 섹션을 1부터 다시 번호 매긴다. `hero`는 항상 1, `apply`는 항상
 * 마지막」. 삽입 위치 규칙(「`hero`와 `apply` **사이에만**」)도 여기서 함께
 * 강제한다 — 거부하지 않고 제자리로 옮긴다. 사람이 실수로 맨 끝에 끌어다 놓은
 * 것을 400으로 튕기면, 무엇을 고쳐야 할지 알 수 없는 오류가 된다.
 * ════════════════════════════════════════════════════════════════ */

export function renumber(sections: PageSection[]): PageSection[] {
  // hero·apply는 id가 아니라 **type으로** 판정한다(구성 자유 · 명령서 §5)
  const hero = sections.filter((s) => s.type === 'hero')
  const apply = sections.filter((s) => s.type === 'apply')
  const middle = sections
    .filter((s) => s.type !== 'hero' && s.type !== 'apply')
    .sort((a, b) => a.order - b.order)

  return [...hero, ...middle, ...apply].map((s, i) => ({ ...s, order: i + 1 }))
}

/** 화면의 [위로]·[아래로]. 같은 규칙을 쓰므로 저장 후 순서가 어긋나지 않는다. */
export function moveSection(sections: PageSection[], id: string, dir: -1 | 1): PageSection[] {
  const ordered = renumber(sections)
  const i = ordered.findIndex((s) => s.id === id)
  const j = i + dir
  // hero(0)와 apply(끝)는 자리를 내주지 않는다
  if (i <= 0 || i >= ordered.length - 1 || j <= 0 || j >= ordered.length - 1) return ordered

  const swapped = [...ordered]
  ;[swapped[i], swapped[j]] = [swapped[j], swapped[i]]
  return swapped.map((s, n) => ({ ...s, order: n + 1 }))
}

/* ════════════════════════════════════════════════════════════════
 * edit_history (§5.6·§10.3 5항)
 *
 * 「변경된 섹션마다 `{action, section_id, before, after}`를 기록한다」.
 * `action`은 DB의 CHECK 제약이 4종으로 고정한다 — update/delete/insert/reorder.
 * ════════════════════════════════════════════════════════════════ */

export interface EditRecord {
  action: 'update' | 'delete' | 'insert' | 'reorder'
  section_id: string
  before: unknown
  after: unknown
}

/**
 * 바뀐 것만 골라낸다. **변경이 없으면 빈 배열**이고, 그때는 이력을 남기지 않는다 —
 * 저장 버튼을 두 번 눌렀다고 같은 행이 두 개 쌓이면 이력이 근거가 되지 못한다.
 *
 * 「숨김」은 `delete`로 적는다. §10.2가 삭제를 `visible: false` 전환으로 정의했으므로
 * 화면에서 [삭제]를 누른 사람의 의도와 로그의 단어가 일치해야 한다.
 */
export function diffSections(before: PageContent, after: PageContent): EditRecord[] {
  const records: EditRecord[] = []
  const beforeById = new Map(before.sections.map((s) => [s.id, s]))
  const afterById = new Map(after.sections.map((s) => [s.id, s]))

  for (const [id, b] of beforeById) {
    const a = afterById.get(id)
    if (!a) {
      // 배열에서 빠진 것 — 삽입 블록을 통째로 걷어낸 경우다. 값은 이력에 남는다.
      records.push({ action: 'delete', section_id: id, before: b, after: null })
      continue
    }
    if (b.visible !== false && a.visible === false) {
      records.push({ action: 'delete', section_id: id, before: b, after: a })
    } else if (!same(b.data, a.data) || b.visible !== a.visible) {
      records.push({ action: 'update', section_id: id, before: b, after: a })
    }
    if (b.order !== a.order) {
      records.push({ action: 'reorder', section_id: id,
        before: { order: b.order }, after: { order: a.order } })
    }
  }

  for (const [id, a] of afterById) {
    if (!beforeById.has(id)) {
      records.push({ action: 'insert', section_id: id, before: null, after: a })
    }
  }

  return records
}

/**
 * JSON 값 비교. 키 순서에 영향받지 않아야 한다 — 클라이언트가 객체를 다시
 * 만들면서 키 순서가 바뀌는 것만으로 「변경됨」이 되면 이력이 쓰레기로 찬다.
 */
export function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined'
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const keys = Object.keys(v as object).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
}
