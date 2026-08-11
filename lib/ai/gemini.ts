import { GoogleGenAI, FinishReason, ThinkingLevel } from '@google/genai'
import { AI_MAX_TOKENS, AI_TIMEOUT_MS } from '../types'
import type { AiErrorType, AiProvider, AiRequest, AiResult, AiUsage } from './contract'

/**
 * Gemini 구현 (spec §4.3의 Gemini 이식판).
 *
 * 무료 티어는 **flash 계열만** 대상이다. pro 계열은 유료다.
 * 컨텍스트 캐싱은 유료 전용이라 쓰지 않는다 — 비용이 0이라 실질 손해는 없고
 * 지연만 조금 는다.
 */

/**
 * 실측(2026-08-11, page_content 9섹션 스키마 강제) 근거로 고른 값이다.
 *
 *   gemini-3.5-flash  9.8초  (사고 1,425)  ← 채택
 *   gemini-3.6-flash 20.3초  (사고 3,933)
 *
 * 3.6은 25초 예산에 4.7초밖에 남기지 않고, §5.5의 `processing_delayed`
 * 임계값(20초)을 매 생성마다 넘겨 이상 플래그가 상시 뜬다.
 * 품질 차이는 이 작업에서 관측되지 않았다.
 *
 * 한도·과부하로 막히면 `AI_MODEL` 환경 변수로 갈아끼운다.
 */
const DEFAULT_MODEL = 'gemini-3.5-flash'

/** spec §4.3의 effort 대응. 생성은 medium, 검증은 low. */
const THINKING: Record<AiRequest['effort'], ThinkingLevel> = {
  generate: ThinkingLevel.MEDIUM,
  validate: ThinkingLevel.LOW,
}

/** 안전 분류기 계열 종료 사유 — 전부 거부로 본다. */
const REFUSAL_REASONS = new Set<string>([
  FinishReason.SAFETY, FinishReason.RECITATION, FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT, FinishReason.SPII, FinishReason.IMAGE_SAFETY,
])

/**
 * 429 응답에서 **어떤 한도인지**를 뽑아 앞으로 끌어낸다.
 *
 * Gemini의 429 본문은 안내 문구·링크가 300자를 넘게 차지하고, 정작 필요한
 * `quotaId`는 그 뒤에 온다. 메시지를 앞에서 잘라 저장하면 로그에 남는 것은
 * 「한도 초과」뿐이고, **분당 한도인지 일일 한도인지 구분할 수 없다.**
 * 실제로 그 때문에 원인 파악이 늦어졌다 — 기다리면 풀리는 문제로 오해했는데
 * 실제로는 `GenerateRequestsPerDayPerProjectPerModel-FreeTier`(하루 20회)라
 * 대기로는 풀리지 않는 것이었다.
 */
export function quotaSummary(msg: string): string | null {
  const id = /"quotaId":\s*"([^"]+)"/.exec(msg)?.[1]
  const value = /"quotaValue":\s*"?(\d+)"?/.exec(msg)?.[1]
  const metric = /Quota exceeded for metric:\s*([^\s,\\]+)/.exec(msg)?.[1]
  if (!id && !value && !metric) return null

  const per = id?.includes('PerDay') ? '하루' : id?.includes('PerMinute') ? '분당' : null
  return [
    per && value ? `${per} ${value}회 한도` : null,
    id ? `quotaId=${id}` : null,
    metric ? `metric=${metric}` : null,
  ].filter(Boolean).join(' · ')
}

function classify(err: unknown): { type: AiErrorType; detail: string; retryAfterMs?: number } {
  const e = err as { name?: string; message?: string; status?: number }
  const msg = e?.message ?? String(err)

  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /abort|timed? ?out/i.test(msg)) {
    return { type: 'timeout', detail: `25초 타임아웃: ${msg.slice(0, 200)}` }
  }
  const code = Number(msg.match(/"code":\s*(\d+)/)?.[1] ?? e?.status ?? 0)
  if (code === 429) {
    // 제공자가 retryDelay를 주면 그만큼, 없으면 분 경계를 넘기도록 기본 20초 쉰다.
    // ⚠ **일일 한도는 대기로 풀리지 않는다** — 아래 요약이 그 구분을 남긴다.
    const secs = Number(/"retryDelay":\s*"(\d+)s"/.exec(msg)?.[1] ?? 0)
    const quota = quotaSummary(msg)
    return {
      type: 'rate_limited',
      // 판별 정보를 **맨 앞에** 둔다. 뒤에 두면 잘려서 다시 못 읽는다.
      detail: [quota, msg].filter(Boolean).join(' — ').slice(0, 1200),
      retryAfterMs: (secs > 0 ? secs : 20) * 1000,
    }
  }
  return { type: 'api_error', detail: `${code || '?'} ${msg}`.slice(0, 1200) }
}

function readUsage(u: unknown): AiUsage {
  const m = (u ?? {}) as Record<string, number | undefined>
  return {
    inputTokens: m.promptTokenCount ?? null,
    outputTokens: m.candidatesTokenCount ?? null,
    thoughtTokens: m.thoughtsTokenCount ?? null,
    cachedTokens: m.cachedContentTokenCount ?? null,
  }
}

/**
 * ⚠ **`httpOptions.retryOptions`를 넘기지 마라** (§4.2 · A-14).
 *
 * `@google/genai`는 `retryOptions`가 **없으면 재시도하지 않는다**
 * (`apiCall`: `if (!retryOptions) return runFetch()`). 넘기는 순간 p-retry가
 * 켜지고, `attempts`를 생략하면 그때 기본값 **5**가 적용된다 — 재시도 대상에
 * **429가 포함**되므로 한도에 한 번 걸리면 조용히 5번 호출되고 그 5번이 전부
 * **하루 20회 쿼터에서 빠진다.**
 *
 * 타입 문서의 「If not specified, default to 5」는 `retryOptions`를 넘겼을 때
 * `attempts` 필드의 기본값을 말한다. 옵션 자체를 안 넘긴 경우가 아니다.
 *
 * 재시도 판단은 §11.6의 카운터가 하고 재호출은 클라이언트가 한다.
 * 실측: 429 응답에 대해 나가는 HTTP 요청 **1회**(`test:policy` U18).
 */
export function createGeminiProvider(apiKey: string, model = DEFAULT_MODEL): AiProvider {
  const ai = new GoogleGenAI({ apiKey })

  return {
    name: 'gemini',
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
        res = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          config: {
            systemInstruction: req.system,
            // 출력 강제. 프롬프트로 "JSON만 출력"이라 지시하지 않는다(§4.3).
            responseMimeType: 'application/json',
            responseSchema: req.schema,
            maxOutputTokens: AI_MAX_TOKENS,
            thinkingConfig: { thinkingLevel: THINKING[req.effort] },
            // 재시도는 클라이언트가 같은 API를 재호출한다(§4.2).
            // SDK가 자동 재시도하면 25초 예산을 넘긴다.
            abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
          },
        })
      } catch (e) {
        const { type, detail, retryAfterMs } = classify(e)
        return fail(type, detail, null, null, retryAfterMs)
      }

      const usage = readUsage(res.usageMetadata)

      // ── 종료 사유를 **먼저** 확인한다. 거부 시 본문이 비어 있어
      //    무조건 인덱싱하면 예외가 난다(§4.3).
      const blocked = res.promptFeedback?.blockReason
      if (blocked) return fail('refusal', `입력이 차단됐습니다: ${blocked}`, null, usage)

      const finishReason = res.candidates?.[0]?.finishReason ?? null
      if (finishReason && REFUSAL_REASONS.has(finishReason)) {
        return fail('refusal', `종료 사유 ${finishReason}`, finishReason, usage)
      }
      if (finishReason === FinishReason.MAX_TOKENS) {
        return fail('max_tokens', `출력이 ${AI_MAX_TOKENS} 토큰에서 잘렸습니다.`, finishReason, usage)
      }

      const text = res.text
      if (!text) return fail('schema_invalid', '본문이 비어 있습니다.', finishReason, usage)

      let data: T
      try {
        data = JSON.parse(text) as T
      } catch (e) {
        return fail(
          'schema_invalid',
          `JSON 파싱 실패: ${(e as Error).message}. 앞부분: ${text.slice(0, 120)}`,
          finishReason, usage,
        )
      }

      return {
        ok: true, data, usage,
        finishReason: finishReason ?? FinishReason.STOP,
        elapsedMs: Date.now() - startedAt, model,
      }
    },
  }
}
