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
 * 모델 이름은 **여기에 두지 않는다.** spec 2.6에서 주 공급자가
 * `deepseek-v4-flash`로 바뀌었고(Gemini는 예비), 라우트는 `lib/ai`의 provider
 * 중립 인터페이스만 호출한다 — 기본 모델은 각 공급자 모듈이, 교체는 `AI_MODEL`
 * 환경 변수가 담당한다. 2.4까지 있던 `AI_MODEL = 'claude-opus-5'` 상수는
 * 아무도 읽지 않으면서 「모델이 여기 적혀 있다」는 오해만 남겨 폐기했다.
 * 공급자가 두 번 바뀌는 동안 이 파일이 한 번도 안 바뀐 것이 그 판단의 근거다.
 */
export const AI_MAX_TOKENS = 8000

/**
 * 요청 1건의 AI 타임아웃 (§4.3).
 *
 * ## 25초 → 40초 (2.7 · 실측 근거)
 *
 * 진짜 상한은 `maxDuration` 60초이고 25초는 그 안에서 임의로 고른 값이었다.
 * 2.6까지는 SDK 옵션만 걸려 있어 **이 값이 실제로 걸리지 않았고**(58.2초 호출 관측),
 * 요청마다 `AbortSignal`을 거는 것으로 고치자 실측이 경계에 걸치는 것이 드러났다.
 *
 * | 호출 | 관측 |
 * |---|---|
 * | 일차 분해 | 19.2 · 21.9 · **25.6+(타임아웃)** |
 * | 페이지 확장 | 11.9 · **25.1** |
 *
 * 분해가 3회 연속 타임아웃해 **422로 죽는 것을 두 번 관측했다.** 40초면 여유가
 * 20초 남아 `maxDuration`을 위협하지 않는다 — 넘겨도 플랫폼이 아니라 우리가
 * 끊으므로 409·재시도 경로가 살아 있다(§11.6).
 *
 * ## 40초 → 55초 (2026-08-13 · DeepSeek 라이브 재실측 근거)
 *
 * 차단 해제 후 실측에서 분해가 **45~47초로 40초를 상습적으로 넘겼다** — `test:cases`
 * 골든 스위트에서 G01 39.5초(턱걸이 통과) · G02 46·47·47초(3회 초과 → 422 실패) ·
 * G03 45.9초(재시도 후 통과). 40초는 DeepSeek 분해 지연 분포(19~47초)의 중앙보다
 * 위였을 뿐 상한을 못 덮었다. 55초면 관측 최대 47초에 8초 여유가 있고 `maxDuration`
 * 60초 안이다. 넘는 호출은 여전히 우리가 끊어 409·재시도가 산다.
 *
 * ## env로 조정 가능 (2026-08-13 · spec 2.8 page 생성이 무거워짐)
 *
 * 2.8에서 `content-structuring`(AI가 디자인 스펙+구성을 짬)이 무거워져 50초대까지
 * 관측됐다. `maxDuration`(플랫폼 상한)이 60초인 한 이 값은 그 아래여야 하므로
 * **55초가 사실상의 천장이다** — 라우트의 나머지(DB·로그·응답)에 5초를 남긴다.
 * 더 기다리려면 `maxDuration`부터 올려야 한다(Vercel Pro면 가능). 그 경우:
 *   `AI_TIMEOUT_SECONDS`(env)로 타임아웃을, 각 라우트의 `export const maxDuration`
 *   리터럴을 함께 올린다. 여기서는 env 오버라이드만 제공하고, 미설정 시 55초다.
 * 근본 해법은 이 값을 늘리는 것이 아니라 **AI 호출을 가볍게** 하는 것이다 —
 * 관대한 스키마·자동 보강으로 재시도 소진을 없앤 것이 그 방향이다(ai-contracts·page.ts).
 */
const _timeoutEnv = Number(process.env.AI_TIMEOUT_SECONDS)
export const AI_TIMEOUT_MS =
  Number.isFinite(_timeoutEnv) && _timeoutEnv > 0 ? Math.round(_timeoutEnv * 1000) : 55_000

/**
 * 지연 감지 임계값 (§5.5).
 *
 * **타임아웃과 연동하지 않는다.** 2.6까지는 「타임아웃의 80%」였지만, 이 값의
 * 목적은 「사람이 느끼는 지연을 기록에 남기는 것」이고 그 기준은 타임아웃이
 * 얼마든 20초다. 타임아웃을 40초로 올리면서 함께 32초로 올리면 분해·확장이
 * 더 이상 플래그를 남기지 않는데, 그 플래그는 **없애야 할 값이 아니라 시연에서
 * 보여주는 관측치**다(§20).
 */
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

/**
 * retry_from은 §14.4 표의 라우트 번호다.
 *
 * `20`은 자연어 초안(§7.5)이며 **복귀 대상이 자기 자신이다** — 상품 행이 없어
 * 되돌아갈 앞 단계가 없고, 클라이언트가 같은 요청을 다시 보내는 것이 재시도의
 * 전부다. 카운터도 없으므로 소진 개념이 없다.
 */
export type RetryFrom = 2 | 3 | 5 | 20

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
 * 숙박 행 1건 (§6.1 · 객체 배열).
 *
 * 한 상품이 숙소를 옮겨 다니는 것은 예외가 아니라 일반이다. 단일 객체로 두면
 * 두 번째 숙소가 문자열 한 칸에 병기되어 구조가 사라진다.
 */
export interface Stay {
  /** 필수 2~60자 */
  숙소명: string
  /** 필수 1~60자 */
  위치: string
  /** 선택 — 미입력 시 `confirmed_data`에서 `추후 추가 예정`으로 채운다(§7.2) */
  객실타입: string
  /** 선택 — 예: `1~2박` */
  숙박일정: string
}

/** `상점.구분` 2종 (§6.1). 폼 select의 기본값이 `추천`이라 빈 값이 없다 */
export const SHOP_KINDS = ['추천', '제휴'] as const
export type ShopKind = (typeof SHOP_KINDS)[number]

/**
 * 상점 행 1건 (§6.1 · 객체 배열).
 *
 * 카페·음식점을 열 곳 넘게 안내하는 상품이 일반이다. `상점정보` 한 칸(500자)에
 * 목록을 밀어 넣으면 상한에 걸리는 순간 값을 잘라야 하고, 그것은 §16.1 위반이다.
 */
export interface Shop {
  /** 필수 1~80자 */
  상점명: string
  /**
   * 필수 · `추천`이 기본값이다. **AI가 `제휴`로 올리지 않는다**(§6.1) —
   * 없는 제휴 관계를 만드는 일이다.
   */
  구분: string
  /** 선택 — 주소. 최대 60자 */
  위치: string
  /** 선택 — 최대 500자 */
  상점정보: string
}

/**
 * 최상위 키 6개, 값은 전부 문자열. 점 표기 중첩 구조다.
 * 평면 키(`행사명`)나 밑줄 표기(`가격_성인`)를 쓰지 않는다.
 * 여행기간은 시작·종료 2필드이며, 결합은 confirmed_data에서만 일어난다(§6.2.1).
 *
 * `숙박`·`상점`은 **객체 배열**이며 1건 이상이다(§7.4). 원소의 `source` 경로는
 * 인덱스를 붙여 `숙박[0].숙소명`으로 적고, **입력 순서를 보존한다** — 순서가
 * 흔들리면 경로가 다른 원소를 가리켜 1·2·3차가 전부 어긋난다.
 */
export interface FormInput {
  행사정보: {
    행사명: string
    여행지: string
    /**
     * 행사 자체의 기간 (선택 · 2026-08-13 신설). 축제·행사의 날짜는 실제 여행
     * 기간과 다를 수 있다 — 제주올레걷기축제(11.05~11.07)를 11.04~11.08 일정으로
     * 간다. **여행 일수·일정을 정하는 것은 `여행기간`이고, 이 필드는 행사 자체의
     * 날짜다.** 시작·종료 2필드이며 결합은 confirmed_data에서만 일어난다.
     *
     * 고객에게 **표시되는 값 필드**이지만 선택이다 — 둘 다 비면 페이지에 나오지
     * 않는다(빈 문자열). 한쪽만 채우면 관문에서 400이다(§7.1과 같은 짝 규칙).
     */
    행사기간_시작: string
    행사기간_종료: string
    여행기간_시작: string
    여행기간_종료: string
    일정원문: string
    타겟층: string
    /** 테마 결정용 — §9.4 매핑표의 6종 중 하나. 문구를 바꾸지 않는다 */
    여행스타일: string
    /**
     * 상품의 주제 서술 (선택). `여행스타일`이 6종 단일 선택이라
     * 「걷기 + 맛집 + 휴식」처럼 **복합 주제를 표현할 수 없어서** 분리했다.
     * 테마는 `여행스타일`이 정하고, 주제 문구는 이 필드가 담는다.
     *
     * 고객에게 **표시되는 값 필드**다 — `source`를 가지며 1·2차 검증 대상이다.
     */
    여행주제: string
    /**
     * 기획 메모 (선택) — **고객에게 표시되지 않는다.**
     *
     * 페르소나·기획 의도처럼 「어떤 어조로 써야 하는가」의 재료다.
     * 사실정보가 아니므로 어느 섹션에도 들어가지 않고 `source`도 갖지 않는다.
     * AI에게는 참고 맥락으로만 전달하며 인용을 금지한다(§8.3·§9.5).
     *
     * 미입력 시 `추후 추가 예정`으로 채우지 않는다 — 그 표기는 고객에게
     * 보이는 빈칸을 메우기 위한 것이고(§6.1), 이 필드는 애초에 보이지 않는다.
     */
    기획메모: string
  }
  /** 1건 이상. 0건은 필수 폼 그룹 미충족이므로 400이다(§7.4) */
  숙박: Stay[]
  /** 1건 이상 */
  상점: Shop[]
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

// ── applications 행 (§5.3) ──────────────────────────────────────
/**
 * 신청 시점 상품 스냅샷(§13.2 3항). 이메일 본문은 **이것만 읽는다** —
 * 현재 상품 값을 다시 읽으면 게시 후 가격이 수정됐을 때 이미 발송한 메일과
 * 어긋나고, 그 불일치가 분쟁의 근거가 된다(§13.3).
 *
 * `여행지`가 §13.2의 괄호 목록에 없지만 여기 있는 이유: §13.3의 본문 구성이
 * 여행지를 요구하고 「현재 상품 값을 다시 읽지 않는다」고 못 박았으므로,
 * 스냅샷에 없으면 본문에 넣을 방법 자체가 없다.
 */
export interface ProductSnapshot {
  행사명: string
  여행지: string
  /** 결합값 `{시작} ~ {종료}` (§6.2.1). 2필드로 쪼개 두지 않는다 */
  여행기간: string
  숙소명: string
  가격: { 성인: string; 아동: string }
  /** `{SITE_URL}/p/{slug}` — 메일에서 열려야 하므로 절대 URL이다(§13.3) */
  url: string
}

export type EmailStatus = 'pending' | 'sent' | 'failed'

export interface ApplicationRow {
  id: string
  product_id: string
  name: string
  email: string
  phone: string
  headcount: number
  consent_at: string
  product_snapshot: ProductSnapshot
  email_status: EmailStatus
  email_error: string | null
  created_at: string
}
