/**
 * 상품 페이지 콘텐츠 모델 (spec 2.8 §9.2·§9.3 · 명령서 ⑤·⑥) — **순수 모듈**.
 *
 * ## 2.7 → 2.8에서 뒤집힌 것
 *
 * 2.7의 `buildPage`는 `PAGE_SECTION_IDS` 9개를 하드코딩해 `section(...)`을 9번
 * 불렀다. 2.8은 **AI의 블록 계획대로 조립**한다 — 구성·순서·분위기·레이아웃을
 * AI가 정하고, 이 모듈은 계획을 순회하며 **사실정보 값을 `confirmed_data`에서
 * 그대로 치환**한다. 값이 AI를 거치지 않으므로 바뀔 수 없다(§16.1 구조적 보장).
 *
 * 검증은 「9개·순서」에서 **어휘·`source` 커버리지**로 옮겼다(`checkPage`).
 * 어휘·layout·재료 대응은 `lib/pipeline/vocabulary.ts`가 단일 출처다.
 *
 * AI는 HTML을 생성하지 않는다. 렌더링은 고정 React 컴포넌트가 담당한다(§9.1).
 */
import type { ConfirmedData } from './normalize'
import type { ResolvedTheme } from './theme'
import type { ComposeBlock } from './ai-contracts'
import type { Enrichment } from './enrichment'
import { requiredPaths } from './paths'
import {
  VOCABULARY, isBlockType, resolveLayout,
  ALIGNS, EDGES, MEDIAS, PADS, TONES, WIDTHS,
  type BlockType, type BlockStyle,
} from './vocabulary'

export interface PageSection {
  id: string
  type: string
  order: number
  visible: boolean
  locked: boolean
  /** 블록별 스타일 손잡이 (명령서 4-③). 렌더러가 읽는다. 삽입 블록엔 없을 수 있다 */
  style?: BlockStyle
  data: Record<string, unknown>
  source: Record<string, string>
}

export interface PageContent {
  schema_version: string
  /** 2.8은 계산된 테마 객체, 레거시는 문자열 키 (렌더러가 둘 다 읽는다) */
  theme: ResolvedTheme | string
  sections: PageSection[]
  /**
   * Task 2 — place-enrichment (선택). 그라운딩 웹 검색으로 얻은 실제 장소 정보 +
   * 출처. `checkPage`는 `sections`만 순회하므로 이 키를 건드리지 않는다 — 계약
   * 밖의 부가 데이터다. 렌더러가 있으면 그린다.
   */
  enrichment?: Enrichment
}

export interface PageInputs {
  cd: ConfirmedData
  theme: ResolvedTheme
  /** 업로드된 슬롯 이름 집합 — 없는 슬롯을 만들지 않는다(§16.1) */
  slots: Set<string>
  /** AI 산출 — 블록 계획 (구성·순서·스타일·서술) */
  plan: ComposeBlock[]
  /** AI 산출 — 일차별 확장 서술 (day → text) */
  expanded: Map<string, string>
  /** AI 산출 — 신청 섹션 문구 */
  apply: { 제목: string; 안내문구: string }
  /** AI 산출 — 히어로 감성 카피 (source: generated). 없으면 행사명으로 폴백 */
  hero?: { headline: string; subcopy: string }
}

/* ── 콘텐츠 길이 계약 (§17.1) — 생성 시점 요약 ────────────────────
 * 실제 강제는 **타입별**로 `VOCABULARY[type].lengths`가 갖는다(`checkPage`).
 * 이 상수는 편집 계약(`LENGTH_LIMITS_SAVE`)과 값을 맞추기 위한 대조 기준으로 남긴다.
 * ──────────────────────────────────────────────────────────────── */
export const LENGTH_LIMITS_GENERATE = {
  'hero.headline': 40,
  'hero.subcopy': 80,
  '일차별 서술': 200,
  '섹션 제목': 30,
} as const

/* ════════════════════════════════════════════════════════════════
 * 조립 (스킬 `web-content-structure-gen`)
 * ════════════════════════════════════════════════════════════════ */

function resolveStyle(type: BlockType, b: ComposeBlock): BlockStyle {
  const pick = <T>(v: unknown, set: readonly T[], def: T): T =>
    set.includes(v as T) ? (v as T) : def
  return {
    layout: resolveLayout(type, b.layout),
    tone: pick(b.tone, TONES, 'surface'),
    width: pick(b.width, WIDTHS, 'normal'),
    align: pick(b.align, ALIGNS, 'left'),
    pad: pick(b.pad, PADS, 'normal'),
    edge: pick(b.edge, EDGES, 'none'),
    media: pick(b.media, MEDIAS, 'none'),
  }
}

/** ref(`숙박[0]`) → 배열·인덱스. 무효면 null */
function parseRef(ref: string | undefined): { arr: '숙박' | '상점'; idx: number } | null {
  const m = /^(숙박|상점)\[(\d+)\]$/.exec((ref ?? '').trim())
  if (!m) return null
  return { arr: m[1] as '숙박' | '상점', idx: Number(m[2]) }
}

interface Built {
  type: BlockType
  data: Record<string, unknown>
  source: Record<string, string>
}

/**
 * 블록 1개를 사실정보 치환 + 서술로 조립한다. 재료가 없거나 참조가 무효면 `null`
 * (그 블록은 버린다 — 없는 값을 만들지 않는다, §16.1).
 */
function buildBlock(
  type: BlockType, b: ComposeBlock, inp: PageInputs,
): Built | null {
  const { cd, slots, expanded } = inp
  const g = cd.행사정보
  const slotIf = (name: string) => (slots.has(name) ? name : '')

  switch (type) {
    case 'hero': {
      /*
       * 배너는 **AI 감성 카피**(source: generated)를 크게 싣고, **행사명·기간은
       * 사실값**으로 함께 둔다(§Task 재설계). AI 카피가 없으면 행사명으로 폴백한다 —
       * 그때는 headline이 사실값이므로 source도 행사명 경로다. `행사명` 필드는 항상
       * 사실 source를 가져 커버리지(행사정보.행사명)를 만족한다.
       */
      const hHead = inp.hero?.headline?.trim()
      const hSub = inp.hero?.subcopy?.trim()
      return {
        type,
        data: {
          headline: hHead || g.행사명,
          subcopy: hSub || g.여행기간,
          행사명: g.행사명,
          image_slot: slotIf('hero'),
        },
        source: {
          headline: hHead ? 'generated' : '행사정보.행사명',
          subcopy: hSub ? 'generated' : '행사정보.여행기간',
          행사명: '행사정보.행사명',
        },
      }
    }

    case 'summary':
      return {
        type,
        data: {
          행사명: g.행사명,
          행사기간: g.행사기간, 여행기간: g.여행기간, 여행지: g.여행지, 타겟층: g.타겟층,
          여행스타일: g.여행스타일, 여행주제: g.여행주제,
        },
        source: {
          행사명: '행사정보.행사명',
          행사기간: '행사정보.행사기간', 여행기간: '행사정보.여행기간', 여행지: '행사정보.여행지',
          타겟층: '행사정보.타겟층', 여행스타일: '행사정보.여행스타일', 여행주제: '행사정보.여행주제',
        },
      }

    case 'itinerary':
    case 'timeline':
      return {
        type,
        data: {
          days: g.일정.map((d) => ({
            day: d.day,
            text: expanded.get(d.day)?.trim() || d.내용,
            image_slot: slotIf(`itinerary_day_${d.day}`),
          })),
        },
        source: { days: '행사정보.일정' },
      }

    case 'accommodation':
      return {
        type,
        data: {
          숙소들: cd.숙박.map((st) => ({
            숙소명: st.숙소명, 객실타입: st.객실타입, 위치: st.위치, 숙박일정: st.숙박일정,
          })),
          image_slots: slots.has('accommodation') ? ['accommodation'] : [],
        },
        source: { 숙소들: '숙박' },
      }

    case 'flight':
      return {
        type, data: { ...cd.항공편 },
        source: {
          공항: '항공편.공항', 항공사: '항공편.항공사', 편명: '항공편.편명',
          출발시간: '항공편.출발시간', 도착시간: '항공편.도착시간',
        },
      }

    case 'meal':
      return { type, data: { 식사정보: cd.식사.식사정보 }, source: { 식사정보: '식사.식사정보' } }

    case 'price':
      return {
        type, data: { 성인: cd.가격.성인, 아동: cd.가격.아동, 기타: cd.가격.기타 },
        source: { 성인: '가격.성인', 아동: '가격.아동', 기타: '가격.기타' },
      }

    case 'shop':
      return {
        type,
        data: {
          상점들: cd.상점.map((sh) => ({
            상점명: sh.상점명, 구분: sh.구분, 위치: sh.위치, 상점정보: sh.상점정보,
          })),
          image_slots: slots.has('shop') ? ['shop'] : [],
        },
        source: { 상점들: '상점' },
      }

    case 'gallery': {
      // 슬롯이 없으면 만들지 않는다 — 빈 갤러리는 의미가 없다
      const has = slots.has('gallery')
      if (!has) return null
      return { type, data: { image_slots: ['gallery'] }, source: {} }
    }

    case 'stat': {
      const items = [
        { label: '여행 일수', value: `${cd.행사정보.일정.length}일` },
        ...(cd.숙박.length ? [{ label: '숙소', value: `${cd.숙박.length}곳` }] : []),
        ...(cd.상점.length ? [{ label: '제휴·추천 상점', value: `${cd.상점.length}곳` }] : []),
      ]
      return { type, data: { items }, source: {} }
    }

    case 'divider':
      return { type, data: {}, source: {} }

    case 'highlight': {
      const 문구들 = (b.문구들 ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
      if (문구들.length === 0) return null
      return { type, data: { 문구들 }, source: { 문구들: 'generated' } }
    }

    case 'cta': {
      const 제목 = (b.제목 ?? '').trim()
      const 본문 = (b.본문 ?? '').trim()
      if (!제목 && !본문) return null
      return { type, data: { 제목, 본문 }, source: { 제목: 'generated', 본문: 'generated' } }
    }

    case 'spotlight': {
      const ref = parseRef(b.ref)
      if (!ref) return null
      const rows = ref.arr === '숙박' ? cd.숙박 : cd.상점
      const row = rows[ref.idx] as unknown as Record<string, string> | undefined
      if (!row) return null
      const 이름 = ref.arr === '숙박' ? row.숙소명 : row.상점명
      const 위치 = row.위치 ?? ''
      const 본문 = (b.본문 ?? '').trim()
      return {
        type,
        data: { 이름, 위치, 본문, image_slot: slotIf(ref.arr === '숙박' ? 'accommodation' : 'shop') },
        source: {
          이름: `${ref.arr}[${ref.idx}].${ref.arr === '숙박' ? '숙소명' : '상점명'}`,
          위치: `${ref.arr}[${ref.idx}].위치`,
          본문: 'generated',
        },
      }
    }

    default:
      return null
  }
}

/** apply 블록은 항상 마지막·locked. AI 계획에 없어도 기계가 보증한다 */
function buildApply(inp: PageInputs): Built {
  const g = inp.cd.행사정보
  return {
    type: 'apply',
    data: {
      제목: inp.apply.제목, 안내문구: inp.apply.안내문구,
      가격요약: { 성인: inp.cd.가격.성인, 아동: inp.cd.가격.아동 },
      행사정보요약: { 행사명: g.행사명, 여행기간: g.여행기간 },
    },
    source: {
      제목: 'generated', 안내문구: 'generated',
      '가격요약.성인': '가격.성인', '가격요약.아동': '가격.아동',
      '행사정보요약.행사명': '행사정보.행사명', '행사정보요약.여행기간': '행사정보.여행기간',
    },
  }
}

/**
 * AI의 계획을 조립한다. **hero는 처음·apply는 마지막**을 기계가 보증하고
 * (locked · 위치 고정), 그 사이는 계획 순서를 그대로 따른다.
 *
 * id는 상품 안에서 유일해야 한다 — 같은 type이 여러 개일 수 있으므로 카운터를 붙인다.
 * 첫 등장은 `sec_hero`처럼 접미사 없이(2.6 이전 상품과 id 형태가 이어진다), 이후는
 * `sec_highlight_1`. 이 id 집합이 편집 계약의 「그 상품이 생성한 집합」이 된다.
 */
export function buildPage(inp: PageInputs): PageContent {
  const counters = new Map<string, number>()
  const idFor = (type: string) => {
    const n = counters.get(type) ?? 0
    counters.set(type, n + 1)
    return n === 0 ? `sec_${type}` : `sec_${type}_${n}`
  }

  const middle: PageSection[] = []
  let heroBuilt: { built: Built; style?: BlockStyle } | null = null

  for (const b of inp.plan) {
    if (!isBlockType(b.type)) continue
    const type = b.type as BlockType
    if (type === 'apply') continue // apply는 기계가 보증한다 — 계획분은 버린다
    const style = resolveStyle(type, b)

    if (type === 'hero') {
      if (heroBuilt) continue // 히어로는 하나 — 첫 계획만 쓴다
      const built = buildBlock('hero', b, inp)
      if (built) heroBuilt = { built, style }
      continue
    }

    const built = buildBlock(type, b, inp)
    if (!built) continue
    middle.push({
      id: idFor(type), type, order: 0, visible: true,
      locked: false, style, data: built.data, source: built.source,
    })
  }

  /*
   * 누락된 사실 블록 자동 보강 (2026-08-13 신뢰성 보강).
   *
   * AI가 재료 있는 사실 블록을 빠뜨리면 2.8 초안 설계에서는 `checkPage` 커버리지가
   * 실패해 **재시도로 소진**됐다(실측 — page 생성이 중단됨). 값이 사라지는 것은
   * §16.1 위반이므로, 재시도에 맡기지 않고 **기계가 빠진 사실 블록을 apply 앞에
   * 덧붙여** 커버리지를 구조적으로 보장한다(완료조건 #2). AI는 여전히 순서·스타일·
   * 추가 블록을 정하고, 기계는 누락만 backstop한다.
   */
  const coveredPaths = new Set<string>()
  for (const s of middle) for (const p of Object.values(s.source)) if (p !== 'generated') coveredPaths.add(p)

  const 필수사실 = ['summary', 'itinerary', 'accommodation', 'flight', 'meal', 'price', 'shop'] as const
  for (const t of 필수사실) {
    const def = VOCABULARY[t]
    if (def.available && !def.available(inp.cd)) continue // 재료 없음 — 보강하지 않는다
    const paths = def.materialPaths ? def.materialPaths(inp.cd) : []
    // 일정은 itinerary·timeline 어느 쪽이든 덮으면 성립(같은 source 경로)
    if (paths.every((p) => coveredPaths.has(p))) continue
    const built = buildBlock(t, {} as ComposeBlock, inp)
    if (!built) continue
    middle.push({
      id: idFor(t), type: t, order: 0, visible: true, locked: false,
      style: resolveStyle(t, {} as ComposeBlock), data: built.data, source: built.source,
    })
    for (const p of Object.values(built.source)) if (p !== 'generated') coveredPaths.add(p)
  }

  // hero가 계획에 없었으면 기본 스타일로 보증한다
  const heroSection: PageSection = {
    id: 'sec_hero', type: 'hero', order: 0, visible: true, locked: true,
    style: heroBuilt?.style ?? resolveStyle('hero', {} as ComposeBlock),
    data: (heroBuilt?.built ?? buildBlock('hero', {} as ComposeBlock, inp)!).data,
    source: (heroBuilt?.built ?? buildBlock('hero', {} as ComposeBlock, inp)!).source,
  }

  const applyBuilt = buildApply(inp)
  const applySection: PageSection = {
    id: 'sec_apply', type: 'apply', order: 0, visible: true, locked: true,
    style: resolveStyle('apply', {} as ComposeBlock),
    data: applyBuilt.data, source: applyBuilt.source,
  }

  const sections = [heroSection, ...middle, applySection].map((s, i) => ({ ...s, order: i + 1 }))
  return { schema_version: '2.0', theme: inp.theme, sections }
}

/* ════════════════════════════════════════════════════════════════
 * 검사 (스킬 `page-contract-check`) — AI 0회
 *
 * 「9개·순서 일치」를 버리고 **어휘·커버리지·구조 최소 조건**으로 옮겼다(명령서 ⑤).
 * ════════════════════════════════════════════════════════════════ */

const IMAGE_KEYS = new Set(['image_slot', 'image_slots'])

/** 길이 계약 위반을 타입별로 검사한다 (`VOCABULARY[type].lengths`) */
function checkLength(s: PageSection, errors: string[]) {
  const lengths = VOCABULARY[s.type as BlockType]?.lengths
  if (!lengths) return
  for (const [key, limit] of Object.entries(lengths)) {
    if (key === 'days.text') {
      for (const d of (s.data.days as { text?: string }[] | undefined) ?? []) {
        const t = typeof d.text === 'string' ? d.text : ''
        if (t.length > limit) errors.push(`${s.id}.days의 일차 서술이 ${limit}자를 넘습니다 (${t.length}자). 값을 자르지 않습니다.`)
      }
      continue
    }
    if (key === '문구들.item') {
      for (const [i, v] of ((s.data.문구들 as unknown[]) ?? []).entries()) {
        const t = typeof v === 'string' ? v : ''
        if (t.length > limit) errors.push(`${s.id}.문구들[${i}]이 ${limit}자를 넘습니다 (${t.length}자).`)
      }
      continue
    }
    const v = s.data[key]
    if (typeof v === 'string' && v.length > limit) {
      errors.push(`${s.id}.${key}이(가) ${limit}자를 넘습니다 (${v.length}자). 값을 자르지 않습니다.`)
    }
  }
}

/** 미치환 토큰이 남았는가 (값·배열 원소 재귀) */
function tokenScan(id: string, key: string, v: unknown, errors: string[]) {
  if (typeof v === 'string') {
    if (/\{\{|\}\}/.test(v)) errors.push(`${id}.${key}에 미치환 토큰이 남았습니다.`)
    return
  }
  if (Array.isArray(v)) {
    for (const [i, row] of v.entries()) {
      if (typeof row === 'string') {
        if (/\{\{|\}\}/.test(row)) errors.push(`${id}.${key}[${i}]에 미치환 토큰이 남았습니다.`)
      } else if (row && typeof row === 'object') {
        for (const [sub, val] of Object.entries(row as Record<string, unknown>)) {
          if (typeof val === 'string' && /\{\{|\}\}/.test(val)) {
            errors.push(`${id}.${key}[${i}].${sub}에 미치환 토큰이 남았습니다.`)
          }
        }
      }
    }
  }
}

export function checkPage(p: PageContent, slots: Set<string>, cd: ConfirmedData): string[] {
  const errors: string[] = []
  const sections = p.sections

  /* ── 1. 어휘 준수 ─────────────────────────────────────────── */
  for (const s of sections) {
    if (!isBlockType(s.type)) errors.push(`어휘에 없는 블록 type입니다: ${s.id} (${s.type})`)
  }

  /* ── 2. hero 1개(order 1·locked) · apply 1개(마지막·locked) ── */
  const heroes = sections.filter((s) => s.type === 'hero')
  const applies = sections.filter((s) => s.type === 'apply')
  if (heroes.length !== 1) errors.push(`hero는 정확히 1개여야 합니다 (현재 ${heroes.length}개).`)
  else if (heroes[0].order !== 1 || !heroes[0].locked) errors.push('hero는 order 1이며 locked여야 합니다.')
  if (applies.length !== 1) errors.push(`apply는 정확히 1개여야 합니다 (현재 ${applies.length}개).`)
  else if (applies[0].order !== sections.length || !applies[0].locked) {
    errors.push('apply는 마지막 순서이며 locked여야 합니다.')
  }

  /* ── 3. order가 1..n 연속 ─────────────────────────────────── */
  const orders = [...sections].map((s) => s.order).sort((a, b) => a - b)
  if (orders.some((o, i) => o !== i + 1)) {
    errors.push(`order가 1..${sections.length} 연속이 아닙니다: ${sections.map((s) => s.order).join(',')}`)
  }

  /* ── 4. source 커버리지 — 확정 데이터의 모든 사실정보 경로 ─── */
  const covered = new Set<string>()
  for (const s of sections) {
    for (const path of Object.values(s.source ?? {})) {
      if (path !== 'generated') covered.add(path)
    }
  }
  for (const req of requiredPaths(cd)) {
    if (!covered.has(req)) {
      errors.push(`사실정보 «${req}»가 페이지 어느 블록에도 없습니다 (커버리지 위반).`)
    }
  }

  /* ── 5. source 누락 0건 · 미치환 토큰 0건 ─────────────────── */
  for (const s of sections) {
    const role = VOCABULARY[s.type as BlockType]?.role
    for (const [k, v] of Object.entries(s.data)) {
      if (IMAGE_KEYS.has(k)) {
        if (k in s.source) errors.push(`${s.id}.${k}에 source가 붙어 있습니다. 이미지 참조는 사실정보가 아닙니다.`)
        continue
      }
      tokenScan(s.id, k, v, errors)
      // 중첩 요약 객체(apply)는 하위 키에 source가 있어야 한다
      if ((k === '가격요약' || k === '행사정보요약') && v && typeof v === 'object') {
        for (const sub of Object.keys(v as object)) {
          if (!(`${k}.${sub}` in s.source)) errors.push(`${s.id}.${k}.${sub}에 source가 없습니다.`)
        }
        continue
      }
      // fact·generated 블록의 값 필드는 source가 있어야 한다. derived·decor는 면제
      if ((role === 'fact' || role === 'generated') && !(k in s.source)) {
        errors.push(`${s.id}.${k}에 source가 없습니다.`)
      }
    }
  }

  /* ── 6. 타입별 길이 계약 ──────────────────────────────────── */
  for (const s of sections) checkLength(s, errors)

  /* ── 7. 이미지 참조는 업로드된 슬롯만 (§16.1) ─────────────── */
  const checkSlot = (val: unknown, where: string) => {
    if (typeof val === 'string' && val && !slots.has(val)) errors.push(`${where}가 없는 슬롯을 참조합니다: ${val}`)
  }
  for (const s of sections) {
    checkSlot(s.data.image_slot, s.id)
    if (Array.isArray(s.data.image_slots)) for (const v of s.data.image_slots) checkSlot(v, `${s.id}.image_slots`)
    for (const [i, d] of ((s.data.days as { image_slot?: string }[] | undefined) ?? []).entries()) {
      checkSlot(d.image_slot, `${s.id}.days[${i}]`)
    }
  }

  return errors
}
