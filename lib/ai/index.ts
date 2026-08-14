import 'server-only'
import { createGeminiProvider } from './gemini'
import { createDeepseekProvider } from './deepseek'
import type { AiProvider } from './contract'

export type { AiRequest, AiResult, AiErrorType, AiUsage, Effort, GroundingSource } from './contract'
export { toLogOutput, ERROR_LABEL } from './contract'

/**
 * provider 선택. 라우트는 `ai()`만 알면 되고, 공급자를 바꿔도
 * 파이프라인 6개 라우트는 손대지 않는다.
 *
 * ## 주 공급자는 Gemini다 — 무조건 기본 (§4.3)
 *
 * 기본 모델은 `gemini-3.5-flash-lite`다. 아무것도 넣지 않으면 Gemini로 돈다.
 * 같은 공급자 안에서 다른 flash 계열로 갈아타려면 `AI_MODEL`만 바꾼다.
 *
 * Gemini가 과부하·인증·잔액으로 막히면 `AI_PROVIDER=deepseek` 한 줄로 **예비
 * 경로**(DeepSeek)로 되돌린다. 그라운딩(웹 검색)은 예비 경로에 없다 —
 * 자세한 것은 `lib/ai/deepseek.ts`.
 *
 *   (기본값)                       # 아무것도 안 넣으면 gemini-3.5-flash-lite
 *   AI_PROVIDER=deepseek           # 예비 경로로 되돌린다
 *   AI_MODEL=gemini-2.5-flash      # 같은 공급자 안에서 모델만 교체
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
        '예비 경로(AI_PROVIDER=deepseek)를 골랐는데 DEEPSEEK_API_KEY가 없습니다. '
        + 'platform.deepseek.com/api_keys에서 발급받아 .env.local에 넣으세요. '
        + '주 경로로 돌리려면 AI_PROVIDER를 비우세요(기본값 gemini).',
      )
    }
    provider = createDeepseekProvider(apiKey, model)
  } else {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY가 설정되지 않았습니다. '
        + 'aistudio.google.com/apikey에서 키를 발급받아 .env.local에 넣으세요.',
      )
    }
    provider = createGeminiProvider(apiKey, model)
  }

  cache.set(key, provider)
  return provider
}
