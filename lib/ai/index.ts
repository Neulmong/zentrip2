import 'server-only'
import { createGeminiProvider } from './gemini'
import type { AiProvider } from './contract'

export type { AiRequest, AiResult, AiErrorType, AiUsage, Effort, GroundingSource } from './contract'
export { toLogOutput, ERROR_LABEL } from './contract'

/**
 * provider 선택. 라우트는 `ai()`만 알면 되고, 모델을 바꿔도
 * 파이프라인 6개 라우트는 손대지 않는다.
 *
 * ## 공급자는 Gemini 하나다 (§4.3)
 *
 * 기본 모델은 `gemini-3.5-flash-lite`다. 다른 flash 계열로 갈아타려면
 * `AI_MODEL`만 바꾼다 — 라우트는 `lib/ai`의 provider 중립 인터페이스만
 * 부르므로 손대지 않는다.
 *
 *   (기본값)                       # 아무것도 안 넣으면 gemini-3.5-flash-lite
 *   AI_MODEL=gemini-2.5-flash      # 같은 공급자 안에서 모델만 교체
 */
export type ProviderName = 'gemini'

const cache = new Map<string, AiProvider>()

export function ai(): AiProvider {
  const model = process.env.AI_MODEL?.trim() || undefined
  const key = `gemini:${model ?? 'default'}`

  const cached = cache.get(key)
  if (cached) return cached

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY가 설정되지 않았습니다. '
      + 'aistudio.google.com/apikey에서 키를 발급받아 .env.local에 넣으세요.',
    )
  }
  const provider = createGeminiProvider(apiKey, model)

  cache.set(key, provider)
  return provider
}
