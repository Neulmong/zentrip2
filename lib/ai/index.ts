import 'server-only'
import { createGeminiProvider } from './gemini'
import { createDeepseekProvider } from './deepseek'
import type { AiProvider } from './contract'

export type { AiRequest, AiResult, AiErrorType, AiUsage, Effort } from './contract'
export { toLogOutput, ERROR_LABEL } from './contract'

/**
 * provider 선택. 라우트는 `ai()`만 알면 되고, 공급자를 바꿔도
 * 파이프라인 6개 라우트는 손대지 않는다.
 *
 * ## 주 공급자는 DeepSeek이다 (§4.3)
 *
 * Gemini 무료 티어가 **모델당 하루 20회**(`GenerateRequestsPerDayPerProjectPerModel`)
 * 라 §20 대본 1회(AI 6회)를 3번 남짓 돌리면 소진되고, 429의 `retryDelay`를
 * 기다려도 일일 쿼터는 회복되지 않는다 — 대기로 풀리지 않는 한도였다.
 * 그래서 잔량이 예측 가능한 유료 종량제(DeepSeek)를 **기본**으로 올리고,
 * Gemini는 DeepSeek이 막혔을 때 쓰는 **예비 경로**로 내렸다.
 *
 *   (기본값)                # 아무것도 안 넣으면 deepseek
 *   AI_PROVIDER=gemini      # 예비 경로로 되돌린다
 *   AI_MODEL=...            # 같은 공급자 안에서 모델만 교체
 */
export type ProviderName = 'deepseek' | 'gemini'

const cache = new Map<string, AiProvider>()

function resolve(): ProviderName {
  const name = (process.env.AI_PROVIDER ?? 'deepseek').trim().toLowerCase()
  return name === 'gemini' ? 'gemini' : 'deepseek'
}

export function ai(): AiProvider {
  const name = resolve()
  const model = process.env.AI_MODEL?.trim() || undefined
  const key = `${name}:${model ?? 'default'}`

  const cached = cache.get(key)
  if (cached) return cached

  let provider: AiProvider
  if (name === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY가 설정되지 않았습니다. '
        + 'platform.deepseek.com/api_keys에서 발급받아 .env.local에 넣으세요. '
        + '예비 경로로 돌리려면 AI_PROVIDER=gemini를 넣으세요.',
      )
    }
    provider = createDeepseekProvider(apiKey, model)
  } else {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error(
        '예비 경로(AI_PROVIDER=gemini)를 골랐는데 GEMINI_API_KEY가 없습니다. '
        + 'aistudio.google.com/apikey에서 무료 티어 키를 발급받아 .env.local에 넣으세요.',
      )
    }
    provider = createGeminiProvider(apiKey, model)
  }

  cache.set(key, provider)
  return provider
}
