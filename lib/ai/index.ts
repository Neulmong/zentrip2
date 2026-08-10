import 'server-only'
import { createGeminiProvider } from './gemini'
import type { AiProvider } from './contract'

export type { AiRequest, AiResult, AiErrorType, AiUsage, Effort } from './contract'
export { toLogOutput, ERROR_LABEL } from './contract'

/**
 * provider 선택. 라우트는 `ai()`만 알면 되고, 모델을 바꿔도
 * 파이프라인 6개 라우트는 손대지 않는다.
 *
 * `AI_MODEL` 환경 변수로 모델을 덮어쓸 수 있다 — 무료 티어 한도에 걸렸을 때
 * flash-lite로 내리거나, 유료 전환 시 pro로 올리는 데 쓴다.
 */
let cached: AiProvider | null = null

export function ai(): AiProvider {
  if (!cached) {
    const key = process.env.GEMINI_API_KEY
    if (!key) {
      throw new Error(
        'GEMINI_API_KEY가 설정되지 않았습니다. '
        + 'aistudio.google.com/apikey에서 무료 티어 키를 발급받아 .env.local에 넣으세요.',
      )
    }
    cached = createGeminiProvider(key, process.env.AI_MODEL || undefined)
  }
  return cached
}
