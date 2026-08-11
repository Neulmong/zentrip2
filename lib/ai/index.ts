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
 * ## 예비 경로가 있는 이유
 *
 * Gemini 무료 티어는 **모델당 하루 20회**(`GenerateRequestsPerDayPerProjectPerModel`)
 * 라 §20 대본 1회(AI 6회)를 3번 남짓 돌리면 소진된다. 429의 `retryDelay`를
 * 기다려도 일일 쿼터는 회복되지 않으므로, 대기로는 풀 수 없다.
 * 쿼터가 완전히 분리된 두 번째 공급자를 두어 한 줄로 갈아탈 수 있게 한다.
 *
 *   AI_PROVIDER=deepseek    # .env.local에 추가하면 즉시 전환
 *   AI_MODEL=...            # 같은 공급자 안에서 모델만 교체
 */
export type ProviderName = 'gemini' | 'deepseek'

const cache = new Map<string, AiProvider>()

function resolve(): ProviderName {
  const name = (process.env.AI_PROVIDER ?? 'gemini').trim().toLowerCase()
  return name === 'deepseek' ? 'deepseek' : 'gemini'
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
        + 'platform.deepseek.com/api_keys에서 발급받아 .env.local에 넣으세요.',
      )
    }
    provider = createDeepseekProvider(apiKey, model)
  } else {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY가 설정되지 않았습니다. '
        + 'aistudio.google.com/apikey에서 무료 티어 키를 발급받아 .env.local에 넣으세요.',
      )
    }
    provider = createGeminiProvider(apiKey, model)
  }

  cache.set(key, provider)
  return provider
}
