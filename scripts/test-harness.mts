/**
 * 🔒 하네스 규약 위반 검사 (CLAUDE.md R1~R7).
 *
 * 이 스크립트는 **규약을 지키는지**만 본다. 파이프라인이 옳은 값을 만드는지는
 * `test:policy`·`test:demo`의 몫이다.
 *
 * 두 계층을 나눠 판정한다:
 *   · 문서 계층 — `.claude/harness/manifest.json` + SKILL.md·에이전트 문서의 정합성
 *   · 실행 계층 — `lib/harness/`가 실제로 라우트를 대체했는지
 *
 * 실행 계층이 아직 없으면 그 항목은 **미구현으로 보고**하고 문서 계층만 채점한다.
 * 전환이 끝나면 실행 계층 검사가 자동으로 켜진다.
 *
 *   npm run test:harness
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const p = (...s: string[]) => join(ROOT, ...s)

let pass = 0, fail = 0, todo = 0
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? `  → ${JSON.stringify(got)}` : ''}`) }
}
function pending(name: string, detail: string) {
  todo++; console.log(`  ⏳ ${name}  → ${detail}`)
}
function section(t: string) { console.log(`\n${t}`) }

/* ── 매니페스트 ──────────────────────────────────────────────── */

type SkillKind = 'ai' | 'mechanical' | 'spec'
interface Skill {
  kind: SkillKind; ai: number; impl?: string; implemented_by?: string
  effort?: string; schema?: string; prompt_sections?: string[]
}
interface Route {
  agent: string; ai_budget: number; skills: { name: string; args?: unknown }[]
  counter: string | null; retry_from: number | null
}
interface Manifest {
  routes: Record<string, Route>
  agents: Record<string, { routes: string[] }>
  skills: Record<string, Skill>
  invariants: { ai_per_route_max: number; ai_per_script_total: number }
}

const MANIFEST_PATH = p('.claude', 'harness', 'manifest.json')
if (!existsSync(MANIFEST_PATH)) {
  console.log('❌ .claude/harness/manifest.json 이 없다. 하네스의 배선 출처가 없으면 아무것도 검사할 수 없다.')
  process.exit(1)
}
const m: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

/** 파이프라인 밖 스킬 — 하네스 대상이 아니다 */
const OUT_OF_SCOPE = new Set(['grilling', 'grill-me'])

/* ── 1. 문서 계층 — 매니페스트 ↔ 실제 파일 ─────────────────── */

section('1. 매니페스트와 실제 파일이 일치한다')

const skillDirs = readdirSync(p('.claude', 'skills')).filter((d) => !OUT_OF_SCOPE.has(d))
const agentFiles = readdirSync(p('.claude', 'agents')).map((f) => f.replace(/\.md$/, ''))
const declared = Object.keys(m.skills)

check('선언된 모든 스킬에 디렉터리가 있다',
  declared.every((s) => skillDirs.includes(s)),
  declared.filter((s) => !skillDirs.includes(s)))
check('모든 스킬 디렉터리가 매니페스트에 선언돼 있다 (고아 스킬 0건)',
  skillDirs.every((d) => !!m.skills[d]),
  skillDirs.filter((d) => !m.skills[d]))
check('선언된 모든 스킬에 SKILL.md가 있다',
  declared.every((s) => existsSync(p('.claude', 'skills', s, 'SKILL.md'))),
  declared.filter((s) => !existsSync(p('.claude', 'skills', s, 'SKILL.md'))))
check('선언된 모든 에이전트에 문서가 있다',
  Object.keys(m.agents).every((a) => agentFiles.includes(a)),
  Object.keys(m.agents).filter((a) => !agentFiles.includes(a)))
check('모든 에이전트 문서가 매니페스트에 선언돼 있다',
  agentFiles.every((a) => !!m.agents[a]),
  agentFiles.filter((a) => !m.agents[a]))
check('라우트의 agent가 모두 실재한다',
  Object.values(m.routes).every((r) => !!m.agents[r.agent]))
check('에이전트의 routes 목록이 실제 라우트와 양방향 일치한다',
  Object.entries(m.agents).every(([a, cfg]) =>
    cfg.routes.every((rk) => m.routes[rk]?.agent === a))
  && Object.entries(m.routes).every(([rk, r]) => m.agents[r.agent].routes.includes(rk)))

/* ── 2. R3 — AI 예산 (API 호출 최소화) ──────────────────────── */

section('2. R3 — AI 예산. 라우트당 최대 1회')

let total = 0
for (const [rk, r] of Object.entries(m.routes)) {
  const sum = r.skills.reduce((a, s) => a + (m.skills[s.name]?.ai ?? NaN), 0)
  total += r.ai_budget
  check(`${rk}: 체인 AI 합계(${sum}) = 선언 예산(${r.ai_budget})`, sum === r.ai_budget, { sum, declared: r.ai_budget })
  check(`${rk}: 예산이 상한(${m.invariants.ai_per_route_max})을 넘지 않는다`,
    r.ai_budget <= m.invariants.ai_per_route_max, r.ai_budget)
}
check(`대본 1회 AI 총합(${total}) = 선언값(${m.invariants.ai_per_script_total})`,
  total === m.invariants.ai_per_script_total, total)

const aiSkillsPerRoute = Object.entries(m.routes).map(([rk, r]) =>
  [rk, r.skills.filter((s) => m.skills[s.name]?.kind === 'ai').length] as const)
check('한 라우트에 ai 스킬이 2개 이상 들어간 곳이 없다',
  aiSkillsPerRoute.every(([, n]) => n <= 1),
  aiSkillsPerRoute.filter(([, n]) => n > 1))

/* ── 3. R7 — spec 스킬은 체인에서 실행되지 않는다 ───────────── */

section('3. R7 — spec 스킬은 체인에 들어가지 않는다 (로그 이중 기록 방지)')

const chained = new Set(Object.values(m.routes).flatMap((r) => r.skills.map((s) => s.name)))
const specInChain = [...chained].filter((s) => m.skills[s]?.kind === 'spec')
check('체인에 kind:spec 스킬이 없다', specInChain.length === 0, specInChain)

const orphans = declared.filter((s) => m.skills[s].kind !== 'spec' && !chained.has(s))
check('spec이 아닌 스킬은 모두 어느 체인에 속한다 (죽은 스킬 0건)', orphans.length === 0, orphans)

/* ── 4. 스킬 선언의 내적 정합성 ─────────────────────────────── */

section('4. 스킬 선언이 kind와 앞뒤가 맞는다')

for (const [name, s] of Object.entries(m.skills)) {
  if (s.kind === 'ai') {
    check(`${name}: ai 스킬은 ai=1 · effort · schema · prompt_sections를 갖는다`,
      s.ai === 1 && !!s.effort && !!s.schema && Array.isArray(s.prompt_sections) && s.prompt_sections.length > 0)
  } else {
    check(`${name}: ${s.kind} 스킬은 ai=0이다`, s.ai === 0, s.ai)
  }
}
/**
 * 선언한 프롬프트 섹션이 SKILL.md에 실제로 있는가.
 *
 * 이 검사가 없어서 실제 결함을 놓쳤다 — `prompt_sections`를 실제 섹션 제목을 읽지 않고
 * 선언해 5개 스킬 전부 어긋났고, 코드젠이 프롬프트에서 9개 섹션을 조용히 빼먹을 상태였다.
 * 코드젠도 같은 것을 검사하지만(빌드 실패), 여기서 먼저 잡아야 빌드를 돌리기 전에 안다.
 */
for (const [name, s] of Object.entries(m.skills)) {
  if (s.kind !== 'ai' || !s.prompt_sections) continue
  const md = readFileSync(p('.claude', 'skills', name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n')
  const have = [...md.matchAll(/^##\s+(.+)$/gm)].map((x) => x[1].trim())
  const missing = s.prompt_sections.filter((w) => !have.includes(w))
  check(`${name}: 선언한 프롬프트 섹션이 SKILL.md에 실재한다`, missing.length === 0, missing)
}

check('mechanical 스킬은 impl을 갖는다',
  Object.entries(m.skills).filter(([, s]) => s.kind === 'mechanical').every(([, s]) => !!s.impl),
  Object.entries(m.skills).filter(([, s]) => s.kind === 'mechanical' && !s.impl).map(([n]) => n))
check('spec 스킬은 implemented_by를 갖는다',
  Object.entries(m.skills).filter(([, s]) => s.kind === 'spec').every(([, s]) => !!s.implemented_by),
  Object.entries(m.skills).filter(([, s]) => s.kind === 'spec' && !s.implemented_by).map(([n]) => n))

/* ── 5. impl·implemented_by 대상이 실재한다 ─────────────────── */

section('5. impl · implemented_by가 가리키는 코드가 실재한다')

/** `pipeline/normalize#buildConfirmedData` → { file, export } */
function resolveImpl(ref: string): { file: string; sym: string | null } {
  const [modPart, sym] = ref.split('#')
  const file = modPart.startsWith('lib/') ? p(modPart) : p('lib', `${modPart}.ts`)
  return { file: file.endsWith('.ts') ? file : `${file}.ts`, sym: sym ?? null }
}

for (const [name, s] of Object.entries(m.skills)) {
  const ref = s.impl ?? s.implemented_by
  if (!ref) continue
  const { file, sym } = resolveImpl(ref)
  if (!existsSync(file)) { check(`${name}: ${ref} — 파일 존재`, false, file); continue }
  if (!sym) { check(`${name}: ${ref} — 파일 존재`, true); continue }
  const src = readFileSync(file, 'utf8')
  const found = new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${sym}\\b`).test(src)
  if (found) check(`${name}: ${ref}`, true)
  else if (String(m.skills[name].impl ?? '').length && /^(new|split_from)/.test(String((m.skills[name] as unknown as Record<string, unknown>).status ?? '')))
    pending(`${name}: ${ref}`, '미구현 — 매니페스트가 목표를 선언했고 코드가 따라와야 한다 (R6)')
  else check(`${name}: ${ref} — export 존재`, false, `${sym} not exported from ${file}`)
}

/* ── 6. R4 — 프롬프트는 SKILL.md에만 있다 ──────────────────── */

section('6. R4 — 프롬프트가 TS 코드에 없다')

const AI_CONTRACTS = p('lib', 'pipeline', 'ai-contracts.ts')
const contractsSrc = existsSync(AI_CONTRACTS) ? readFileSync(AI_CONTRACTS, 'utf8') : ''
const systemConsts = [...contractsSrc.matchAll(/export const (\w*_SYSTEM)\b/g)].map((x) => x[1])
check('lib/pipeline/ai-contracts.ts에 *_SYSTEM 프롬프트 상수가 없다',
  systemConsts.length === 0, systemConsts)

const routeDir = p('app', 'api', 'products', '[id]')
const routeFiles = existsSync(routeDir)
  ? readdirSync(routeDir).filter((d) => existsSync(join(routeDir, d, 'route.ts')))
      .map((d) => ({ name: d, src: readFileSync(join(routeDir, d, 'route.ts'), 'utf8') }))
  : []
const withPrompt = routeFiles.filter((f) => /_SYSTEM|system:\s*[`'"]/.test(f.src)).map((f) => f.name)
check('라우트에 시스템 프롬프트 문자열이 없다', withPrompt.length === 0, withPrompt)

/* ── 7. R1 — 라우트는 에이전트만 부른다 ────────────────────── */

section('7. R1 — 라우트가 ai()를 직접 호출하지 않는다')

const directAi = routeFiles.filter((f) => /\bai\(\)\.call\b/.test(f.src)).map((f) => f.name)
check('ai()를 직접 호출하는 라우트가 없다', directAi.length === 0, directAi)

const usesRunAgent = routeFiles.filter((f) => /runAgent\(/.test(f.src)).map((f) => f.name)
const pipelineRoutes = Object.keys(m.routes).filter((r) => r !== 'products')
const notConverted = pipelineRoutes.filter((r) => !usesRunAgent.includes(r))
if (notConverted.length) {
  pending(`runAgent()로 전환된 라우트 ${usesRunAgent.length}/${pipelineRoutes.length}`,
    `미전환: ${notConverted.join(', ')}`)
} else {
  check('파이프라인 라우트가 모두 runAgent()를 쓴다', true)
}

/* ── 8. 실행 계층이 존재하는가 ──────────────────────────────── */

section('8. 실행 계층 (lib/harness/)')

const RUNTIME = [
  ['lib/harness/run.ts', 'runAgent — 체인 실행 + AI 예산 강제'],
  ['lib/harness/loader.ts', '매니페스트 조회'],
  ['lib/harness/impls.ts', 'mechanical 스킬 등록표'],
  ['lib/harness/generated/registry.ts', '코드젠 산출물 (동결 프롬프트)'],
  ['scripts/build-harness.mts', '.claude/ → registry 코드젠'],
] as const
for (const [rel, what] of RUNTIME) {
  if (existsSync(p(rel))) check(`${rel} — ${what}`, true)
  else pending(`${rel} — ${what}`, '미구현')
}

/* ── 9. 드리프트 — 커밋된 산출물이 .claude/와 일치하는가 ────── */

section('9. 코드젠 산출물 드리프트')

const REG = p('lib', 'harness', 'generated', 'registry.ts')
if (!existsSync(REG)) {
  pending('registry.ts 드리프트 검사', '산출물이 없다 — npm run build:harness')
} else {
  const reg = readFileSync(REG, 'utf8')

  /** SKILL.md의 `## 프롬프트` 펜스를 코드젠과 같은 규칙으로 뽑는다 */
  function fenceOf(skill: string): string | null {
    const md = readFileSync(p('.claude', 'skills', skill, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n')
    const sec = md.split(/^## /m).find((s) => s.startsWith('프롬프트'))
    if (!sec) return null
    const open = '```text\n'
    const i = sec.indexOf(open)
    if (i < 0) return null
    const start = i + open.length
    const end = sec.indexOf('\n```', start)
    return end < 0 ? null : sec.slice(start, end)
  }

  for (const [name, s] of Object.entries(m.skills)) {
    if (s.kind !== 'ai') continue
    const f = fenceOf(name)
    if (f === null) { check(`${name}: 프롬프트 펜스 추출`, false); continue }
    const want = createHash('sha256').update(f, 'utf8').digest('hex').slice(0, 12)
    // registry.ts의 PROMPT_HASHES에 박힌 값과 대조한다
    const got = new RegExp(`"${name}": "([0-9a-f]{12})"`).exec(reg)?.[1]
    check(`${name}: SKILL.md ↔ registry.ts 해시 일치`, got === want, { registry: got, skillMd: want })
  }

  check('registry.ts의 라우트 수가 매니페스트와 같다',
    (reg.match(/"agent":/g) ?? []).length === Object.keys(m.routes).length)
}

/* ── 결과 ────────────────────────────────────────────────────── */

console.log(`\n${'─'.repeat(60)}`)
console.log(`통과 ${pass} · 실패 ${fail} · 미구현 ${todo}`)
if (todo > 0) {
  console.log(`\n⏳ 미구현 ${todo}건은 문서 계층이 선언했고 코드가 아직 따라오지 않은 항목이다.`)
  console.log('   규약 R6의 정상 순서(문서 먼저 → 코드 다음)이며, 전환이 끝나면 0이 된다.')
}
if (fail > 0) {
  console.log('\n❌ 규약 위반이 있다. 커밋하지 않는다.')
  process.exit(1)
}
console.log('\n✅ 하네스 규약 위반 0건.')
