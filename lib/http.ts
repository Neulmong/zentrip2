import { NextResponse } from 'next/server'
import type { ConflictReason, RetryFrom, ValidationItem } from './types'

/**
 * spec §14.6 — 응답 코드 규약. `202`는 사용하지 않는다(§4.2).
 *
 * 409는 **`reason` 없이 반환할 수 없다.** 타입이 그것을 강제한다 —
 * reason이 없으면 클라이언트가 전부 "재호출하라"로 해석해 무한 반복한다.
 */

export interface StepResultBody {
  current_step: string
  axes?: unknown
  items?: ValidationItem[]
  [k: string]: unknown
}

/** 200 — 단계 완료. 검증 `fail` 확정도 여기에 포함된다. */
export function ok(body: StepResultBody) {
  return NextResponse.json(body, { status: 200 })
}

/** 400 — 입력 규칙 위반. 클라이언트는 필드별 오류를 표시한다. */
export function badRequest(field_errors: Record<string, string>) {
  return NextResponse.json({ field_errors }, { status: 400 })
}

/** 403 — 게시 게이트 미통과(§11.5). */
export function forbidden(reason: string) {
  return NextResponse.json({ reason }, { status: 403 })
}

/** 422 — 입력 문제로 중단(`input_error`). 클라이언트는 폼으로 이동한다. */
export function unprocessable(failure_reason: string) {
  return NextResponse.json({ failure_reason }, { status: 422 })
}

type ConflictExtra =
  /** 재시도 여력 있음 — retry_from이 지정한 라우트부터 재호출(§14.6) */
  | {
      reason: 'retry'; retry_from: RetryFrom; items?: ValidationItem[]
      /** 429 등으로 대기가 필요할 때. 클라이언트는 이만큼 쉬었다가 재호출한다 */
      retry_after_ms?: number
    }
  /** 시작 조건 미충족 — 재호출 금지. GET으로 재조회 후 화면 갱신 */
  | { reason: 'precondition'; detail?: string }
  /** updated_at 불일치 — 재조회 후 사용자에게 알림. 자동 재시도 금지 */
  | { reason: 'stale' }
  /** slug 중복 — 다른 slug로 재요청 */
  | { reason: 'slug_conflict' }
  /** 신청 대상이 published 아님 — 신청 폼을 닫고 안내 */
  | { reason: 'product_not_published' }

/**
 * 409. `reason`이 판별 유니온이라 누락하면 컴파일이 되지 않는다.
 * `retry`는 `retry_from`을 함께 요구한다 — §11.6의 복귀 대상과 항상 일치해야 한다.
 */
export function conflict(extra: ConflictExtra) {
  return NextResponse.json(extra, { status: 409 })
}

/** 어느 reason으로도 분류되지 않는 서버 오류. 클라이언트는 재호출하지 않는다. */
export function serverError(message: string) {
  return NextResponse.json({ error: 'internal', message }, { status: 500 })
}

export const conflictReasons: readonly ConflictReason[] = [
  'retry', 'precondition', 'stale', 'slug_conflict', 'product_not_published',
]
