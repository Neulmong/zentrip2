import 'server-only'
import { ai, toLogOutput, type GroundingSource } from '@/lib/ai'
import { ENRICHMENT_SCHEMA, GROUNDED_SEARCH_SCHEMA, type EnrichmentStructureResult } from '@/lib/pipeline/ai-contracts'
import {
  assembleEnrichment, placesFor, type Enrichment, type EnrichTarget,
} from '@/lib/pipeline/enrichment'
import type { ConfirmedData } from '@/lib/pipeline/normalize'
import { agentOf, assertBudget, manifestRouteSpec, promptOf, skillSpec, userPromptOf } from './loader'

/**
 * Task 2 place-enrichment의 실행 계층 — **`runStep` 밖이다**(`draft.ts`와 같은 이유).
 *
 * 두 라우트가 각각 AI 1회를 쓴다(절대원칙 1). 그라운딩과 responseSchema는 한
 * 호출에서 병용할 수 없으므로(probe-grounding 실측) **검색 → 구조화**로 나눴다.
 *
 * | 규약 | 어떻게 |
 * |---|---|
 * | R1 | 라우트는 `runEnrichSearch`/`runEnrichStructure`만 부른다 |
 * | R3 | AI 실행 **전에** `assertBudget`으로 대조한다 |
 * | R4 | system은 `promptOf`, user 지시문은 `userPromptOf`에서만 온다 |
 * | R5 | 스킬 순서·예산을 `manifest.json`에서 읽는다 |
 *
 * 로그는 이 경로에서 남기지 않는다 — 선택 보강이고 상태 전이가 없어 단계 로그의
 * 대상이 아니다(`plan-draft`와 같은 한계). AI 실패는 응답 코드로만 드러난다.
 */

/** AI 스킬 실행 전 관문 — kind 확인 + 예산 대조(R3·R7). draft.ts와 같은 규율 */
function gateAi(route: 'enrich-search' | 'enrich-structure', skill: string, spent: number): void {
  const sk = skillSpec(skill)
  if (sk.kind === 'spec') throw new Error(`하네스 규약 R7 위반: kind:spec 스킬 «${skill}»이 체인에 있다`)
  if (sk.kind === 'ai') assertBudget(route, skill, spent)
}

export type SearchOutcome =
  | { kind: 'ok'; text: string; sources: GroundingSource[]; aiLog: Record<string, unknown> }
  | { kind: 'no_targets' }
  | { kind: 'ai_fail'; errorType: string; retryAfterMs?: number }

export type StructureOutcome =
  | { kind: 'ok'; enrichment: Enrichment; aiLog: Record<string, unknown> }
  | { kind: 'ai_fail'; errorType: string; retryAfterMs?: number }

function targetList(targets: EnrichTarget[]): string {
  return targets
    .map((t, i) => `${i}. ${t.이름}${t.위치 ? ` (${t.위치})` : ''} [${t.종류}]`)
    .join('\n')
}

/**
 * 1단계 — 그라운딩 검색. **AI 1회**(grounding, schema 무시).
 *
 * 상품 행이 없어도 되는 `plan-draft`와 달리 여기는 확정 데이터를 받는다 —
 * 라우트가 상품을 조회해 넘긴다. 검색 대상이 없으면 호출조차 하지 않는다.
 */
export async function runEnrichSearch(cd: ConfirmedData): Promise<SearchOutcome> {
  const ROUTE = 'enrich-search' as const
  agentOf(ROUTE)
  const spec = manifestRouteSpec(ROUTE)
  const skill = spec.skills[0].name // grounded-place-search

  const targets = placesFor(cd)
  if (targets.length === 0) return { kind: 'no_targets' }

  gateAi(ROUTE, skill, 0)

  const user =
    `## 여행지\n${cd.행사정보.여행지}\n\n`
    + `## 장소 목록 (${targets.length}곳 — 이 장소들만 조사한다)\n${targetList(targets)}\n\n`
    + userPromptOf(skill)

  // 그라운딩 호출은 자유 텍스트를 낸다 — data가 그 문자열이다(gemini.ts 참조)
  const res = await ai().call<string>({
    system: promptOf(skill),
    user,
    schema: GROUNDED_SEARCH_SCHEMA, // grounding:true면 provider가 무시한다
    effort: skillSpec(skill).effort ?? 'generate',
    label: ROUTE,
    grounding: true,
  })

  const aiLog = toLogOutput(res)
  if (!res.ok) {
    console.error('[enrich-search] AI 실패', res.errorType, aiLog)
    return { kind: 'ai_fail', errorType: res.errorType, retryAfterMs: res.retryAfterMs }
  }
  return { kind: 'ok', text: res.data, sources: res.sources ?? [], aiLog }
}

/**
 * 2단계 — 구조화. **AI 1회**(responseSchema, grounding 없음).
 *
 * 검색 텍스트와 출처를 클라이언트가 실어 보낸다(중간 저장 없음 · 상태 기계 밖).
 * 실존 대조(`출처번호` → 실제 출처)는 `assembleEnrichment`가 기계로 한다 —
 * 근거 없는 장소는 버려지므로 출처 없는 값이 페이지에 오르지 않는다(§8.8).
 */
export async function runEnrichStructure(
  cd: ConfirmedData, groundedText: string, sources: GroundingSource[],
): Promise<StructureOutcome> {
  const ROUTE = 'enrich-structure' as const
  agentOf(ROUTE)
  const spec = manifestRouteSpec(ROUTE)
  const skill = spec.skills[0].name // enrichment-structure

  const targets = placesFor(cd)
  gateAi(ROUTE, skill, 0)

  const 이름목록 = targets.map((t, i) => `${i}. ${t.이름}`).join('\n')
  const 출처목록 = sources.length
    ? sources.map((s, i) => `${i}. ${s.title}`).join('\n')
    : '(출처 없음)'

  const user =
    `## 장소 목록 (이 이름을 그대로 쓴다)\n${이름목록}\n\n`
    + `## 검색 텍스트\n${groundedText}\n\n`
    + `## 출처 목록 (번호 — 출처번호가 이 인덱스를 가리킨다)\n${출처목록}\n\n`
    + userPromptOf(skill)

  const res = await ai().call<EnrichmentStructureResult>({
    system: promptOf(skill),
    user,
    schema: ENRICHMENT_SCHEMA,
    effort: skillSpec(skill).effort ?? 'generate',
    label: ROUTE,
  })

  const aiLog = toLogOutput(res)
  if (!res.ok) {
    console.error('[enrich-structure] AI 실패', res.errorType, aiLog)
    return { kind: 'ai_fail', errorType: res.errorType, retryAfterMs: res.retryAfterMs }
  }

  const enrichment = assembleEnrichment(res.data, sources, targets)
  return { kind: 'ok', enrichment, aiLog }
}
