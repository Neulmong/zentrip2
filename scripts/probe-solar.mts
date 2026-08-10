/**
 * Upstage Solar 예비 경로 실측 — Gemini와 같은 관문을 통과하는지 본다.
 *   npm run probe:solar
 */
import { createSolarProvider } from '../lib/ai/solar'
import { EXPAND_SCHEMA, EXPAND_SYSTEM, type ExpandResult } from '../lib/pipeline/ai-contracts'

const key = process.env.UPSTAGE_API_KEY
if (!key) { console.error('UPSTAGE_API_KEY 없음 — .env.local에 넣어 주세요.'); process.exit(1) }

const model = process.env.AI_MODEL || 'solar-pro4'
console.log(`모델: ${model}\n`)

const p = createSolarProvider(key, model)
const r = await p.call<ExpandResult>({
  system: EXPAND_SYSTEM,
  user: `## 일차별 압축 서술 — 이것을 확장하라
1일차
  원문근거: 1일: 김해공항 출발, 올레 7코스 걷기, 중식·석식 제공
  압축: 김해공항에서 출발해 올레 7코스를 걷습니다. 중식과 석식이 제공됩니다.
2일차
  원문근거: 2일: 성산일출봉, 해녀박물관 관람, 조식·중식 제공
  압축: 성산일출봉과 해녀박물관을 관람합니다. 조식과 중식이 제공됩니다.

## 상품 정보
행사명: 제주 올레 바람 여행 / 여행지: 제주
여행기간: 2026-03-14 ~ 2026-03-17

각 일차의 확장 서술과 신청 섹션의 제목·안내문구를 만들어라.`,
  schema: EXPAND_SCHEMA,
  effort: 'generate',
  label: 'probe_expand',
})

if (!r.ok) {
  console.log(`❌ ${(r.elapsedMs / 1000).toFixed(1)}초 — ${r.errorType}`)
  console.log(`   ${r.detail}`)
  process.exit(1)
}

const ok = (n: string, c: boolean) => console.log(`  ${c ? '✅' : '❌'} ${n}`)
console.log(`  소요        ${(r.elapsedMs / 1000).toFixed(1)}초  ${r.elapsedMs < 25_000 ? '✅ 25초 예산 내' : '❌ 초과'}`)
console.log(`  토큰        입력 ${r.usage.inputTokens} / 출력 ${r.usage.outputTokens}`
  + `${r.usage.thoughtTokens ? ` / 사고 ${r.usage.thoughtTokens}` : ''}`)
console.log(`  finishReason ${r.finishReason}`)
ok('스키마 강제 — days 배열', Array.isArray(r.data.days) && r.data.days.length === 2)
ok('스키마 강제 — apply 객체', typeof r.data.apply?.제목 === 'string' && typeof r.data.apply?.안내문구 === 'string')
ok('일차별 서술 200자 이내 (§17.1)', (r.data.days ?? []).every((d) => d.text.length <= 200))
console.log(`\n  1일차: "${r.data.days?.[0]?.text?.slice(0, 70) ?? ''}…"`)
console.log(`  안내:  "${r.data.apply?.안내문구?.slice(0, 60) ?? ''}…"`)
