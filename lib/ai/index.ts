import 'server-only'
import { createGeminiProvider } from './gemini'
import { createSolarProvider } from './solar'
import type { AiProvider } from './contract'

export type { AiRequest, AiResult, AiErrorType, AiUsage, Effort } from './contract'
export { toLogOutput, ERROR_LABEL } from './contract'

/**
 * provider 선택. 라우트는 `ai()`만 알면 되고, 공급자를 바꿔도
 * 파이프라인 6개 라우트는 손대지 않는다.
 *
 * ## 예비 경로가 있는 이유
 *
 * Gemini 무료 티어는 분당 한도(429)와 과부하(503)가 실제로 발생한다.
 * §20 대본은 40초 안에 AI 6회를 부르므로 데모 당일 단일 실패점이 된다.
 * 쿼터가 완전히 분리된 두 번째 공급자를 두어 한 줄로 갈아탈 수 있게 한다.
 *
 *   AI_PROVIDER=solar    # .env.local에 추가하면 즉시 전환
 *   AI_MODEL=...         # 같은 공급자 안에서 모델만 교체
 */
export type ProviderName = 'gemini' | 'solar'

const cache = new Map<string, AiProvider>()

function resolve(): ProviderName {
  const name = (process.env.AI_PROVIDER ?? 'gemini').trim().toLowerCase()
  return name === 'solar' ? 'solar' : 'gemini'
}

export function ai(): AiProvider {
  const name = resolve()
  const model = process.env.AI_MODEL?.trim() || undefined
  const key = `${name}:${model ?? 'default'}`

  const cached = cache.get(key)
  if (cached) return cached

  let provider: AiProvider
  if (name === 'solar') {
    const apiKey = process.env.UPSTAGE_API_KEY
    if (!apiKey) {
      throw new Error(
        'UPSTAGE_API_KEY가 설정되지 않았습니다. '
        + 'console.upstage.ai/api-keys에서 발급받아 .env.local에 넣으세요.',
      )
    }
    provider = createSolarProvider(apiKey, model)
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
