/**
 * §4.2 요청 분할 설계의 전제를 실측한다.
 *
 *   "page_content 9섹션 JSON 스키마를 강제한 호출 1건이 25초 안에 들어오는가"
 *
 * 이게 성립하지 않으면 라우트 분할 자체를 다시 설계해야 하므로, 코드를 더
 * 쌓기 전에 확인한다. 모델 ID는 추측하지 않고 API가 알려주는 것을 쓴다.
 *
 *   npm run probe:ai
 */
import { GoogleGenAI, Type } from '@google/genai'

const key = process.env.GEMINI_API_KEY
if (!key) { console.error('GEMINI_API_KEY 없음'); process.exit(1) }

const ai = new GoogleGenAI({ apiKey: key })

/* ── 1. 사용 가능한 모델 확인 ─────────────────────────────────── */
console.log('=== generateContent 지원 모델 ===')
const usable: string[] = []
try {
  const pager = await ai.models.list()
  for await (const m of pager) {
    const actions: string[] = (m as { supportedActions?: string[] }).supportedActions ?? []
    if (actions.length === 0 || actions.includes('generateContent')) {
      const id = (m.name ?? '').replace(/^models\//, '')
      if (id) { usable.push(id); console.log(`  ${id}`) }
    }
  }
} catch (e) {
  console.error('  모델 목록 조회 실패:', (e as Error).message)
  process.exit(1)
}

/**
 * 무료 티어 대상만 고른다 — **flash 계열만 무료**이고 pro는 유료다.
 * 같은 flash 안에서는 최신·비preview·비lite를 우선한다.
 */
function pick(): string {
  const explicit = process.env.PROBE_MODEL
  if (explicit) return explicit
  const scored = usable
    .filter((m) => /flash/i.test(m))
    .filter((m) => !/embedding|tts|image|live|audio|omni|robotics|computer-use/i.test(m))
    .map((m) => {
      let s = /lite/i.test(m) ? 20 : 50
      const ver = m.match(/(\d+)\.(\d+)/)
      if (ver) s += Number(ver[1]) * 10 + Number(ver[2])
      if (/preview|exp/i.test(m)) s -= 5
      return { m, s }
    })
    .sort((a, b) => b.s - a.s)
  return scored[0]?.m ?? usable[0]
}

const model = pick()
console.log(`\n선택된 모델: ${model}`)

/* ── 2. page_content 스키마 강제 호출 (§9.3의 축약판) ──────────── */
const sectionSchema = {
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
}

const schema = {
  type: Type.OBJECT,
  properties: {
    schema_version: { type: Type.STRING },
    theme: { type: Type.STRING },
    sections: { type: Type.ARRAY, items: sectionSchema },
  },
  required: ['schema_version', 'theme', 'sections'],
}

const SYSTEM = `당신은 여행 상품 페이지의 콘텐츠 모델을 만든다.
HTML을 생성하지 않는다. 산출물은 JSON뿐이다.
입력에 없는 지명·시설·경유지를 추가하지 않는다.
출처 없는 아라비아 숫자를 만들지 않는다.
사실정보 필드에는 source 경로를 반드시 남긴다.`

const INPUT = {
  행사정보: {
    행사명: '제주 올레 바람 여행', 여행지: '제주',
    여행기간: '2026-03-14 ~ 2026-03-17', 여행스타일: '자연', 타겟층: '추후 추가 예정',
    일정: [
      { day: '1', 내용: '김해공항에서 출발해 올레 7코스를 걷습니다. 중식과 석식이 제공됩니다.' },
      { day: '2', 내용: '성산일출봉과 해녀박물관을 관람합니다. 조식과 중식이 제공됩니다.' },
      { day: '3', 내용: '자유 일정으로 보냅니다. 조식이 제공됩니다.' },
      { day: '4', 내용: '귀국합니다.' },
    ],
  },
  숙박: { 숙소명: '롯데호텔 제주', 객실타입: '디럭스룸', 위치: '중문', 숙박일정: '추후 추가 예정' },
  상점: { 상점명: '제주 로컬 기념품 숍', 상점정보: '여행객 10% 할인' },
  가격: { 성인: '120000원', 아동: '해당 없음', 기타: '항공료 별도' },
  식사: { 식사정보: '조식 3회, 중식 2회, 석식 1회' },
  항공편: { 공항: '추후 추가 예정', 항공사: '추후 추가 예정', 편명: '추후 추가 예정', 출발시간: '추후 추가 예정', 도착시간: '추후 추가 예정' },
}

console.log('\n=== page_content 스키마 강제 호출 ===')
const t0 = Date.now()
try {
  const res = await ai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [{
        text: `아래 확정 데이터표로 상품 페이지 9개 섹션을 만들어라.\n`
          + `순서: hero, summary, itinerary, accommodation, flight, meal, price, shop, apply.\n`
          + `hero와 apply는 locked: true, 나머지는 false. order는 1~9.\n\n`
          + JSON.stringify(INPUT, null, 2),
      }],
    }],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: schema,
      maxOutputTokens: 8000,
      abortSignal: AbortSignal.timeout(25_000),
    },
  })

  const ms = Date.now() - t0
  const text = res.text ?? ''
  const parsed = JSON.parse(text)
  const u = res.usageMetadata

  console.log(`  소요        ${(ms / 1000).toFixed(1)}초  ${ms < 25_000 ? '✅ 25초 예산 내' : '❌ 초과'}`)
  console.log(`  섹션 수     ${parsed.sections?.length ?? 0}개  ${parsed.sections?.length === 9 ? '✅' : '⚠'}`)
  console.log(`  theme       ${parsed.theme}`)
  console.log(`  finishReason ${res.candidates?.[0]?.finishReason ?? '(없음)'}`)
  console.log(`  토큰        입력 ${u?.promptTokenCount ?? '?'} / 출력 ${u?.candidatesTokenCount ?? '?'}`
    + `${u?.thoughtsTokenCount ? ` / 사고 ${u.thoughtsTokenCount}` : ''}`)
  console.log(`  order       ${(parsed.sections ?? []).map((s: { order: number }) => s.order).join(',')}`)
  console.log(`  locked      hero=${parsed.sections?.[0]?.locked} apply=${parsed.sections?.at(-1)?.locked}`)

  const headline = parsed.sections?.[0]?.data?.headline
  console.log(`  hero.headline "${headline}" ${headline === '제주 올레 바람 여행' ? '✅ 값 보존' : '⚠ 값 변형'}`)
} catch (e) {
  const ms = Date.now() - t0
  console.log(`  ❌ ${(ms / 1000).toFixed(1)}초 만에 실패`)
  console.log(`  ${(e as Error).message}`)
  process.exit(1)
}
