/**
 * **Google Search 그라운딩 실측** — planner-pivot 설계 #1 열린 문제.
 *
 * 세 가지를 답한다:
 *   1. gemini-3.5-flash-lite가 googleSearch 도구를 지원하는가
 *   2. 그라운딩 지연이 55초 예산 안인가
 *   3. **그라운딩(도구)과 responseSchema(JSON 강제)를 동시에 쓸 수 있는가**
 *      — 못 쓰면 절대원칙 3(출력 JSON 강제)과 정면 충돌한다
 *
 *   npm exec tsx --env-file=.env.local scripts/probe-grounding.mts
 */
import { GoogleGenAI, Type } from '@google/genai'

const key = process.env.GEMINI_API_KEY
if (!key) { console.error('GEMINI_API_KEY 없음'); process.exit(1) }
const model = process.env.AI_MODEL?.trim() || 'gemini-3.5-flash-lite'
const ai = new GoogleGenAI({ apiKey: key })

const WISH = '제주도 3박4일 감성 커플여행. 조용한 숙소와 로컬 맛집 위주로.'

type GroundingReport = {
  text?: string
  candidates?: Array<{
    finishReason?: string
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>
      webSearchQueries?: string[]
    }
  }>
}

function report(label: string, res: GroundingReport | null, ms: number, err?: unknown) {
  console.log(`\n=== ${label} (${(ms / 1000).toFixed(1)}초) ===`)
  if (err) { console.log('  ❌ 예외:', String((err as Error).message).slice(0, 400)); return }
  const cand = res?.candidates?.[0]
  console.log('  finishReason :', cand?.finishReason ?? '?')
  const gm = cand?.groundingMetadata
  const chunks = gm?.groundingChunks ?? []
  console.log('  grounding    :', gm ? `있음 · 출처 ${chunks.length}개` : '없음')
  for (const c of chunks.slice(0, 5)) console.log('    -', c.web?.title, '·', c.web?.uri)
  const queries = gm?.webSearchQueries ?? []
  if (queries.length) console.log('  검색어       :', queries.join(' / '))
  const text = res?.text ?? ''
  console.log('  본문 길이    :', text.length, '자')
  console.log('  본문 앞부분  :', text.slice(0, 200).replace(/\n/g, ' '))
}

// ① 그라운딩만 (JSON 강제 없음)
{
  const t = Date.now()
  try {
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: `${WISH}\n실제 존재하는 숙소 2곳과 맛집 3곳을 이름·주소와 함께 추천해줘.` }] }],
      config: { tools: [{ googleSearch: {} }] },
    })
    report('① googleSearch 도구만', res, Date.now() - t)
  } catch (e) { report('① googleSearch 도구만', null, Date.now() - t, e) }
}

// ② 그라운딩 + responseSchema (동시 사용 가능한가?)
{
  const t = Date.now()
  const schema = {
    type: Type.OBJECT,
    properties: {
      숙소: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { 이름: { type: Type.STRING }, 주소: { type: Type.STRING } } } },
      맛집: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { 이름: { type: Type.STRING }, 주소: { type: Type.STRING } } } },
    },
  }
  try {
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: `${WISH}\n실제 존재하는 숙소 2곳과 맛집 3곳을 추천해줘.` }] }],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    })
    report('② googleSearch + responseSchema 동시', res, Date.now() - t)
  } catch (e) { report('② googleSearch + responseSchema 동시', null, Date.now() - t, e) }
}
