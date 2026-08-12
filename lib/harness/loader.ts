import 'server-only'
import {
  AGENTS, HARNESS_VERSION, PROMPTS, ROUTES, SKILLS,
  type RouteSpec, type SkillSpec,
} from './generated/registry'

/**
 * 배선 조회 — **매니페스트가 유일한 출처다**(규약 R5).
 *
 * 런타임에 `.claude/`를 읽지 않는다. 빌드 타임에 구운
 * `generated/registry.ts`를 읽는다 — 근거는 `scripts/build-harness.mts` 상단.
 *
 * 이 모듈이 하는 일은 **조회와 대조**뿐이다. 판정하지 않는다.
 */

export { HARNESS_VERSION }

/** 매니페스트에 선언된 라우트 전체 */
export type ManifestRoute = keyof typeof ROUTES

/**
 * 하네스가 구동하는 라우트 — `driven_by: "route"`인 것들은 제외한다.
 *
 * | 라우트 | 왜 하네스가 구동하지 않나 |
 * |---|---|
 * | `products` | 상품 행을 **만든다.** `runStep`의 전제(기존 행·조건부 갱신·카운터)가 없다 |
 * | `form-input` | `attempt_no`를 올리고 산출물을 비운다. 같은 시도 안의 재시도가 아니다 |
 * | `content` | 편집은 사람이 한다. AI·카운터가 없고 담당 에이전트도 없다 |
 * | `slug` | 사람이 입력한 값의 형식 판정. AI·카운터 없음 |
 *
 * 매니페스트가 `driven_by: "route"`로 선언하고, `routeSpec`이 런타임에 막는다.
 * 이 합집합을 손으로 적는 이유는 **오타를 컴파일에서 잡기 위해서다** —
 * 매니페스트에서 파생시키면 `RouteKey`가 넓어져 그 이점이 사라진다.
 */
export type HarnessRoute =
  Exclude<ManifestRoute, 'products' | 'form-input' | 'content' | 'slug'>

/*
 * 코드젠이 `as const satisfies`로 굽기 때문에 각 항목의 타입은 **리터럴**이다.
 * 그래야 `RouteKey`가 6개 이름의 합집합이 되어 오타가 컴파일에서 걸린다.
 * 대가로 공용 접근에는 넓힌 시야가 필요하다 — 아래 세 함수가 그 경계다.
 */
const ROUTE_TABLE = ROUTES as Readonly<Record<string, RouteSpec>>
const SKILL_TABLE = SKILLS as Readonly<Record<string, SkillSpec>>
const AGENT_TABLE = AGENTS as Readonly<Record<string, { readonly routes: readonly string[] }>>

export function routeSpec(route: HarnessRoute): RouteSpec {
  const spec = ROUTE_TABLE[route]
  if (!spec) throw new Error(`하네스: 매니페스트에 라우트 «${route}»가 없다`)
  if (spec.driven_by === 'route') {
    throw new Error(
      `하네스: 라우트 «${route}»는 driven_by=route로 선언돼 있다. runAgent로 구동하지 않는다`,
    )
  }
  return spec
}

export function skillSpec(name: string): SkillSpec {
  const s = SKILL_TABLE[name]
  if (!s) throw new Error(`하네스: 매니페스트에 스킬 «${name}»이 없다`)
  return s
}

/** 동결된 시스템 프롬프트. 없으면 코드젠이 실패했어야 한다 */
export function promptOf(skill: string): string {
  const prompt = (PROMPTS as Record<string, string>)[skill]
  if (!prompt) {
    throw new Error(
      `하네스: 스킬 «${skill}»의 프롬프트가 registry에 없다. `
      + 'npm run build:harness로 다시 굽거나 SKILL.md의 ## 프롬프트 펜스를 확인하라',
    )
  }
  return prompt
}

export function agentOf(route: HarnessRoute): string {
  const agent = routeSpec(route).agent
  /*
   * 하네스가 구동하는 라우트는 **반드시** 에이전트가 있다 — 응답 코드를 결정하는
   * 주체가 에이전트이기 때문이다. `agent: null`은 `driven_by: "route"` 전용이고
   * 코드젠이 그 짝을 검산한다. 여기 `null`이 오면 배선이 깨진 것이다.
   */
  if (!agent) {
    throw new Error(`하네스: 라우트 «${route}»에 에이전트가 없다 (agent: null) — runAgent로 구동할 수 없다`)
  }
  if (!AGENT_TABLE[agent]) throw new Error(`하네스: 없는 에이전트 «${agent}»`)
  const declared = AGENT_TABLE[agent].routes
  if (!declared.includes(route)) {
    throw new Error(
      `하네스: 에이전트 «${agent}»의 담당 라우트에 «${route}»가 없다 (매니페스트 양방향 불일치)`,
    )
  }
  return agent
}

/* ════════════════════════════════════════════════════════════════
 * AI 예산 — 절대 원칙 1의 **기계 강제** (규약 R3)
 *
 * 「1요청 1AI호출」이 규율이던 것을 여기서 검사로 승격한다.
 * 스킬을 잘못 배선해 AI가 2번 불리면 두 번째 호출 **전에** 던진다 —
 * 호출한 뒤 세면 이미 돈과 25초를 쓴 다음이다.
 * ════════════════════════════════════════════════════════════════ */

export function assertBudget(route: HarnessRoute, skill: string, spent: number): void {
  const budget = routeSpec(route).ai_budget
  const cost = skillSpec(skill).ai
  if (cost === 0) return
  if (spent + cost > budget) {
    throw new Error(
      `하네스 규약 R3 위반: 라우트 «${route}»의 AI 예산 ${budget}회를 넘긴다 `
      + `(이미 ${spent}회 + 스킬 «${skill}» ${cost}회). `
      + '체인이 잘못 배선됐다 — manifest.json의 skills와 ai_budget을 맞춰라',
    )
  }
}
