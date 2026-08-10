import OpenAI from 'openai'
import { AI_MAX_TOKENS, AI_TIMEOUT_MS } from '../types'
import type { AiErrorType, AiProvider, AiRequest, AiResult, AiUsage } from './contract'

/**
 * Upstage Solar 구현 — **Gemini의 예비 경로**.
 *
 * Gemini 무료 티어가 분당 한도(429)나 과부하(503)로 막혔을 때 갈아탄다.
 * 쿼터가 완전히 분리되므로 데모 당일 단일 실패점이 사라진다.
 *
 * API는 OpenAI 호환이라 공식 `openai` SDK를 base URL만 바꿔 쓴다 —
 * 이것이 Upstage가 문서화한 방식이며 원시 HTTP를 쓰지 않는다(§4.3).
 *
 * 구조화 출력은 `response_format: { type: 'json_schema' }`로 강제한다.
 * 프롬프트로 "JSON만 출력"이라 지시하지 않는다는 §4.3 계약이 그대로 유지된다.
 */

const BASE_URL = 'https://api.upstage.ai/v1'
const DEFAULT_MODEL = 'solar-pro4'

/**
 * spec §4.3의 effort 대응. Gemini의 ThinkingLevel MEDIUM/LOW에 해당하는
 * 개념이 없으므로 `reasoning_effort`로 매핑한다.
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
      type: 'rate_limited', detail: msg.slice(0, 300),
      retryAfterMs: (retryAfter > 0 ? retryAfter : 20) * 1000,
    }
  }
  return { type: 'api_error', detail: `${status || '?'} ${msg.slice(0, 300)}` }
}

/**
 * Gemini의 `Type.OBJECT` 스키마를 OpenAI json_schema 형식으로 옮긴다.
 * 두 형식은 모두 JSON Schema 기반이지만 타입 표기가 대문자/소문자로 다르다.
 * 그리고 strict 모드는 모든 객체에 `additionalProperties: false`를 요구한다.
 */
function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema)
  if (!node || typeof node !== 'object') return node

  const src = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) {
    out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v)
  }
  if (out.type === 'object') {
    out.additionalProperties = false
    // strict 모드는 properties의 모든 키가 required여야 한다.
    if (out.properties && typeof out.properties === 'object') {
      out.required = Object.keys(out.properties as object)
    }
  }
  return out
}

export function createSolarProvider(apiKey: string, model = DEFAULT_MODEL): AiProvider {
  const client = new OpenAI({
    apiKey, baseURL: BASE_URL,
    // 재시도는 클라이언트가 같은 API를 재호출한다(§4.2).
    maxRetries: 0,
    timeout: AI_TIMEOUT_MS,
  })

  return {
    name: 'solar',
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
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          max_tokens: AI_MAX_TOKENS,
          reasoning_effort: EFFORT[req.effort],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: req.label.replace(/[^a-zA-Z0-9_-]/g, '_'),
              strict: true,
              schema: toJsonSchema(req.schema) as Record<string, unknown>,
            },
          },
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

      // 종료 사유를 **먼저** 확인한다 — 거부·절단 시 본문이 비어 있다(§4.3).
      const choice = completion.choices?.[0]
      const finishReason = choice?.finish_reason ?? null
      if (finishReason === 'length') {
        return fail('max_tokens', `출력이 ${AI_MAX_TOKENS} 토큰에서 잘렸습니다.`, finishReason, usage)
      }
      if (finishReason === 'content_filter') {
        return fail('refusal', '안전 필터로 차단됐습니다.', finishReason, usage)
      }

      const text = choice?.message?.content
      if (!text) return fail('schema_invalid', '본문이 비어 있습니다.', finishReason, usage)

      let data: T
      try {
        data = JSON.parse(text) as T
      } catch (e) {
        return fail('schema_invalid',
          `JSON 파싱 실패: ${(e as Error).message}. 앞부분: ${text.slice(0, 120)}`,
          finishReason, usage)
      }

      return {
        ok: true, data, usage,
        finishReason: finishReason ?? 'stop',
        elapsedMs: Date.now() - startedAt, model,
      }
    },
  }
}
