/**
 * 하네스 코드젠 — `.claude/` → `lib/harness/generated/registry.ts`.
 *
 *   npm run build:harness
 *
 * `.claude/**`는 Claude Code CLI가 읽는 파일이고 Next 번들에 들어가지 않는다
 * (어느 모듈도 import하지 않으므로 트레이싱 대상이 아니다). 그래서 빌드 타임에
 * 읽어 **동결된 TS 모듈**로 굽는다. 런타임에 파일을 읽지 않는 이유 3가지:
 *
 *   1. 번들 트레이싱 — `.claude/**`는 배포 산출물에 없다
 *   2. 캐시 적중 — 시스템 프롬프트는 요청 간 바이트 동일해야 한다(실측 913중 896).
 *      **이 저장소는 Windows다.** git이 작업 사본을 CRLF로 바꾸므로 여기서 LF로
 *      정규화해 굽지 않으면 프롬프트 바이트가 플랫폼에 따라 흔들린다
 *   3. 실패 시점 — SKILL.md가 망가졌으면 **빌드가 죽는다.** 운영 중 런타임 500보다 낫다
 *
 * `prebuild`·`predev`에 물려 있으므로 `npm run dev`·`npm run build`가 항상 최신을 쓴다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const p = (...s: string[]) => join(ROOT, ...s)

const errors: string[] = []
function fatal(msg: string) { errors.push(msg) }

/* ── 매니페스트 ──────────────────────────────────────────────── */

type SkillKind = 'ai' | 'mechanical' | 'spec'
interface Skill {
  kind: SkillKind
  ai: number
  /** spec §4.3의 3종. `plan`은 초안(§7.5) 전용이며 근거는 `lib/ai/contract.ts` */
  effort?: 'generate' | 'validate' | 'plan'
  schema?: string
  prompt_sections?: string[]
  /**
   * user 메시지의 **지시문** 섹션. `변형키 → SKILL.md 섹션명`.
   *
   * 데이터 조립(입력 JSON을 엮는 코드)은 TS에 남는다 — 요청마다 값이 달라져
   * 문서로 동결할 수 없다. 하지만 그 앞뒤에 붙는 **지시 문장**은 프롬프트이고,
   * R4에 따라 SKILL.md가 유일한 출처여야 한다.
   *
   * 변형키가 있는 이유: `fact-check`는 대상(`brochure`/`page`)에 따라 지시가
   * 다르다. `default` 하나만 쓰는 스킬이 대부분이다.
   */
  user_prompt_sections?: Record<string, string>
  impl?: string
  implemented_by?: string
  asserts?: string[]
  does?: string
}
interface Entry {
  from: string
  to: string
  reset: string
}
interface Route {
  agent: string | null
  /**
   * 로그에 남길 단계명. **없을 수 있다** — `plan-draft`(§7.5)는 상품 행이 없어
   * `execution_logs`·`abnormality_flags`에 남길 곳이 없다(둘 다 `product_id`를
   * 요구한다). 하네스가 구동하는 라우트에는 필수이며 아래 검산이 강제한다.
   */
  step?: string
  extra_steps?: string[]
  counter: string | null
  retry_from: number | null
  ai_budget: number
  /** 단계 실행 **전** 상태 전이 — [상품 생성] 진입 1건뿐이다 (§14.5 #5) */
  entry?: Entry
  /** 스킬 실행 전에 적재할 DB 재료. 스킬은 순수 함수로 남는다 */
  materials?: string[]
  driven_by?: string
  skills: { name: string; args?: Record<string, unknown> }[]
}
interface Manifest {
  version: string
  routes: Record<string, Route>
  agents: Record<string, { routes: string[] }>
  skills: Record<string, Skill>
  invariants: Record<string, unknown>
}

const MANIFEST_PATH = p('.claude', 'harness', 'manifest.json')
if (!existsSync(MANIFEST_PATH)) {
  console.error('❌ .claude/harness/manifest.json 이 없다. 배선 출처가 없으면 코드젠할 것이 없다.')
  process.exit(1)
}
const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

/* ── 프롬프트 추출 ──────────────────────────────────────────── */

/**
 * **줄바꿈을 LF로 고정한다.** 이 한 줄이 캐시 적중을 지킨다 —
 * git이 Windows 작업 사본을 CRLF로 바꿔 놓으므로 정규화 없이 구우면
 * 같은 커밋에서 플랫폼마다 다른 프롬프트가 나온다.
 */
const lf = (s: string) => s.replace(/\r\n/g, '\n')

/**
 * SKILL.md에서 `## <섹션>` 하나를 꺼낸다. 다음 `## `까지가 그 섹션이다.
 * 못 찾으면 `null` — 호출부가 빌드를 실패시킨다.
 */
function section(md: string, name: string): string | null {
  const re = new RegExp(`^## ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm')
  const m = re.exec(md)
  if (!m) return null
  const start = m.index + m[0].length
  const rest = md.slice(start)
  const next = /^## /m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

/**
 * 프롬프트 본문은 섹션 안의 ```text 펜스다.
 *
 * 섹션 산문을 그대로 쓰지 않는 이유: `## 프롬프트` 섹션에는 「이 블록을 고치면
 * 캐시가 깨진다」 같은 **사람에게 하는 경고**가 함께 있다. 그 경고가 프롬프트에
 * 섞이면 AI에게 엉뚱한 지시를 보내게 된다. 펜스가 실행되는 경계다.
 */
function fence(sectionBody: string): string | null {
  const open = '```text\n'
  const i = sectionBody.indexOf(open)
  if (i < 0) return null
  /*
   * ⚠️ 펜스 안에 `## `로 시작하는 줄을 두면 **프롬프트가 조용히 잘린다.**
   * `section()`이 다음 `^## `까지를 섹션으로 보기 때문이다 — 그 줄이 펜스
   * 안이라는 것을 모른다. 실제로 겪은 결함이라(2026-08-12) 여기서 막는다.
   * 프롬프트 안의 소제목은 `[제목]`처럼 적는다.
   */
  if (/^## /m.test(sectionBody.slice(i))) return null
  const start = i + open.length
  const end = sectionBody.indexOf('\n```', start)
  if (end < 0) return null
  const body = sectionBody.slice(start, end)
  // 펜스가 2개 이상이면 어느 것이 프롬프트인지 모호하다 — 실패시킨다
  if (sectionBody.indexOf(open, end) >= 0) return null
  return body
}

const prompts: Record<string, string> = {}
const userPrompts: Record<string, Record<string, string>> = {}

for (const [name, skill] of Object.entries(manifest.skills)) {
  if (skill.kind !== 'ai') continue

  const mdPath = p('.claude', 'skills', name, 'SKILL.md')
  if (!existsSync(mdPath)) { fatal(`${name}: SKILL.md가 없다 (${mdPath})`); continue }
  const md = lf(readFileSync(mdPath, 'utf8'))

  const declared = skill.prompt_sections
  if (!declared?.length) { fatal(`${name}: kind:ai인데 prompt_sections가 비어 있다`); continue }
  if (!skill.schema) { fatal(`${name}: kind:ai인데 schema가 없다`); continue }
  if (!skill.effort) { fatal(`${name}: kind:ai인데 effort가 없다`); continue }

  const parts: string[] = []
  let broke = false
  for (const secName of declared) {
    const body = section(md, secName)
    if (body === null) {
      fatal(`${name}: 선언한 섹션 «## ${secName}»가 SKILL.md에 없다. `
        + '프롬프트가 조용히 비는 것을 막기 위해 빌드를 실패시킨다')
      broke = true; break
    }
    const f = fence(body)
    if (f === null) {
      fatal(`${name}: «## ${secName}» 안에 \`\`\`text 펜스가 정확히 1개 있어야 한다. `
        + '펜스가 없거나 2개 이상이면 어디까지가 프롬프트인지 모호하다')
      broke = true; break
    }
    parts.push(f)
  }
  if (broke) continue

  const prompt = parts.join('\n\n')
  if (!prompt.trim()) { fatal(`${name}: 프롬프트가 비어 있다`); continue }
  prompts[name] = prompt

  /* user 지시문 — 있으면 변형키별로 굽는다 */
  for (const [variant, secName] of Object.entries(skill.user_prompt_sections ?? {})) {
    const body = section(md, secName)
    if (body === null) {
      fatal(`${name}: user 지시문 섹션 «## ${secName}»가 SKILL.md에 없다 (변형 «${variant}»)`)
      continue
    }
    const f = fence(body)
    if (f === null) {
      fatal(`${name}: «## ${secName}» 안에 \`\`\`text 펜스가 정확히 1개 있어야 한다`)
      continue
    }
    if (!f.trim()) { fatal(`${name}: user 지시문 «${variant}»가 비어 있다`); continue }
    ;(userPrompts[name] ??= {})[variant] = f
  }
}

/* ── 배선 검산 (코드젠도 자기 입력을 믿지 않는다) ───────────── */

for (const [rk, route] of Object.entries(manifest.routes)) {
  const sum = route.skills.reduce((a, s) => {
    const sk = manifest.skills[s.name]
    if (!sk) { fatal(`라우트 ${rk}: 선언되지 않은 스킬 «${s.name}»`); return a }
    if (sk.kind === 'spec') fatal(`라우트 ${rk}: kind:spec 스킬 «${s.name}»이 체인에 있다 (R7 — 로그가 두 번 쌓인다)`)
    return a + sk.ai
  }, 0)
  if (sum !== route.ai_budget) fatal(`라우트 ${rk}: 체인 AI 합계 ${sum} ≠ 선언 예산 ${route.ai_budget}`)

  /*
   * `agent: null`은 **담당 에이전트가 없는 라우트**다 — 편집 저장·주소 변경처럼
   * 사람이 조작하고 서버는 계약만 검사하는 경로다. 에이전트 5종은 전부 생성·검증
   * 주체이므로 억지로 배정하면 그 에이전트 문서가 자기가 하지 않는 일을 설명한다.
   *
   * 단 **하네스가 구동하는 라우트는 반드시 에이전트가 있어야 한다** — `runAgent`가
   * `agentOf`로 배선을 확인하고, 응답 코드를 결정하는 주체가 에이전트이기 때문이다.
   */
  if (route.agent === null) {
    if (route.driven_by !== 'route') {
      fatal(`라우트 ${rk}: agent가 null인데 driven_by가 "route"가 아니다 — 하네스가 구동할 수 없다`)
    }
  } else if (!manifest.agents[route.agent]) {
    fatal(`라우트 ${rk}: 없는 에이전트 «${route.agent}»`)
  }

  /*
   * `step`이 없어도 되는 것은 **로그를 남길 수 없는 라우트뿐이다.** `runStep`은
   * 단계명으로 로그를 쓰므로(§5.4), 하네스가 구동하는 라우트에 `step`이 없으면
   * 실행 이력이 조용히 비게 된다 — 그 상태로 배포되면 관리 화면(§14.3)에
   * 아무것도 안 보이고 원인을 찾을 단서도 없다.
   */
  if (!route.step && route.driven_by !== 'route') {
    fatal(`라우트 ${rk}: step이 없는데 driven_by가 "route"가 아니다 — runStep이 로그를 남길 단계명이 없다`)
  }
}

if (errors.length) {
  console.error(`\n❌ 코드젠 실패 — ${errors.length}건\n`)
  for (const e of errors) console.error(`   · ${e}`)
  console.error('\n산출물을 쓰지 않았다. 위 항목을 고친 뒤 다시 돌려라.\n')
  process.exit(1)
}

/* ── 산출 ────────────────────────────────────────────────────── */

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12)

/** TS 문자열 리터럴로 굽는다. 백틱을 쓰지 않는다 — 프롬프트에 백틱이 들어와도 안전하다. */
const lit = (s: string) => JSON.stringify(s)

const aiSkills = Object.keys(prompts).sort()

const out = `/**
 * ⚠️ 자동 생성 파일 — 직접 편집하지 마라.
 *
 *   생성: npm run build:harness  (scripts/build-harness.mts)
 *   출처: .claude/harness/manifest.json · .claude/skills/<스킬>/SKILL.md
 *
 * (경로에 별표+슬래시를 쓰지 않는다 — 블록 주석을 조기에 닫아 파일이 문법 오류가 된다)
 *
 * 프롬프트를 바꾸려면 해당 SKILL.md의 \`## 프롬프트\` 펜스를 고치고 다시 굽는다.
 * 이 파일을 고쳐도 다음 빌드에서 덮어써진다 (규약 R4·R5).
 *
 * 줄바꿈은 LF로 정규화돼 있다 — 프롬프트 바이트가 플랫폼에 따라 흔들리면
 * 실측 재현 조건이 달라지고 Gemini 컨텍스트 캐시(유료 티어) 적중이 깨진다.
 */

export type SkillKind = 'ai' | 'mechanical' | 'spec'

export interface SkillSpec {
  readonly kind: SkillKind
  readonly ai: number
  readonly effort?: 'generate' | 'validate' | 'plan'
  readonly schema?: string
  readonly impl?: string
  readonly implemented_by?: string
  readonly asserts?: readonly string[]
  readonly does?: string
}

export interface RouteSpec {
  readonly agent: string | null
  /** 로그 단계명. \`driven_by: "route"\`이고 로그를 남기지 않는 라우트에는 없다 */
  readonly step?: string
  readonly extra_steps?: readonly string[]
  readonly counter: string | null
  readonly retry_from: number | null
  readonly ai_budget: number
  readonly entry?: { readonly from: string; readonly to: string; readonly reset: string }
  readonly materials?: readonly string[]
  readonly driven_by?: string
  readonly skills: readonly { readonly name: string; readonly args?: Readonly<Record<string, unknown>> }[]
}

/** 매니페스트 버전 — spec 판본과 맞춘다 */
export const HARNESS_VERSION = ${lit(manifest.version)}

/** 동결된 시스템 프롬프트. 요청 간 바이트 동일하다 */
export const PROMPTS = {
${aiSkills.map((n) => `  ${lit(n)}: ${lit(prompts[n])},`).join('\n')}
} as const

/** 감사용 — SKILL.md를 고치면 이 값이 바뀐다 (문서가 load-bearing임의 증거) */
export const PROMPT_HASHES = {
${aiSkills.map((n) => `  ${lit(n)}: ${lit(sha(prompts[n]))},`).join('\n')}
} as const

/**
 * user 메시지의 **지시문**. 데이터 조립은 TS가 하고 지시 문장은 여기서 온다.
 *
 * 변형키가 있는 이유: \`fact-check\`는 대상(brochure/page)에 따라 지시가 다르다.
 *
 * 시스템 프롬프트와 달리 이것은 **캐시 프리픽스가 아니다** — Gemini 컨텍스트
 * 캐시는 최장 공통 접두를 잡는데 system이 앞에 오므로, user 쪽 변경은 system
 * 프리픽스 적중을 깨지 않는다.
 */
export const USER_PROMPTS = {
${Object.keys(userPrompts).sort().map((n) => `  ${lit(n)}: {\n`
  + Object.keys(userPrompts[n]).sort()
    .map((v) => `    ${lit(v)}: ${lit(userPrompts[n][v])},`).join('\n')
  + '\n  },').join('\n')}
} as const

export const SKILLS = ${JSON.stringify(
  Object.fromEntries(Object.entries(manifest.skills).map(([n, s]) => [n, {
    kind: s.kind, ai: s.ai,
    ...(s.effort ? { effort: s.effort } : {}),
    ...(s.schema ? { schema: s.schema } : {}),
    ...(s.impl ? { impl: s.impl } : {}),
    ...(s.implemented_by ? { implemented_by: s.implemented_by } : {}),
    ...(s.asserts ? { asserts: s.asserts } : {}),
    ...(s.does ? { does: s.does } : {}),
  }])), null, 2)} as const satisfies Readonly<Record<string, SkillSpec>>

/**
 * ⚠️ 주석 대신 \`satisfies\`를 쓴다.
 *
 * \`: Readonly<Record<string, RouteSpec>>\`로 적으면 키가 \`string\`으로 넓어져
 * \`RouteKey\`가 사실상 \`string\`이 된다. 그러면 라우트 이름을 잘못 적어도
 * 컴파일이 통과한다 — 배선 오타가 런타임까지 살아남는 경로다.
 */
export const ROUTES = ${JSON.stringify(
  Object.fromEntries(Object.entries(manifest.routes).map(([rk, r]) => [rk, {
    agent: r.agent,
    ...(r.step ? { step: r.step } : {}),
    ...(r.extra_steps ? { extra_steps: r.extra_steps } : {}),
    counter: r.counter, retry_from: r.retry_from,
    ai_budget: r.ai_budget,
    ...(r.entry ? { entry: { from: r.entry.from, to: r.entry.to, reset: r.entry.reset } } : {}),
    ...(r.materials ? { materials: r.materials } : {}),
    ...(r.driven_by ? { driven_by: r.driven_by } : {}),
    skills: r.skills,
  }])), null, 2)} as const satisfies Readonly<Record<string, RouteSpec>>

export const AGENTS = ${JSON.stringify(
  Object.fromEntries(Object.entries(manifest.agents).map(([a, c]) => [a, { routes: c.routes }])), null, 2)} as const satisfies Readonly<Record<string, { readonly routes: readonly string[] }>>

export type RouteKey = keyof typeof ROUTES
export type AiSkillName = keyof typeof PROMPTS
`

const OUT_DIR = p('lib', 'harness', 'generated')
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'registry.ts'), out, 'utf8')

console.log('✅ lib/harness/generated/registry.ts')
console.log(`   매니페스트 ${manifest.version} · 라우트 ${Object.keys(manifest.routes).length}`
  + ` · 스킬 ${Object.keys(manifest.skills).length} · 프롬프트 ${aiSkills.length}`)
for (const n of aiSkills) {
  console.log(`   ${sha(prompts[n])}  ${String(prompts[n].length).padStart(5)}자  ${n}`)
}
