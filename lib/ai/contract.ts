/**
 * AI 호출 계약 — **provider 중립** (spec §4.3).
 *
 * 라우트는 이 인터페이스만 알고, 실제 provider는 `lib/ai/index.ts`가 고른다.
 * 모델을 바꿔도 파이프라인 6개 라우트는 손대지 않는다.
 *
 * 계약의 핵심 3가지는 provider가 바뀌어도 유지된다:
 *   1. 요청 1건은 AI를 **최대 1회** 호출한다 (§4.2)
 *   2. 출력은 **JSON 스키마로 강제**한다. 프롬프트로 "JSON만 출력"이라 지시하지 않는다
 *   3. **종료 사유를 먼저 확인한 뒤** 본문을 읽는다 — 거부 시 본문이 비어 있다
 */

/** 사고 깊이. spec §4.3의 effort 생성 `medium` / 검증 `low`에 대응한다. */
export type Effort = 'generate' | 'validate'

export interface AiRequest {
  /**
   * 시스템 프롬프트. 섹션 규칙·금지 사항·무결성 규칙이 들어간다.
   * 요청 간 **바이트 단위로 동일**해야 하므로 날짜·product_id·타임스탬프를
   * 넣지 않는다 — 가변 데이터는 `user`에 넣는다.
   */
  system: string
  /** 가변 입력 (confirmed_data·form_input 등) */
  user: string
  /** 출력 강제용 JSON 스키마 */
  schema: Record<string, unknown>
  effort: Effort
  /** 로그·플래그에 남길 단계 이름 */
  label: string
}

export interface AiUsage {
  inputTokens: number | null
  outputTokens: number | null
  thoughtTokens: number | null
  cachedTokens: number | null
}

/**
 * §4.3의 실패 표. **전부 "생성 실패"로 취급**하며 해당 단계의 카운터를 올리고
 * 409 retry를 반환한다. 원인 구분은 `execution_logs.output`에만 남는다.
 */
export type AiErrorType =
  | 'timeout'        // 25초 초과
  | 'rate_limited'   // 429 — 무료 티어에서 가장 흔하다
  | 'api_error'      // 5xx·네트워크·인증
  | 'max_tokens'     // 출력 절단
  | 'refusal'        // 안전 분류기 거부
  | 'schema_invalid' // 스키마 강제에도 파싱·검증 실패

export type AiResult<T> =
  | {
      ok: true
      data: T
      finishReason: string
      usage: AiUsage
      elapsedMs: number
      model: string
    }
  | {
      ok: false
      errorType: AiErrorType
      detail: string
      /** 종료 사유가 있으면 함께 남긴다 (§4.3 — output에 기록) */
      finishReason: string | null
      usage: AiUsage | null
      elapsedMs: number
      model: string
      /**
       * 429일 때 제공자가 알려준 대기 시간. 클라이언트가 이만큼 쉬었다가
       * 재호출한다 — 즉시 재시도하면 재시도 예산만 태우고 전부 실패한다.
       */
      retryAfterMs?: number
    }

export interface AiProvider {
  readonly name: string
  readonly model: string
  call<T>(req: AiRequest): Promise<AiResult<T>>
}

/** `execution_logs.output`에 남길 형태 (§4.3). */
export function toLogOutput(r: AiResult<unknown>): Record<string, unknown> {
  return r.ok
    ? {
        finish_reason: r.finishReason, usage: r.usage,
        elapsed_ms: r.elapsedMs, model: r.model,
      }
    : {
        error_type: r.errorType, detail: r.detail, finish_reason: r.finishReason,
        usage: r.usage, elapsed_ms: r.elapsedMs, model: r.model,
      }
}

/** 사람이 읽을 실패 사유. 검증 항목(`items`)의 사유 칸에 그대로 들어간다. */
export const ERROR_LABEL: Record<AiErrorType, string> = {
  timeout: 'AI 응답이 25초 안에 오지 않았습니다.',
  rate_limited: 'AI 호출 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.',
  api_error: 'AI 호출이 실패했습니다.',
  max_tokens: 'AI 출력이 최대 길이에서 잘렸습니다.',
  refusal: 'AI가 요청을 거부했습니다.',
  schema_invalid: 'AI 출력이 요구한 JSON 구조를 벗어났습니다.',
}
