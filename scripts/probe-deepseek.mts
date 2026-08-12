/**
 * **주 AI 경로 실측** (§4.3). 키·모델을 건드린 직후 이것부터 돌린다.
 *
 *   npm run probe:deepseek
 *
 * 재는 것 — 주 경로가 「진짜 쓸 수 있는가」의 조건 전부다:
 *   1. 인증이 되는가 (401이면 키 종류가 다르다)
 *   2. 25초 예산 안에 끝나는가 (§4.3 타임아웃)
 *   3. `reasoning_effort`를 받아 주는가 (400이면 그 파라미터를 빼야 한다)
 *   4. **실제 파이프라인 스키마**를 만족하는 출력이 나오는가
 *
 * 4번이 핵심이다. DeepSeek은 `json_schema` strict 모드가 없어서 구조 보증을
 * `lib/ai/schema.ts`의 로컬 검증이 대신한다 — 실제 스키마로 확인하지 않으면
 * 「키는 되는데 파이프라인은 안 되는」 상태가 된다.
 *
 * ⚠ ②(페이지 확장)는 `json_object` 모드의 간헐적 빈 응답으로 실패할 수 있다 —
 *   2026-08-12 실측에서 4회 중 1회. **한 번 실패하면 다시 돌려 본다.**
 *   연속으로 실패할 때만 구조 문제이며, 그때는 예비 경로(`AI_PROVIDER=gemini`)를 쓴다.
 *
 * 파이프라인이 쓰는 스키마 3종을 그대로 쓴다. `VALIDATION_SCHEMA`에는 `enum`이
 * 있어 로컬 검증기의 enum 처리까지 함께 확인된다.
 */
import { createDeepseekProvider } from '../lib/ai/deepseek'
import {
  DECOMPOSE_SCHEMA,
  EXPAND_SCHEMA,
  VALIDATION_SCHEMA,
} from '../lib/pipeline/ai-contracts'
/*
 * 프롬프트는 **실행되는 것과 같은 것**을 써야 실측이 의미를 갖는다.
 * 그래서 SKILL.md에서 구운 registry를 읽는다 — 사본을 만들면 이 스크립트가
 * 측정하는 프롬프트와 파이프라인이 보내는 프롬프트가 갈라진다(규약 R4).
 */
import { PROMPTS } from '../lib/harness/generated/registry'
import type { AiRequest, AiResult } from '../lib/ai/contract'

const key = process.env.DEEPSEEK_API_KEY
if (!key) {
  console.error(
    '\n❌ DEEPSEEK_API_KEY가 없습니다.\n'
    + '   platform.deepseek.com/api_keys 에서 발급한 뒤 .env.local의\n'
    + '   DEEPSEEK_API_KEY= 뒤에 붙여 주세요.\n',
  )
  process.exit(1)
}

const model = process.env.AI_MODEL?.trim() || undefined
const provider = createDeepseekProvider(key, model)
console.log(`\n공급자: ${provider.name} / 모델: ${provider.model}`)
console.log(`키 접두사: ${key.slice(0, 6)}… (길이 ${key.length})`)

let fail = 0

function report(r: AiResult<unknown>, summarize: (d: unknown) => string[]) {
  const secs = (r.elapsedMs / 1000).toFixed(1)
  if (!r.ok) {
    fail++
    console.log(`  ❌ ${secs}초 — ${r.errorType}`)
    console.log(`     ${r.detail.slice(0, 700)}`)
    if (r.errorType === 'api_error' && /reasoning_effort|unsupported|invalid_request/i.test(r.detail)) {
      console.log('\n  ⚠ reasoning_effort를 거부한 것으로 보입니다 —'
        + ' lib/ai/deepseek.ts에서 그 줄을 빼고 다시 돌리세요.')
    }
    if (r.errorType === 'schema_invalid') {
      console.log('\n  ⚠ 프롬프트만으로는 구조가 안 잡힌다는 신호입니다.'
        + ' DeepSeek은 strict 스키마가 없어 로컬 검증이 유일한 관문입니다 —')
      console.log('     이 단계가 반복 실패하면 예비 경로로 쓸 수 없습니다.')
    }
    return
  }
  console.log(`  ✅ ${secs}초 ${r.elapsedMs < 25_000 ? '(25초 예산 내)' : '⚠ 25초 예산 초과'}`)
  for (const line of summarize(r.data)) console.log(`     ${line}`)
  console.log(`     토큰        입력 ${r.usage.inputTokens} / 출력 ${r.usage.outputTokens}`
    + ` / 사고 ${r.usage.thoughtTokens ?? '-'}`)
}

const call = <T,>(req: AiRequest) => provider.call<T>(req)

/* ── ① 일차 분해 (§8.2) ──────────────────────────────────────── */
console.log('\n① 일차 분해 — DECOMPOSE_SCHEMA (effort: generate)')
report(await call<{ 판정: string; 일정: { day: string }[] }>({
  system: PROMPTS['itinerary-decomposition'],
  user: '여행기간 일수: 3일\n\n일정원문:\n'
    + '1일: 김해공항 출발, 올레 7코스 걷기\n2일: 성산일출봉 관람\n3일: 귀국\n\n'
    + '참고 (다른 확정 값 — 여기 있는 표현은 내용에 써도 된다):\n{}',
  schema: DECOMPOSE_SCHEMA,
  effort: 'generate',
  label: 'probe-decompose',
}), (d) => {
  const x = d as { 판정: string; 일정: unknown[] }
  return [`판정        ${x.판정}`, `일정        ${Array.isArray(x.일정) ? `${x.일정.length}개 일차` : '없음'}`]
})

/* ── ② 페이지 확장 서술 (§9.5 ①) — 가장 긴 출력 ──────────────── */
console.log('\n② 페이지 확장 서술 — EXPAND_SCHEMA (effort: generate)')
report(await call<{ days: unknown[]; apply: { 제목: string } }>({
  system: PROMPTS['content-structuring'],
  user: '## 일차별 압축 서술 (소개서) — 이것을 확장하라\n'
    + '1일차: 김해공항 출발, 올레 7코스 걷기\n2일차: 성산일출봉 관람\n3일차: 귀국\n\n'
    + '## 확정 값\n행사명: 제주 올레 바람 여행 / 여행지: 제주\n'
    + '숙소: 롯데호텔 제주 (디럭스룸, 중문) / 성인 120,000원 / 아동 해당 없음',
  schema: EXPAND_SCHEMA,
  effort: 'generate',
  label: 'probe-expand',
}), (d) => {
  const x = d as { days: { text?: string }[]; apply: { 제목: string } }
  const longest = Math.max(0, ...(x.days ?? []).map((v) => (v.text ?? '').length))
  return [
    `days        ${Array.isArray(x.days) ? `${x.days.length}개` : '없음'}`,
    `최장 서술   ${longest}자 ${longest <= 200 ? '(200자 계약 내)' : '⚠ 200자 초과'}`,
    `apply.제목  ${x.apply?.제목 ?? '-'}`,
  ]
})

/* ── ③ 사실 검증 (§8.4) — enum + validate effort ─────────────── */
console.log('\n③ 사실 검증 — VALIDATION_SCHEMA (effort: validate · enum 포함)')
report(await call<{ 판정: string; items: unknown[] }>({
  system: PROMPTS['fact-check'],
  user: '## 기준값 (form_input)\n{"행사정보":{"행사명":"제주 올레 바람 여행","여행지":"제주"}}\n\n'
    + '## 검사 대상\n{"b_overview":{"data":{"여행지":"제주"},"source":{"여행지":"행사정보.여행지"}}}\n\n'
    + 'source가 가리키는 경로를 form_input에 적용해 값을 대조하라.',
  schema: VALIDATION_SCHEMA,
  effort: 'validate',
  label: 'probe-factcheck',
}), (d) => {
  const x = d as { 판정: string; items: unknown[] }
  return [
    `판정        ${x.판정} ${['pass', 'fail'].includes(x.판정) ? '(enum 준수)' : '⚠ enum 밖'}`,
    `items       ${Array.isArray(x.items) ? `${x.items.length}건` : '없음'}`,
  ]
})

console.log('\n' + '─'.repeat(52))
if (fail === 0) {
  console.log('주 경로 사용 가능.')
  console.log('  기본값:    AI_PROVIDER를 비워 두면 이 경로다')
  console.log('  그 다음:   npm run test:demo   ← 관통 검증까지 해야 "쓸 수 있다"고 말할 수 있다')
} else {
  console.log(`${fail}건 실패 — 한 번 더 돌려 보고(빈 응답은 간헐적이다),`)
  console.log('  반복되면 AI_PROVIDER=gemini로 예비 경로를 씁니다.')
}
process.exit(fail > 0 ? 1 : 0)
