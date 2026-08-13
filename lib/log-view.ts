/**
 * 실행 로그 뷰의 표시 규칙 (§14.3) — **순수 모듈**.
 *
 * 화면 문자열을 컴포넌트 안에 흩어 두지 않는 이유는 §5.4의 규정 하나 때문이다:
 * **표시 문자열을 DB에 저장하지 않는다.** 저장값(영어)과 표시값(한글)의 경계가
 * 한 파일에 모여 있으면, 저장 경로가 한글을 쓰려 할 때 바로 눈에 띈다.
 *
 * `VERDICT_LABEL`은 여기 두지 않는다 — `lib/types.ts`가 이미 단일 출처다.
 */
import {
  APPLICATION_STEPS, LIFECYCLE_STEPS, PIPELINE_STEPS,
  type AbnormalityType, type LogCategory, type LogStep,
} from './types'

/** §14.3 — 탭 3개. `pipeline`이 기본이다. */
export const LOG_TABS: { key: LogCategory; label: string }[] = [
  { key: 'pipeline', label: '파이프라인' },
  { key: 'lifecycle', label: '상태변경' },
  { key: 'application', label: '신청·메일' },
]

export const DEFAULT_TAB: LogCategory = 'pipeline'

/** 임의 문자열을 탭 키로 좁힌다. 모르는 값은 기본 탭으로 떨어뜨린다. */
export function resolveTab(v: unknown): LogCategory {
  return LOG_TABS.some((t) => t.key === v) ? (v as LogCategory) : DEFAULT_TAB
}

/**
 * 단계명 한글 표기. §5.4의 `step` 목록과 **1:1**이다.
 *
 * 저장값을 그대로 쓰지 않고 표기를 붙이는 이유는 로그를 사람이 읽기 때문이다 —
 * 21개 영어 식별자만 놓인 표는 읽는 데 시간이 든다.
 * 식별자는 같은 칸에 함께 남긴다(로그를 근거로 대화하려면 원값이 필요하다).
 */
export const STEP_LABEL: Record<LogStep, string> = {
  // pipeline (§8·§9·§15.3)
  pipeline_started: '파이프라인 시작',
  itinerary_decomposed: '일차 분해',
  normalization_validated: '0차 검증',
  brochure_generated: '소개서 생성',
  validation_1_completed: '1차 검증',
  page_generated: '페이지 생성',
  validation_2_completed: '2차 검증',
  validation_3_completed: '3차 검증',
  draft_registered: '임시저장 등록',
  regenerate_requested: '다시 생성 요청',
  form_input_resubmitted: '입력 재제출',
  // lifecycle (§10·§12)
  content_edited: '편집 저장',
  slug_changed: 'slug 변경',
  published: '게시',
  unpublished: '게시 중단',
  publish_override: '책임 게시',
  product_deleted: '상품 삭제',
  // application (§13·§12.4)
  application_received: '신청 접수',
  email_sent: '메일 발송',
  email_resent: '메일 재발송',
  application_deleted: '신청 삭제',
}

/** 이상 5종 (§5.5). 감지 조건은 `lib/logging.ts`가 단일 출처다. */
export const ABNORMALITY_LABEL: Record<AbnormalityType, string> = {
  retry_accumulated: '재시도 누적',
  pipeline_aborted: '중단 확정',
  validation_repeated_failure: '검증 반복 실패',
  processing_delayed: '처리 지연',
  itinerary_partial: '일정 부분 채움',
}

/** 탭별 단계 목록. 화면에서 「이 탭에 뭐가 올 수 있나」를 보여줄 때 쓴다. */
export const STEPS_BY_CATEGORY: Record<LogCategory, readonly string[]> = {
  pipeline: PIPELINE_STEPS,
  lifecycle: LIFECYCLE_STEPS,
  application: APPLICATION_STEPS,
}

/**
 * 타임스탬프를 UTC ISO 8601로 표기한다(§14.3). 빈 값은 `-`.
 *
 * 지역 시간대로 바꾸지 않는다 — 로그는 여러 사람이 같은 문자열을 보고
 * 대조하는 용도이고, 표시 시점의 시간대에 따라 값이 달라지면 대조가 깨진다.
 * `created_at`은 이미 UTC로 저장돼 있으므로(§5.4) 형식만 통일한다.
 */
export function utcStamp(v: string | null | undefined): string {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toISOString()
}

/**
 * `input`·`output` 표기. **가공·요약하지 않는다**(§14.3).
 *
 * 길이로 자르지도 않는다 — 자른 JSON은 원본이 아니고, 잘린 자리에 무엇이
 * 있었는지 화면에서 알 수 없다. 접기(`<details>`)로 지면만 아낀다.
 */
export function rawJson(v: unknown): string {
  if (v === null || v === undefined) return '-'
  return JSON.stringify(v, null, 2)
}
