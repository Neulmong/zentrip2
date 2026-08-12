import 'server-only'
import {
  loadProduct, readUpdatedAt, runStep, updateProduct, type StepOutcome,
} from '@/lib/orchestrator'
import { RESET_ON, resetCounters } from '@/lib/policy'
import { conflict } from '@/lib/http'
import { tripDays } from '@/lib/form-validation'
import type { LogStep, ProductRow, ProductStatus } from '@/lib/types'
import type { ConfirmedData } from '@/lib/pipeline/normalize'
import { assertBudget, routeSpec, skillSpec, type HarnessRoute } from './loader'
import { loadMaterials } from './materials'
import { newContext, type HarnessContext } from './context'
import { MECHANICAL } from './impls'
import { AI_SKILLS } from './ai-skills'
import { decompose } from './agents/intake-agent'
import { brochure } from './agents/content-writer-agent'
import { page } from './agents/web-builder-agent'
import {
  validateBrochure, validateConsistency, validatePage,
} from './agents/validator-agent'
import type { RouteSpec } from './generated/registry'

/**
 * 하네스의 실행 계층 — **라우트가 부르는 유일한 함수**(규약 R1).
 *
 *   라우트  →  runAgent  →  runStep(상태·로그·재시도)  →  에이전트
 *                                                          └→ 스킬 체인
 *
 * 라우트에 파이프라인 로직을 두지 않는다. 단계명·추가 단계·카운터·AI 예산·
 * 체인 순서는 전부 `manifest.json`에서 온다 — 라우트는 자기 이름만 안다.
 *
 * `runStep`·`lib/logging`·`lib/policy`·`lib/ai`는 하네스 **바깥**이다(R7).
 * 여기서 하는 일은 `runStep`의 `work` 콜백 안쪽을 채우는 것뿐이다.
 */

/** 라우트 → 에이전트 함수. 매니페스트의 `agent`와 짝이어야 한다 */
const OUTCOME: Record<HarnessRoute, (c: HarnessContext) => StepOutcome> = {
  'decompose': decompose,
  'brochure': brochure,
  'validate-brochure': validateBrochure,
  'page': page,
  'validate-page': validatePage,
  'validate-consistency': validateConsistency,
}

/**
 * 스킬 체인 실행 — **선언된 순서 그대로.**
 *
 * 등록되지 않은 이름을 만나면 던진다. 조용히 건너뛰지 않는 이유:
 * 검사 스킬이 빠진 채 통과하는 것이 가장 위험한 실패다.
 */
async function runChain(
  route: HarnessRoute, spec: RouteSpec, c: HarnessContext,
): Promise<void> {
  for (const s of spec.skills) {
    const sk = skillSpec(s.name)
    const args = (s.args ?? {}) as Record<string, unknown>

    // R7 — kind:spec 스킬은 하네스 바깥을 문서화한다. 실행하면 로그가 두 번 쌓인다
    if (sk.kind === 'spec') {
      throw new Error(`하네스 규약 R7 위반: kind:spec 스킬 «${s.name}»이 체인에 있다`)
    }

    if (sk.kind === 'ai') {
      // R3 — 호출 **전에** 대조한다. 부른 뒤 세면 이미 돈과 25초를 쓴 다음이다
      assertBudget(route, s.name, c.aiCalls)
      const run = AI_SKILLS[s.name]
      if (!run) throw new Error(`하네스: ai 스킬 «${s.name}»의 러너가 등록되지 않았다`)
      await run(c, args)
    } else {
      const run = MECHANICAL[s.name]
      if (!run) throw new Error(`하네스: mechanical 스킬 «${s.name}»의 러너가 등록되지 않았다`)
      run(c, args)
    }

    if (c.stop) break
  }
}

/**
 * 진입 전이 (`manifest.entry`) — 지금은 [상품 생성] 1건뿐이다(§14.5 #5).
 *
 * 조회 시점을 **전이 전에** 본다. 뒤로 미루면 낡은 요청이 상태를 먼저
 * 바꿔 놓고 거절당한다. 전이에 성공하면 `updated_at`이 바뀌므로 클라이언트가
 * 보낸 값을 그대로 `runStep`에 넘길 수 없다 — 낡게 만든 것이 우리 자신이다.
 */
async function applyEntry(
  entry: NonNullable<RouteSpec['entry']>, productId: string, clientUpdatedAt: string | undefined,
): Promise<{ ok: true; updatedAt: string | undefined } | { ok: false }> {
  const p = await loadProduct(productId)
  if (!p) return { ok: true, updatedAt: clientUpdatedAt }

  if (clientUpdatedAt && clientUpdatedAt !== p.updated_at) return { ok: false }
  if (p.status !== (entry.from as ProductStatus)) return { ok: true, updatedAt: clientUpdatedAt }

  const reset = RESET_ON[entry.reset as keyof typeof RESET_ON]
  if (!reset) throw new Error(`하네스: 매니페스트 entry.reset «${entry.reset}»이 RESET_ON에 없다`)

  const moved = await updateProduct(p, {
    status: entry.to as ProductStatus,
    retry_counts: resetCounters(p.retry_counts, reset),
  })
  if (!moved.ok) return { ok: false }

  return { ok: true, updatedAt: clientUpdatedAt ? moved.row.updated_at : undefined }
}

async function buildContext(
  route: HarnessRoute, spec: RouteSpec, p: ProductRow,
): Promise<HarnessContext> {
  const fi = p.form_input
  const days = tripDays(fi.행사정보.여행기간_시작, fi.행사정보.여행기간_종료) ?? 0
  const materials = await loadMaterials(spec.materials, p)
  const c = newContext(route, p, days, materials)

  // 앞 단계의 산출물을 체인이 이어받는다 — 재료 기준이다(§14.5)
  if (p.confirmed_data) c.cd = p.confirmed_data as ConfirmedData
  if (p.slug) c.slug = p.slug

  return c
}

export async function runAgent(
  route: HarnessRoute, opts: { req: Request; productId: string },
): Promise<Response> {
  const spec = routeSpec(route)
  const clientUpdatedAt = await readUpdatedAt(opts.req)

  let effectiveUpdatedAt = clientUpdatedAt
  if (spec.entry) {
    const moved = await applyEntry(spec.entry, opts.productId, clientUpdatedAt)
    if (!moved.ok) return conflict({ reason: 'stale' })
    effectiveUpdatedAt = moved.updatedAt
  }

  return runStep(
    {
      route,
      step: spec.step as LogStep,
      extraSteps: spec.extra_steps as LogStep[] | undefined,
      productId: opts.productId,
      clientUpdatedAt: effectiveUpdatedAt,
    },
    async (p) => {
      const c = await buildContext(route, spec, p)
      await runChain(route, spec, c)
      return OUTCOME[route](c)
    },
  )
}
