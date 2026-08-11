/**
 * spec.md 2.4의 열거값·구조를 타입으로 고정한다.
 * 값의 단일 출처는 spec이며, 여기서 임의로 늘리거나 줄이지 않는다.
 */

// ── 상태 (§5.1 · §15.1) ─────────────────────────────────────────
export const PRODUCT_STATUSES = [
  'generating', 'input_error', 'brochure_ready',
  'draft', 'reviewing', 'published', 'unpublished',
] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

/** `/p/{slug}`가 200을 반환하는 유일한 상태 (§4.1) */
export const PUBLIC_STATUS: ProductStatus = 'published'

// ── 파이프라인 진행 지점 (§15.1.1) ──────────────────────────────
export const CURRENT_STEPS = [
  'pipeline_started', 'normalization_validated', 'brochure_generated',
  'validation_1_completed', 'page_generated', 'validation_2_completed',
  'validation_3_completed', 'draft_registered',
] as const
export type CurrentStep = (typeof CURRENT_STEPS)[number]

// ── 로그 (§5.4) ────────────────────────────────────────────────
export type LogCategory = 'pipeline' | 'lifecycle' | 'application'

export const PIPELINE_STEPS = [
  'pipeline_started', 'itinerary_decomposed', 'normalization_validated',
  'brochure_generated', 'validation_1_completed', 'page_generated',
  'validation_2_completed', 'validation_3_completed', 'draft_registered',
  'regenerate_requested', 'form_input_resubmitted',
] as const
export const LIFECYCLE_STEPS = [
  'content_edited', 'slug_changed', 'published',
  'unpublished', 'publish_override', 'product_deleted',
] as const
export const APPLICATION_STEPS = [
  'application_received', 'email_sent', 'email_resent', 'application_deleted',
] as const
export type LogStep =
  | (typeof PIPELINE_STEPS)[number]
  | (typeof LIFECYCLE_STEPS)[number]
  | (typeof APPLICATION_STEPS)[number]

/**
 * 저장값은 영어다. 화면에서만 통과/반려/-로 표시한다(§5.4·§14.3).
 * 2.2의 한글 저장은 폐기됐다.
 */
export type Verdict = 'pass' | 'fail' | '-'

/** 화면 표시용 변환. DB에는 절대 이 값을 넣지 않는다. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: '통과', fail: '반려', '-': '-',
}

// ── 재시도 카운터 (§11.6) ───────────────────────────────────────
/** 4종이다. 0차는 brochure와 예산을 공유하지 않는다 — 2.2의 3종은 폐기됐다. */
export const RETRY_COUNTERS = ['normalization', 'brochure', 'page', 'consistency'] as const
export type RetryCounter = (typeof RETRY_COUNTERS)[number]
export type RetryCounts = Record<RetryCounter, number>

/** 각 카운터 상한 2회(총 3회 시도). 카운터끼리 예산을 공유하지 않는다. */
export const RETRY_LIMIT = 2

// ── 이상 플래그 (§5.5) ──────────────────────────────────────────
export const ABNORMALITY_TYPES = [
  'retry_accumulated', 'pipeline_aborted', 'validation_repeated_failure',
  'processing_delayed', 'itinerary_partial',
] as const
export type AbnormalityType = (typeof ABNORMALITY_TYPES)[number]

// ── AI 호출 계약 (§4.3) ─────────────────────────────────────────
/**
 * 모델 이름은 **여기에 두지 않는다.** spec 2.5에서 공급자가
 * `gemini-3.5-flash` 무료 티어로 바뀌었고, 라우트는 `lib/ai`의 provider 중립
 * 인터페이스만 호출한다 — 기본 모델은 각 공급자 모듈이, 교체는 `AI_MODEL`
 * 환경 변수가 담당한다. 2.4까지 있던 `AI_MODEL = 'claude-opus-5'` 상수는
 * 아무도 읽지 않으면서 「모델이 여기 적혀 있다」는 오해만 남겨 폐기했다.
 */
export const AI_MAX_TOKENS = 8000
export const AI_TIMEOUT_MS = 25_000
/** 지연 감지 임계값 = AI 타임아웃의 80% (§5.5) */
export const DELAY_THRESHOLD_MS = 20_000

// ── 응답 코드 규약 (§14.6) ──────────────────────────────────────
/**
 * 409는 reason 없이 반환하지 않는다.
 * reason이 없으면 클라이언트가 전부 "재호출하라"로 해석해 무한 반복한다.
 */
export type ConflictReason =
  | 'retry'                  // 재시도 여력 있음 → retry_from부터 재호출
  | 'precondition'           // 시작 조건 미충족 → 재호출 금지, 재조회
  | 'stale'                  // updated_at 불일치 → 재조회 후 사용자에게 알림
  | 'slug_conflict'          // slug 중복 → 다른 slug로 재요청
  | 'product_not_published'  // 신청 대상이 published 아님

/** retry_from은 §14.4 표의 라우트 번호다. */
export type RetryFrom = 2 | 3 | 5

// ── 검증 (§11.3) ────────────────────────────────────────────────
export interface ValidationItem {
  검증영역: string
  source경로: string | null
  기준값: string
  발견값: string
  사유: string
  위치: string
}

export interface AxisResult {
  verdict: Exclude<Verdict, '-'>
  items: ValidationItem[]
  /** 3차 전용. 항상 ["apply"] (§11.1) */
  skipped?: string[]
}

export type AxisName = 'axis_0' | 'axis_1' | 'axis_2' | 'axis_3'

export interface ValidationSnapshot {
  attempt_no: number
  /** 완료된 전 축이 통과했을 때만 pass. 미실행 축(null)은 계산에서 제외한다. */
  verdict: Exclude<Verdict, '-'>
  validated_at: string
  content_hash: string | null
  axes: Record<AxisName, AxisResult | null>
}

// ── form_input (§7.4) ───────────────────────────────────────────
/**
 * 최상위 키 6개, 값은 전부 문자열. 점 표기 중첩 구조다.
 * 평면 키(`행사명`)나 밑줄 표기(`가격_성인`)를 쓰지 않는다.
 * 여행기간은 시작·종료 2필드이며, 결합은 confirmed_data에서만 일어난다(§6.2.1).
 */
export interface FormInput {
  행사정보: {
    행사명: string
    여행지: string
    여행기간_시작: string
    여행기간_종료: string
    일정원문: string
    타겟층: string
    여행스타일: string
  }
  숙박: { 숙소명: string; 객실타입: string; 위치: string; 숙박일정: string }
  상점: { 상점명: string; 상점정보: string }
  가격: { 성인: string; 아동: string; 기타: string }
  식사: { 식사정보: string }
  항공편: { 공항: string; 항공사: string; 편명: string; 출발시간: string; 도착시간: string }
}

// ── 이미지 슬롯 (§7.3) ──────────────────────────────────────────
export type ImageSlot = 'hero' | 'accommodation' | 'shop' | `itinerary_day_${number}`
export const SLOT_LIMITS = { hero: 1, accommodation: 3, shop: 2, itinerary_day: 1 } as const

// ── 여행기간 (§6.2.1) ───────────────────────────────────────────
export const TRIP_DAYS_MIN = 1
export const TRIP_DAYS_MAX = 15

// ── products 행 ─────────────────────────────────────────────────
export interface ProductRow {
  id: string
  execution_id: string
  attempt_no: number
  slug: string | null
  status: ProductStatus
  current_step: CurrentStep
  form_input: FormInput
  confirmed_data: unknown | null
  brochure_content: unknown | null
  page_content: unknown | null
  validation_snapshot: ValidationSnapshot | null
  retry_counts: RetryCounts
  human_edited: boolean
  publish_override_at: string | null
  failure_reason: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}
