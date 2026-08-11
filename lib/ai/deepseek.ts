import OpenAI from 'openai'
import { AI_MAX_TOKENS, AI_TIMEOUT_MS } from '../types'
import { toJsonSchema, validateAgainstSchema } from './schema'
import type { AiErrorType, AiProvider, AiRequest, AiResult, AiUsage } from './contract'

/**
 * DeepSeek 구현 — **Gemini의 예비 경로**.
 *
 * Gemini 무료 티어가 일일 한도(429)나 과부하(503)로 막혔을 때 갈아탄다.
 * 쿼터가 완전히 분리되므로 데모 당일 단일 실패점이 사라진다.
 *
 *   AI_PROVIDER=deepseek   # .env.local에 넣으면 즉시 전환
 *   AI_MODEL=...           # 같은 공급자 안에서 모델만 교체
 *
 * API는 OpenAI 호환이라 공식 `openai` SDK를 base URL만 바꿔 쓴다 —
 * 이것이 DeepSeek이 문서화한 방식이며 원시 HTTP를 쓰지 않는다(§4.3).
 *
 * ## ⚠ §4.3 절대 원칙 3의 예외 — 이 파일만 해당한다
 *
 * 「출력은 `responseSchema`로 강제한다. 프롬프트로 "JSON만 출력" 지시 금지」가
 * 원칙이다. 그런데 **DeepSeek에는 `json_schema` strict 모드가 없다** —
 * `json_object`(문법만 JSON 보장)까지만 지원하고, 그 모드는 문서가
 * 「프롬프트에 'json'을 포함하라」고 요구한다. 제공자 쪽 강제가 불가능하다.
 *
 * 그래서 **강제 지점을 우리 쪽으로 옮긴다**:
 *
 *   1. 스키마를 시스템 프롬프트에 붙여 알려준다 (원칙 3의 문구를 어기는 부분)
 *   2. `response_format: json_object`로 JSON 문법을 보장받는다
 *   3. 받은 값을 **`validateAgainstSchema`로 대조**한다 (§4.3의 목적을 지키는 부분)
 *   4. 어긋나면 `schema_invalid` — 기존 재시도 기계가 처리한다(§11.6)
 *
 * 라우트가 받는 것은 여전히 「스키마를 만족하는 데이터」 아니면 「타입이 붙은
 * 실패」뿐이다. **계약의 결과는 Gemini 경로와 같다.** 다른 것은 검사 주체다.
 */

/** OpenAI 호환 엔드포인트. DeepSeek 문서의 `base_url` 값이다. */
const BASE_URL = 'https://api.deepseek.com'

/**
 * 기본 모델. `flash`가 `pro`보다 빠르고 싸며, 이 작업은 25초 예산 안에
 * 끝나야 한다(§4.3). 품질이 부족하면 `AI_MODEL=deepseek-v4-pro`로 올린다.
 */
const DEFAULT_MODEL = 'deepseek-v4-flash'

/**
 * spec §4.3의 effort 대응 — 생성 `medium` / 검증 `low`.
 *
 * `thinking: {type:"enabled"}`도 문서에 있지만 보내지 않는다. 값 조합을
 * 추측해서 400을 맞는 것보다, 문서에 있는 `reasoning_effort`만 쓰고
 * 실측(`npm run probe:deepseek`)으로 확인하는 편이 안전하다.
 */
const EFFORT: Record<AiRequest['effort'], 'low' | 'medium'> = {
  generate: 'medium',
  validate: 'low',
}

function classify(err: unknown): { type: AiErrorType; detail: string; retryAfterMs?: number } {
  const e = err as { name?: string; status?: number; message?: string; headers?: Headers }
  const msg = e?.message ?? String(err)

  if (e?.name === 'APIUserAbortError' || e?.name === 'TimeoutError'
      || /abort|timed? ?out/i.test(msg)) {
    return { type: 'timeout', detail: `25초 타임아웃: ${msg.slice(0, 200)}` }
  }

  const status = e?.status ?? 0
  if (status === 429) {
    const retryAfter = Number(e?.headers?.get?.('retry-after') ?? 0)
    return {
      type: 'rate_limited',
      // 진단 정보가 뒤쪽에 오는 경우가 있어 넉넉히 남긴다 — 잘라서 원인을 놓치면
      // 로그만 보고는 한도 종류(분당·일일)를 알 수 없다.
      detail: msg.slice(0, 1200),
      retryAfterMs: (retryAfter > 0 ? retryAfter : 20) * 1000,
    }
  }
  return { type: 'api_error', detail: `${status || '?'} ${msg.slice(0, 1200)}` }
}

/**
 * `json_object` 모드는 문서가 「프롬프트에 'json'을 포함하고 원하는 형식의
 * 예를 제시하라」고 요구한다. 스키마 자체가 그 형식 명세이므로 그대로 붙인다.
 */
function withSchemaInstruction(system: string, schema: unknown): string {
  return `${system}

────────────────────────────────
출력 형식 (필수)

아래 JSON Schema를 만족하는 **JSON 객체 하나만** 출력한다.
설명·머리말·코드블록 표시를 붙이지 않는다.
\`required\`에 적힌 필드는 반드시 포함한다.

${JSON.stringify(toJsonSchema(schema), null, 2)}`
}

export function createDeepseekProvider(apiKey: string, model = DEFAULT_MODEL): AiProvider {
  const client = new OpenAI({
    apiKey, baseURL: BASE_URL,
    // 재시도는 클라이언트가 같은 API를 재호출한다(§4.2).
    // SDK가 자동 재시도하면 25초 예산을 넘긴다.
    maxRetries: 0,
    timeout: AI_TIMEOUT_MS,
  })

  return {
    name: 'deepseek',
    model,

    async call<T>(req: AiRequest): Promise<AiResult<T>> {
      const startedAt = Date.now()
      const fail = (
        errorType: AiErrorType, detail: string,
        finishReason: string | null = null, usage: AiUsage | null = null,
        retryAfterMs?: number,
      ): AiResult<T> => ({
        ok: false, errorType, detail, finishReason, usage,
        elapsedMs: Date.now() - startedAt, model, retryAfterMs,
      })

      let res
      try {
        res = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: withSchemaInstruction(req.system, req.schema) },
            { role: 'user', content: req.user },
          ],
          max_tokens: AI_MAX_TOKENS,
          reasoning_effort: EFFORT[req.effort],
          // strict 스키마가 없으므로 문법 보장까지만 받고, 구조는 아래에서 검사한다.
          response_format: { type: 'json_object' },
        } as Parameters<typeof client.chat.completions.create>[0])
      } catch (e) {
        const { type, detail, retryAfterMs } = classify(e)
        return fail(type, detail, null, null, retryAfterMs)
      }

      const completion = res as OpenAI.Chat.Completions.ChatCompletion
      const u = completion.usage
      const usage: AiUsage = {
        inputTokens: u?.prompt_tokens ?? null,
        outputTokens: u?.completion_tokens ?? null,
        thoughtTokens: u?.completion_tokens_details?.reasoning_tokens ?? null,
        cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? null,
      }

      // ── 종료 사유를 **먼저** 확인한다 — 거부·절단 시 본문이 비어 있다(§4.3).
      const choice = completion.choices?.[0]
      const finishReason = choice?.finish_reason ?? null
      if (finishReason === 'length') {
        return fail('max_tokens', `출력이 ${AI_MAX_TOKENS} 토큰에서 잘렸습니다.`, finishReason, usage)
      }
      if (finishReason === 'content_filter') {
        return fail('refusal', '안전 필터로 차단됐습니다.', finishReason, usage)
      }

      // 문서가 「json_object 모드에서 드물게 빈 본문이 온다」고 명시한다.
      const text = choice?.message?.content
      if (!text || !text.trim()) {
        return fail('schema_invalid', '본문이 비어 있습니다.', finishReason, usage)
      }

      let data: unknown
      try {
        data = JSON.parse(text)
      } catch (e) {
        return fail('schema_invalid',
          `JSON 파싱 실패: ${(e as Error).message}. 앞부분: ${text.slice(0, 120)}`,
          finishReason, usage)
      }

      // ── 스키마 강제 (§4.3) — 제공자가 못 하므로 여기서 한다.
      const violations = validateAgainstSchema(data, toJsonSchema(req.schema))
      if (violations.length > 0) {
        return fail('schema_invalid',
          `스키마 불일치 ${violations.length}건: ${violations.slice(0, 5).join(' / ')}`,
          finishReason, usage)
      }

      return {
        ok: true, data: data as T, usage,
        finishReason: finishReason ?? 'stop',
        elapsedMs: Date.now() - startedAt, model,
      }
    },
  }
}
