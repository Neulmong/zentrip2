import OpenAI from 'openai'
import { AI_MAX_TOKENS, AI_TIMEOUT_MS } from '../types'
import { toJsonSchema, validateAgainstSchema } from './schema'
import type { AiErrorType, AiProvider, AiRequest, AiResult, AiUsage } from './contract'

/**
 * DeepSeek 구현 — **주 공급자** (§4.3).
 *
 * Gemini 무료 티어는 모델당 하루 20회라 §20 대본(AI 6회)을 3번 돌리면
 * 소진되고 대기로 회복되지 않는다. 잔량이 예측 가능한 쪽을 기본으로 두는 편이
 * 데모 당일 안전하므로 DeepSeek을 주 경로로, Gemini를 예비로 둔다.
 *
 *   (기본값)               # 아무것도 안 넣으면 이 경로
 *   AI_PROVIDER=gemini     # 예비 경로로 되돌린다
 *   AI_MODEL=...           # 같은 공급자 안에서 모델만 교체 (flash 계열만)
 *
 * API는 OpenAI 호환이라 공식 `openai` SDK를 base URL만 바꿔 쓴다 —
 * 이것이 DeepSeek이 문서화한 방식이며 원시 HTTP를 쓰지 않는다(§4.3).
 *
 * ## 출력 강제는 **우리 쪽에서** 한다 (§4.3)
 *
 * 원칙은 「출력을 스키마로 강제한다. 프롬프트로 "JSON만 출력"이라 지시하지
 * 않는다」이고, 그 목적은 **어긋난 구조가 파이프라인에 못 들어오게 하는 것**이다.
 * DeepSeek에는 `json_schema` strict 모드가 없다 — `json_object`(문법만 JSON 보장)
 * 까지만 지원하고, 그 모드는 문서가 「프롬프트에 'json'을 포함하라」고 요구한다.
 * 제공자 쪽 강제라는 **수단**이 없으므로 강제 지점을 우리 쪽으로 옮긴다:
 *
 *   1. 스키마를 시스템 프롬프트에 붙여 알려준다
 *   2. `response_format: json_object`로 JSON 문법을 보장받는다
 *   3. 받은 값을 **`validateAgainstSchema`로 대조**한다  ← 진짜 관문
 *   4. 어긋나면 `schema_invalid` — 기존 재시도 기계가 처리한다(§11.6)
 *
 * 주 경로가 여기로 옮겨졌으므로 **`lib/ai/schema.ts`가 이제 상시 관문이다.**
 * 예비 경로(Gemini)에서만 `responseSchema`가 제공자 쪽에서 같은 일을 한다.
 * 라우트가 받는 것은 양쪽 모두 「스키마를 만족하는 데이터」 아니면 「타입이 붙은
 * 실패」뿐이다 — 계약의 결과는 같고, 다른 것은 검사 주체다.
 */

/** OpenAI 호환 엔드포인트. DeepSeek 문서의 `base_url` 값이다. */
const BASE_URL = 'https://api.deepseek.com'

/**
 * 기본 모델. **이 프로젝트가 쓰는 유일한 모델이다.**
 *
 * `pro` 계열은 쓰지 않는다 — 품질이 부족해서가 아니라 **쓰지 않기로 확정된
 * 제약**이다(§4.3). 예산·비용·산출물 품질 전부 flash로 성립하는 것을
 * 실측으로 확인했으므로, 느려 보인다는 이유로 pro로 올리는 선택지를 아예
 * 코드에서 없앤다. 아래 `assertAllowed`가 그 확정을 기계로 지킨다.
 */
const DEFAULT_MODEL = 'deepseek-v4-flash'

/**
 * 모델 관문 — `AI_MODEL`로도 뚫리지 않는다.
 *
 * `AI_MODEL`은 과부하(503) 때 같은 계열 안에서 갈아끼우라고 둔 탈출구인데,
 * 급할 때 손이 가는 곳이 정확히 여기다. 「일단 pro로 올려보자」가 **환경 변수
 * 한 줄로 가능하면 확정은 확정이 아니다.** 그래서 값이 들어오는 지점에서
 * 막고, 조용히 무시하는 대신 던진다 — 잘못된 값으로 돌기 시작하면
 * 데모 도중에야 알게 된다.
 */
function assertAllowed(model: string): void {
  if (/pro/i.test(model)) {
    throw new Error(
      `AI_MODEL=${model} — pro 계열은 이 프로젝트에서 사용하지 않습니다(§4.3). `
      + `기본값 ${DEFAULT_MODEL}을 쓰거나 AI_MODEL을 비우세요.`,
    )
  }
  if (!/flash/i.test(model)) {
    throw new Error(
      `AI_MODEL=${model} — flash 계열만 사용합니다(§4.3). `
      + `기본값 ${DEFAULT_MODEL}을 쓰거나 AI_MODEL을 비우세요.`,
    )
  }
}

/**
 * spec §4.3의 effort 대응 — 생성 `medium` / 검증 `low`.
 *
 * `thinking: {type:"enabled"}`도 문서에 있지만 보내지 않는다. 값 조합을
 * 추측해서 400을 맞는 것보다, 문서에 있는 `reasoning_effort`만 쓰고
 * 실측(`npm run probe:deepseek`)으로 확인하는 편이 안전하다.
 */
const EFFORT: Record<AiRequest['effort'], 'low' | 'medium' | null> = {
  generate: 'medium',
  validate: 'low',
  /**
   * 초안(§7.5)은 **사고를 끈다** — `reasoning_effort`를 보내지 않고
   * `thinking: {type: 'disabled'}`를 보낸다. `null`이 그 표시다.
   *
   * ## 실측으로 정해졌다 (2026-08-12 · 같은 입력 · 같은 프롬프트)
   *
   * | 모드 | 소요 | 출력 |
   * |---|---:|---|
   * | `reasoning_effort: medium` | 69.4초 | **0자** (`reasoning_tokens: 8000` · `finish: length`) |
   * | `reasoning_effort: low` | 73.8초 | **0자** (같음) |
   * | `reasoning_effort: minimal` | 63.0초 | **0자** (같음) |
   * | 파라미터 없음 | 68.0초 | **0자** (같음) |
   * | **`thinking: disabled`** | **2.9초** | 416토큰 · 완전 |
   *
   * 장소 26곳을 5일에 배분하는 것은 제약 만족 문제라 사고 연쇄가 **발산한다** —
   * 어느 effort 값을 줘도 `max_tokens` 전부를 추론에 쓰고 본문이 비어 나온다.
   * 사고를 끄면 2.9초에 정확한 배분이 나온다(권역별 묶음·페르소나 반영 확인).
   *
   * 이 값을 `low`나 `medium`으로 되돌리면 **초안 라우트가 항상 409를 낸다.**
   */
  plan: null,
}

function classify(err: unknown): { type: AiErrorType; detail: string; retryAfterMs?: number } {
  const e = err as { name?: string; status?: number; message?: string; headers?: Headers }
  const msg = e?.message ?? String(err)

  if (e?.name === 'APIUserAbortError' || e?.name === 'TimeoutError'
      || /abort|timed? ?out/i.test(msg)) {
    return { type: 'timeout', detail: `${AI_TIMEOUT_MS / 1000}초 타임아웃: ${msg.slice(0, 200)}` }
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
  assertAllowed(model)

  const client = new OpenAI({
    apiKey, baseURL: BASE_URL,
    // 재시도는 클라이언트가 같은 API를 재호출한다(§4.2).
    // SDK가 자동 재시도하면 요청 예산(AI_TIMEOUT_MS)을 넘긴다.
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
          /*
           * 사고 파라미터는 **둘 중 하나만** 보낸다. `reasoning_effort`와
           * `thinking: disabled`를 같이 보내면 서로 모순된 지시가 된다.
           */
          ...(EFFORT[req.effort] === null
            ? { thinking: { type: 'disabled' } }
            : { reasoning_effort: EFFORT[req.effort] }),
          // strict 스키마가 없으므로 문법 보장까지만 받고, 구조는 아래에서 검사한다.
          response_format: { type: 'json_object' },
        } as Parameters<typeof client.chat.completions.create>[0],
        /*
         * ⚠️ 클라이언트의 `timeout` 옵션만으로는 끊기지 않는다 — **실측**.
         * 추론이 길어진 호출이 `elapsed_ms: 58218`로 돌아왔다(2026-08-12).
         * `maxDuration`이 60초이므로(§4.2) 그 상태로는 플랫폼이 먼저 죽여
         * 409 대신 504가 나가고, §11.6 재시도 경로를 건너뛴다.
         *
         * 그래서 요청마다 `AbortSignal.timeout`을 직접 건다. 예비 경로(Gemini)는
         * 처음부터 이 방식이었고(`abortSignal`), 주 경로만 SDK 옵션을 믿고 있었다.
         */
        { signal: AbortSignal.timeout(AI_TIMEOUT_MS) })
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

      // ── 빈 본문 (§4.3) — 문서가 「json_object 모드에서 드물게 온다」고 명시하고,
      //    실측에서도 가장 긴 생성(페이지 확장)에서 4회 중 1회 관측됐다.
      //    종료 사유가 stop인데 content만 비는 형태라 절단·거부와 구분되지 않는다.
      //    사유를 여기서 채워 두지 않으면 재시도 로그에 「비었음」만 남아
      //    **한 번 실패가 반복 실패인지 우연인지 사후에 판별할 수 없다**(§5.4).
      const text = choice?.message?.content
      if (!text || !text.trim()) {
        const reasoning = (choice?.message as { reasoning_content?: string } | undefined)
          ?.reasoning_content
        return fail('schema_invalid',
          `본문이 비어 있습니다. finish_reason=${finishReason ?? '-'}`
          + ` · 사고 토큰 ${usage.thoughtTokens ?? '-'}`
          + ` · 사고 본문 ${reasoning ? `${reasoning.length}자` : '없음'}`
          + ' (json_object 모드의 간헐적 빈 응답 — 재호출로 해소된다)',
          finishReason, usage)
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
