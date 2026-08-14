/**
 * 블록 어휘 — **단일 출처** (spec 2.8 §9.2·§9.3 · 명령서 4-④).
 *
 * 상품 페이지의 「정해진 9섹션」을 없애고 AI가 구성·순서·분위기를 정하게 하되,
 * **AI는 어휘를 늘릴 수 없다.** 렌더러가 아는 `type` 목록이 여기 하나로 모여 있고
 * `page.ts`·`checkPage`·`edit-contract`·AI 프롬프트 조립·렌더러가 전부 이것을 읽는다.
 * 흩어지면 조용히 갈린다(명령서 4-④).
 *
 * ## 무엇이 여기 있고 무엇이 없나
 *
 * - **어휘**(`BLOCK_TYPES`) · **타입별 역할**(`role`) · **타입별 재료**(`materialPaths`)
 *   · **타입별 layout 변형** · **타입별 길이 계약**.
 * - `quote`(후기·인용)는 **없다.** 후기는 입력에 없으므로 AI가 쓰면 §16.1 위반이다.
 *   어휘에서 빼는 것으로 막는다 — 프롬프트 금지문보다 확실하다(명령서 4-④).
 *   같은 이유로 소요시간·거리·인원을 담는 블록도 없다.
 */
import type { ConfirmedData } from './normalize'

/* ════════════════════════════════════════════════════════════════
 * 1. 블록 스타일 손잡이 (명령서 4-③) — 대부분의 시각적 변화가 여기서 나온다
 * ════════════════════════════════════════════════════════════════ */

export type Tone = 'surface' | 'invert' | 'tint' | 'bare'
export type Width = 'narrow' | 'normal' | 'wide' | 'full'
export type Align = 'left' | 'center'
export type Pad = 'tight' | 'normal' | 'loose'
export type Edge = 'none' | 'curve' | 'diagonal' | 'arc' | 'rule'
export type Media = 'none' | 'inset' | 'bleed' | 'overlap' | 'side' | 'grid' | 'collage'

export const TONES: readonly Tone[] = ['surface', 'invert', 'tint', 'bare']
export const WIDTHS: readonly Width[] = ['narrow', 'normal', 'wide', 'full']
export const ALIGNS: readonly Align[] = ['left', 'center']
export const PADS: readonly Pad[] = ['tight', 'normal', 'loose']
export const EDGES: readonly Edge[] = ['none', 'curve', 'diagonal', 'arc', 'rule']
export const MEDIAS: readonly Media[] = ['none', 'inset', 'bleed', 'overlap', 'side', 'grid', 'collage']

export interface BlockStyle {
  layout: string
  tone: Tone
  width: Width
  align: Align
  pad: Pad
  edge: Edge
  media: Media
}

export const DEFAULT_STYLE: BlockStyle = {
  layout: '', tone: 'surface', width: 'normal', align: 'left', pad: 'normal', edge: 'none', media: 'none',
}

/* ════════════════════════════════════════════════════════════════
 * 2. 어휘 — 기존 9종 + 삽입 3종 + 추가 7종
 * ════════════════════════════════════════════════════════════════ */

export type BlockType =
  // 기존 9종 (사실정보 소유) — 변경 0
  | 'hero' | 'summary' | 'itinerary' | 'accommodation' | 'flight'
  | 'meal' | 'price' | 'shop' | 'apply'
  // 삽입 3종 (§10.2. 편집기가 끼워 넣는다) — 변경 0
  | 'free_text' | 'image' | 'notice'
  // 추가 7종
  | 'gallery' | 'highlight' | 'spotlight' | 'timeline' | 'cta' | 'stat' | 'divider'

/**
 * `fact`     확정 데이터의 사실정보를 담는다. 값은 기계가 치환한다
 * `generated` AI가 쓰는 서술. `source: "generated"`
 * `derived`  기계가 세거나 모은다 (stat·gallery)
 * `decor`    값이 없다 (divider)
 * `insert`   편집기가 끼워 넣는다 (§10.2)
 */
export type BlockRole = 'fact' | 'generated' | 'derived' | 'decor' | 'insert'

export interface BlockDef {
  role: BlockRole
  /** 허용 layout 변형. 첫 값이 기본. AI가 고른 값이 무효면 첫 값으로 떨어진다 */
  layouts: readonly string[]
  /**
   * 이 블록이 담는 사실정보 `source` 경로(최상위). 커버리지·게이트의 기준.
   * `fact` 블록만 갖는다. 배열 재료는 배열 경로 하나(`숙박`)를 반환한다.
   */
  materialPaths?: (cd: ConfirmedData) => string[]
  /**
   * 재료가 존재하는가. `false`면 게이트가 AI에게 「이 블록은 만들지 마라」고 알린다
   * — 존재할 수 없는 블록에 토큰을 쓰지 않게(명령서 ⑥). 값이 `해당 없음`·0행이면 false.
   */
  available?: (cd: ConfirmedData) => boolean
  /** 서술 필드 길이 계약(생성 시점). `checkPage`가 타입별로 강제 */
  lengths?: Readonly<Record<string, number>>
  /** AI가 쓰는 서술 필드 이름. 프롬프트·조립이 읽는다 */
  narrativeFields?: readonly string[]
  locked?: boolean
  /** 위치 제약. hero는 처음, apply는 마지막 */
  position?: 'first' | 'last'
  /** 편집기가 삽입할 수 있는가 (§10.2) */
  editorInsertable?: boolean
}

const notNone = (v: string) => v.trim() !== '' && v.trim() !== '해당 없음'

/** 항공 5필드가 모두 `해당 없음`이면 재료 없음 */
function flightAvailable(cd: ConfirmedData): boolean {
  const f = cd.항공편
  return [f.공항, f.항공사, f.편명, f.출발시간, f.도착시간].some(notNone)
}

export const VOCABULARY: Record<BlockType, BlockDef> = {
  /* ── 기존 9종 (사실정보 소유) ─────────────────────────────── */
  hero: {
    role: 'fact', layouts: ['classic', 'split', 'minimal'],
    materialPaths: () => ['행사정보.행사명', '행사정보.여행기간'],
    lengths: { headline: 40, subcopy: 80 },
    locked: true, position: 'first',
  },
  summary: {
    role: 'fact', layouts: ['cards', 'list', 'inline'],
    materialPaths: (cd) => [
      ...(cd.행사정보.행사기간 ? ['행사정보.행사기간'] : []),
      '행사정보.여행기간', '행사정보.여행지', '행사정보.타겟층',
      '행사정보.여행스타일', '행사정보.여행주제',
    ],
  },
  itinerary: {
    role: 'fact', layouts: ['stack', 'numbered', 'rail'],
    materialPaths: () => ['행사정보.일정'],
    lengths: { 'days.text': 200 },
  },
  accommodation: {
    role: 'fact', layouts: ['cards', 'rows'],
    materialPaths: () => ['숙박'],
    available: (cd) => cd.숙박.length > 0,
  },
  flight: {
    role: 'fact', layouts: ['table', 'cards'],
    materialPaths: () => ['항공편.공항', '항공편.항공사', '항공편.편명', '항공편.출발시간', '항공편.도착시간'],
    available: flightAvailable,
  },
  meal: {
    role: 'fact', layouts: ['plain', 'panel'],
    materialPaths: () => ['식사.식사정보'],
    available: (cd) => notNone(cd.식사.식사정보),
  },
  price: {
    role: 'fact', layouts: ['cards', 'table'],
    materialPaths: () => ['가격.성인', '가격.아동', '가격.기타'],
  },
  shop: {
    role: 'fact', layouts: ['cards', 'rows', 'grid'],
    materialPaths: () => ['상점'],
    available: (cd) => cd.상점.length > 0,
  },
  apply: {
    role: 'fact', layouts: ['panel'],
    // 요약값의 source는 가격·행사 경로를 승계한다. 커버리지 기준은 아니다(중복이므로 별도로 세지 않는다)
    lengths: { 제목: 30 },
    narrativeFields: ['제목', '안내문구'],
    locked: true, position: 'last',
  },

  /* ── 삽입 3종 (§10.2) — 편집기 전용 ───────────────────────── */
  free_text: {
    role: 'insert', layouts: ['plain'],
    lengths: { 제목: 30, 본문: 500 },
    narrativeFields: ['제목', '본문'], editorInsertable: true,
  },
  image: {
    role: 'insert', layouts: ['plain'],
    narrativeFields: ['캡션'], editorInsertable: true,
  },
  notice: {
    role: 'insert', layouts: ['plain'],
    lengths: { 본문: 300 },
    narrativeFields: ['본문'], editorInsertable: true,
  },

  /* ── 추가 7종 ─────────────────────────────────────────────── */
  gallery: {
    // 사진 묶음 (슬롯 기반). 기계가 슬롯 이미지를 모은다
    role: 'derived', layouts: ['grid', 'mosaic'],
  },
  highlight: {
    // 강조 문구 여러 개. source: generated
    role: 'generated', layouts: ['banner', 'stack'],
    lengths: { '문구들.item': 60 },
    narrativeFields: ['문구들'],
  },
  spotlight: {
    // 한 곳 집중 소개. 숙박[i] 또는 상점[i] 참조 + 서술
    role: 'generated', layouts: ['side', 'stacked'],
    lengths: { 본문: 200 },
    narrativeFields: ['본문'],
  },
  timeline: {
    // 일정의 다른 표현. itinerary와 **같은 재료**다 — 어느 쪽을 써도 일정 커버리지가 성립
    role: 'fact', layouts: ['rail', 'alternating'],
    materialPaths: () => ['행사정보.일정'],
    lengths: { 'days.text': 200 },
  },
  cta: {
    // 중간 신청 유도. source: generated
    role: 'generated', layouts: ['bar', 'panel'],
    lengths: { 제목: 30, 본문: 120 },
    narrativeFields: ['제목', '본문'],
  },
  stat: {
    // 숫자 요약. **기계가 세는 값만** (일수·숙소 수·상점 수)
    role: 'derived', layouts: ['row', 'grid'],
  },
  divider: {
    // 분위기 전환용 장식. 값이 없다
    role: 'decor', layouts: ['plain', 'wave', 'diagonal'],
  },
}

export const BLOCK_TYPES = Object.keys(VOCABULARY) as BlockType[]

/** AI가 계획에 쓸 수 있는 타입 — 삽입 3종(편집기 전용) 제외 */
export const AI_BLOCK_TYPES = BLOCK_TYPES.filter((t) => VOCABULARY[t].role !== 'insert')

/** 편집기가 삽입할 수 있는 타입 (§10.2) */
export const INSERT_BLOCK_TYPES = BLOCK_TYPES.filter((t) => VOCABULARY[t].editorInsertable)

export function isBlockType(t: unknown): t is BlockType {
  return typeof t === 'string' && t in VOCABULARY
}

/** layout 값을 그 타입의 허용 목록으로 좁힌다. 무효면 기본(첫 값) */
export function resolveLayout(type: BlockType, layout: unknown): string {
  const allowed = VOCABULARY[type].layouts
  return typeof layout === 'string' && allowed.includes(layout) ? layout : allowed[0]
}

/**
 * `일정`을 담는 타입인가 — `itinerary` 또는 `timeline`.
 * 3차 검증·커버리지가 일정 섹션을 **id가 아니라 type으로** 찾는다(명령서 ⑤).
 */
export function isItineraryType(type: string): boolean {
  return type === 'itinerary' || type === 'timeline'
}

/* ════════════════════════════════════════════════════════════════
 * 3. 게이트 재료 요약 — `block-vocabulary-gate`가 AI에게 넘긴다 (명령서 ⑥)
 * ════════════════════════════════════════════════════════════════ */

export interface GateInfo {
  /** AI가 쓸 수 있는 타입과 그 재료 유무 */
  available: BlockType[]
  /** 재료가 없어 만들면 안 되는 타입 (해당없음·0행) */
  unavailable: BlockType[]
  /** 참조 가능한 spotlight 대상 (`숙박[0]` 등) */
  spotlightRefs: string[]
}

export function gateInfo(cd: ConfirmedData): GateInfo {
  const available: BlockType[] = []
  const unavailable: BlockType[] = []
  for (const t of AI_BLOCK_TYPES) {
    const def = VOCABULARY[t]
    if (def.available && !def.available(cd)) unavailable.push(t)
    else available.push(t)
  }
  const spotlightRefs = [
    ...cd.숙박.map((_, i) => `숙박[${i}]`),
    ...cd.상점.map((_, i) => `상점[${i}]`),
  ]
  return { available, unavailable, spotlightRefs }
}
