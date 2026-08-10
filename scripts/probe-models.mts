import { GoogleGenAI } from '@google/genai'
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
const models = ['gemini-2.5-flash-lite','gemini-2.5-flash','gemini-3.5-flash','gemini-3.6-flash','gemini-2.5-pro','gemini-3.1-pro-preview']
for (const m of models) {
  const t = Date.now()
  try {
    const r = await ai.models.generateContent({
      model: m, contents: 'ping',
      config: { maxOutputTokens: 16, abortSignal: AbortSignal.timeout(20000) },
    })
    console.log(`  ✅ ${m.padEnd(24)} ${Date.now()-t}ms  "${(r.text??'').trim().slice(0,20)}"`)
  } catch (e) {
    const msg = (e as Error).message
    const code = msg.match(/"code":\s*(\d+)/)?.[1] ?? '?'
    const short = msg.match(/"message":\s*"([^"]{0,80})/)?.[1] ?? msg.slice(0, 80)
    console.log(`  ❌ ${m.padEnd(24)} ${code}  ${short}`)
  }
}
