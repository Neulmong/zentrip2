/**
 * **예비 경로(Gemini) 실측** (§4.3). 주 경로는 `npm run probe:deepseek`이다.
 *
 *   "page_content 9섹션 JSON 스키마를 강제한 호출 1건이 25초 안에 들어오는가"
 *
 * 주 경로가 막힌 날 `AI_PROVIDER=gemini`로 갈아타기 **전에** 이것을 돌린다 —
 * 무료 티어는 모델당 하루 20회라 「쓸 수 있는 줄 알았는데 쿼터가 없던」 상태가
 * 실제로 있었다. **프로덕션이 쓰는 lib/ai/gemini.ts를 그대로 호출**하므로
 * 여기서 통과하면 파이프라인에서도 같은 경로로 동작한다.
 *
 *   npm run probe:gemini              — 기본 모델
 *   AI_MODEL=gemini-2.5-flash npm run probe:gemini
 */
import { GoogleGenAI, Type } from '@google/genai'
import { createGeminiProvider } from '../lib/ai/gemini'

const key = process.env.GEMINI_API_KEY
if (!key) { console.error('GEMINI_API_KEY 없음'); process.exit(1) }

/* ── 1. 호출 가능한 무료 모델 확인 ────────────────────────────── */
console.log('=== 무료 티어 후보 (flash 계열) ===')
const usable: string[] = []
try {
  for await (const m of await new GoogleGenAI({ apiKey: key }).models.list()) {
    const actions: string[] = (m as { supportedActions?: string[] }).supportedActions ?? []
    if (actions.length && !actions.includes('generateContent')) continue
    const id = (m.name ?? '').replace(/^models\//, '')
    if (id && /flash/i.test(id) && !/embedding|tts|image|live|audio|omni|robotics|computer-use/i.test(id)) {
      usable.push(id)
    }
  }
  console.log(`  ${usable.join(', ') || '(없음)'}`)
} catch (e) {
  console.error('  모델 목록 조회 실패:', (e as Error).message)
  process.exit(1)
}

function pick(): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL
  return usable
    .map((m) => {
      let s = /lite/i.test(m) ? 20 : 50
      const v = m.match(/(\d+)\.(\d+)/)
      if (v) s += Number(v[1]) * 10 + Number(v[2])
      if (/preview|exp/i.test(m)) s -= 5
      return { m, s }
    })
    .sort((a, b) => b.s - a.s)[0]?.m ?? 'gemini-2.5-flash'
}

const model = pick()
console.log(`\n선택된 모델: ${model}`)

/* ── 2. page_content 스키마 (§9.3의 축약판) ───────────────────── */
const schema = {
  type: Type.OBJECT,
  properties: {
    schema_version: { type: Type.STRING },
    theme: { type: Type.STRING },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          type: { type: Type.STRING },
          order: { type: Type.INTEGER },
          visible: { type: Type.BOOLEAN },
          locked: { type: Type.BOOLEAN },
          data: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              subcopy: { type: Type.STRING },
              text: { type: Type.STRING },
              image_slot: { type: Type.STRING },
            },
          },
          source: {
            type: Type.OBJECT,
            properties: { headline: { type: Type.STRING }, subcopy: { type: Type.STRING } },
          },
        },
        required: ['id', 'type', 'order', 'visible', 'locked', 'data'],
      },
    },
  },
  required: ['schema_version', 'theme', 'sections'],
}

const SYSTEM = `당신은 여행 상품 페이지의 콘텐츠 모델을 만든다.
HTML을 생성하지 않는다. 산출물은 JSON뿐이다.
입력에 없는 지명·시설·경유지를 추가하지 않는다.
출처 없는 아라비아 숫자를 만들지 않는다.
사실정보 필드에는 source 경로를 반드시 남긴다.
값을 요약·의역·재표기하지 않는다.`

const INPUT = {
  행사정보: {
    행사명: '제주 올레 바람 여행', 여행지: '제주',
    여행기간: '2026-03-14 ~ 2026-03-17', 여행스타일: '자연', 여행주제: '제주 걷기와 로컬 맛집 휴식', 타겟층: '추후 추가 예정',
    일정: [
      { day: '1', 내용: '김해공항에서 출발해 올레 7코스를 걷습니다. 중식과 석식이 제공됩니다.' },
      { day: '2', 내용: '성산일출봉과 해녀박물관을 관람합니다. 조식과 중식이 제공됩니다.' },
      { day: '3', 내용: '자유 일정으로 보냅니다. 조식이 제공됩니다.' },
      { day: '4', 내용: '귀국합니다.' },
    ],
  },
  // 객체 배열 · 1건 이상 (§7.4)
  숙박: [{ 숙소명: '롯데호텔 제주', 위치: '중문', 객실타입: '디럭스룸', 숙박일정: '추후 추가 예정' }],
  상점: [{ 상점명: '제주 로컬 기념품 숍', 구분: '추천', 위치: '추후 추가 예정', 상점정보: '여행객 10% 할인' }],
  가격: { 성인: '120000원', 아동: '해당 없음', 기타: '항공료 별도' },
  식사: { 식사정보: '조식 3회, 중식 2회, 석식 1회' },
  항공편: { 공항: '추후 추가 예정', 항공사: '추후 추가 예정', 편명: '추후 추가 예정', 출발시간: '추후 추가 예정', 도착시간: '추후 추가 예정' },
}

interface PageContent {
  theme?: string
  sections?: { id: string; order: number; locked: boolean; data?: { headline?: string } }[]
}

console.log('\n=== page_content 스키마 강제 호출 (effort: generate) ===')
const provider = createGeminiProvider(key, model)
const r = await provider.call<PageContent>({
  system: SYSTEM,
  user: `아래 확정 데이터표로 상품 페이지 9개 섹션을 만들어라.
순서: hero, summary, itinerary, accommodation, flight, meal, price, shop, apply.
hero와 apply는 locked: true, 나머지는 false. order는 1~9.

${JSON.stringify(INPUT, null, 2)}`,
  schema,
  effort: 'generate',
  label: 'probe:page',
})

if (!r.ok) {
  console.log(`  ❌ ${(r.elapsedMs / 1000).toFixed(1)}초 — ${r.errorType}`)
  console.log(`     ${r.detail}`)
  process.exit(1)
}

const s = r.data.sections ?? []
const headline = s[0]?.data?.headline
console.log(`  소요          ${(r.elapsedMs / 1000).toFixed(1)}초  ${r.elapsedMs < 25_000 ? '✅ 25초 예산 내' : '❌ 초과'}`)
console.log(`  섹션 수       ${s.length}개  ${s.length === 9 ? '✅' : '⚠ 9개 아님'}`)
console.log(`  order         ${s.map((x) => x.order).join(',')}`)
console.log(`  locked        hero=${s[0]?.locked} apply=${s.at(-1)?.locked} `
  + `${s[0]?.locked === true && s.at(-1)?.locked === true ? '✅' : '⚠'}`)
console.log(`  theme         ${r.data.theme}`)
console.log(`  finishReason  ${r.finishReason}`)
console.log(`  토큰          입력 ${r.usage.inputTokens} / 출력 ${r.usage.outputTokens}`
  + `${r.usage.thoughtTokens ? ` / 사고 ${r.usage.thoughtTokens}` : ''}`)
console.log(`  hero.headline "${headline}" ${headline === '제주 올레 바람 여행' ? '✅ 값 보존' : '❌ 값 변형 — §16.1 위반'}`)
