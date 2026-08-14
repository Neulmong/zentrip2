/**
 * 🔒 하네스 규약 위반 검사 (CLAUDE.md R1~R7).
 *
 * 이 스크립트는 **규약을 지키는지**만 본다. 파이프라인이 옳은 값을 만드는지는
 * `test:policy`·`test:real`의 몫이다.
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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// `pathname`은 공백·괄호를 퍼센트 인코딩한다 — 폴더 이름에 공백이 있으면 경로가 어긋나
// 매니페스트를 못 찾는다. build-harness.mts와 같은 방식(fileURLToPath)으로 맞춘다.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
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
  agent: string | null; ai_budget: number; skills: { name: string; args?: unknown }[]
  counter: string | null; retry_from: number | null; driven_by?: string
}
interface Manifest {
  routes: Record<string, Route>
  agents: Record<string, { routes: string[]; owns_spec_skills?: string[] }>
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
/*
 * `agent: null`은 **담당 에이전트가 없는 라우트**다(편집 저장·주소 변경).
 * 에이전트 5종은 전부 생성·검증 주체이므로 억지로 배정하면 그 문서가 자기가
 * 하지 않는 일을 설명하게 된다. 대신 `driven_by: "route"`와 짝이어야 한다 —
 * 하네스가 구동하는 라우트는 응답 코드를 결정할 에이전트가 반드시 필요하다.
 */
check('라우트의 agent가 모두 실재한다 (null은 제외)',
  Object.values(m.routes).every((r) => r.agent === null || !!m.agents[r.agent]))
check('agent가 null인 라우트는 driven_by가 route다',
  Object.entries(m.routes).every(([, r]) => r.agent !== null || r.driven_by === 'route'),
  Object.entries(m.routes).filter(([, r]) => r.agent === null && r.driven_by !== 'route')
    .map(([rk]) => rk))
check('에이전트의 routes 목록이 실제 라우트와 양방향 일치한다',
  Object.entries(m.agents).every(([a, cfg]) =>
    cfg.routes.every((rk) => m.routes[rk]?.agent === a))
  && Object.entries(m.routes).every(([rk, r]) =>
    r.agent === null || m.agents[r.agent].routes.includes(rk)))

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
check(`관통 1회 AI 총합(${total}) = 선언값(${m.invariants.ai_per_script_total})`,
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

/*
 * 하네스 안쪽도 검사한다. 프롬프트를 라우트에서 `lib/harness/`로 **옮기기만**
 * 하면 이 검사가 통과하면서 규약은 깨진 상태가 된다 — 검사가 거짓말을 하는
 * 가장 흔한 방식이다. system은 `promptOf()`로만 들어가야 한다.
 */
const AI_SKILLS_SRC = p('lib', 'harness', 'ai-skills.ts')
if (existsSync(AI_SKILLS_SRC)) {
  const src = readFileSync(AI_SKILLS_SRC, 'utf8')
  check('lib/harness/ai-skills.ts의 system이 promptOf()에서만 온다',
    /system:\s*promptOf\(/.test(src) && !/system:\s*[`'"]/.test(src))
}

/*
 * R4 완결 — user 메시지의 **지시문**도 SKILL.md에서 온다.
 *
 * 데이터 조립(입력 JSON을 엮는 코드)은 TS에 남는다. 요청마다 값이 달라져 문서로
 * 동결할 수 없기 때문이다. 하지만 그 앞뒤에 붙는 **지시 문장**은 프롬프트이므로
 * `USER_PROMPTS`(코드젠 산출물)에서 꺼내 쓴다.
 *
 * 시스템 프롬프트와 달리 user 쪽은 **캐시 프리픽스가 아니다** — Gemini 컨텍스트
 * 캐시는 최장 공통 접두를 잡는데 system이 앞에 오므로, user 변경은 system 프리픽스
 * 적중을 깨지 않는다. 이것이 이 이전을 안전하게 만든 근거다.
 */
if (existsSync(AI_SKILLS_SRC)) {
  const src = readFileSync(AI_SKILLS_SRC, 'utf8')
  const 남은지시문 = [...src.matchAll(/^\s*\+? *`(?:\\n)*(?:-|각 |추가로|원문근거|아래 |참고 )[^`]*`/gm)]
    .map((x) => x[0].trim())
  check('user 메시지 지시문이 TS에 남아 있지 않다', 남은지시문.length === 0, 남은지시문)
  check('user 지시문이 userPromptOf()로 들어온다', /userPromptOf\(/.test(src))
}

for (const [name, s] of Object.entries(m.skills)) {
  const ups = (s as unknown as { user_prompt_sections?: Record<string, string> }).user_prompt_sections
  if (!ups) continue
  const md = readFileSync(p('.claude', 'skills', name, 'SKILL.md'), 'utf8')
  const have = [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((x) => x[1].trim())
  const missing = Object.values(ups).filter((w) => !have.includes(w))
  check(`${name}: 선언한 user 지시문 섹션이 SKILL.md에 실재한다`, missing.length === 0, missing)
}

/* ── 7. R1 — 라우트는 에이전트만 부른다 ────────────────────── */

section('7. R1 — 라우트가 ai()를 직접 호출하지 않는다')

const directAi = routeFiles.filter((f) => /\bai\(\)\.call\b/.test(f.src)).map((f) => f.name)
check('ai()를 직접 호출하는 라우트가 없다', directAi.length === 0, directAi)

/**
 * `driven_by: "route"`인 라우트는 하네스가 구동하지 않는다.
 *
 * 상품 행을 만들거나(`products`), `attempt_no`를 올리거나(`form-input`),
 * 사람이 조작하는 경로(`content`·`slug`)라 `runStep`의 전제가 성립하지 않는다.
 * **매니페스트에 등록하는 이유는 배선을 문서에 남기기 위해서다**(R6) —
 * 등록해 두지 않으면 그 라우트가 어떤 규칙을 실행하는지 코드에만 있게 된다.
 */
const routeDriven = new Set(
  Object.entries(m.routes).filter(([, r]) => r.driven_by === 'route').map(([rk]) => rk))

const usesRunAgent = routeFiles.filter((f) => /runAgent\(/.test(f.src)).map((f) => f.name)
const pipelineRoutes = Object.keys(m.routes).filter((r) => !routeDriven.has(r))
const notConverted = pipelineRoutes.filter((r) => !usesRunAgent.includes(r))
if (notConverted.length) {
  pending(`runAgent()로 전환된 라우트 ${usesRunAgent.length}/${pipelineRoutes.length}`,
    `미전환: ${notConverted.join(', ')}`)
} else {
  check('파이프라인 라우트가 모두 runAgent()를 쓴다', true)
}

/*
 * 라우트가 하네스 **외의** 파이프라인 모듈을 직접 import하면 R1 위반이다.
 * 전환의 요점은 「라우트가 얇아진다」가 아니라 「라우트가 배선을 모른다」다.
 */
const 직접의존 = routeFiles
  .filter((f) => pipelineRoutes.includes(f.name))
  .filter((f) => /@\/lib\/pipeline\//.test(f.src) || /@\/lib\/ai\b/.test(f.src))
  .map((f) => f.name)
check('전환된 라우트가 lib/pipeline·lib/ai를 직접 import하지 않는다',
  직접의존.length === 0, 직접의존)

/*
 * 체인의 모든 스킬에 러너가 등록돼 있는가.
 *
 * 등록이 빠지면 런타임에 던진다 — 조용히 건너뛰지 않는다. 그래도 **던지는
 * 시점이 요청 중**이므로, 배선과 등록표의 불일치는 여기서 미리 잡는다.
 *
 * **`driven_by: "route"` 라우트에만 속한 스킬은 러너를 요구하지 않는다.**
 * `runChain`이 그 라우트를 돌리지 않으므로 러너를 만들면 실행되지 않는 코드가
 * 된다 — 검사기를 만족시키려고 죽은 코드를 쓰게 하는 것이 더 나쁘다.
 * 대신 §9-1이 `impl`이 실재하고 라우트가 실제로 부르는지를 본다.
 */
section('7-1. 체인 스킬 ↔ 러너 등록표')

const IMPLS = p('lib', 'harness', 'impls.ts')
const implsSrc = existsSync(IMPLS) ? readFileSync(IMPLS, 'utf8') : ''
const aiSrc = existsSync(AI_SKILLS_SRC) ? readFileSync(AI_SKILLS_SRC, 'utf8') : ''

/**
 * 체인 러너가 둘이다.
 *
 * | 라우트 | 구동 | 러너가 사는 곳 |
 * |---|---|---|
 * | 파이프라인 6개 | `runAgent` → `runStep` | `impls.ts` · `ai-skills.ts` |
 * | `plan-draft` | `runPlanDraft` | `draft.ts` |
 *
 * `plan-draft`는 상품 행이 없어 `runStep`의 전제가 성립하지 않는다(§7.5). 그래서
 * `driven_by: "route"`이지만 **체인은 돈다** — 매니페스트 순서대로 실행하고 ai 스킬
 * 앞에서 예산을 대조한다. 러너가 없으면 런타임에 던지므로 여기서 미리 잡는다.
 */
const DRAFT_CHAIN = 'plan-draft'
const DRAFT_SRC_PATH = p('lib', 'harness', 'draft.ts')
const draftSrc = existsSync(DRAFT_SRC_PATH) ? readFileSync(DRAFT_SRC_PATH, 'utf8') : ''

const draftChained = new Set((m.routes[DRAFT_CHAIN]?.skills ?? []).map((s) => s.name))

/** 하네스가 구동하는 라우트의 체인에 들어간 스킬만 러너가 필요하다 */
const harnessChained = new Set(
  Object.entries(m.routes).filter(([rk]) => !routeDriven.has(rk))
    .flatMap(([, r]) => r.skills.map((s) => s.name)))

for (const name of [...chained]) {
  if (harnessChained.has(name)) {
    const kind = m.skills[name]?.kind
    const src = kind === 'ai' ? aiSrc : implsSrc
    const where = kind === 'ai' ? 'ai-skills.ts' : 'impls.ts'
    check(`${name} — ${where}에 러너 등록`, src.includes(`'${name}'`))
    continue
  }
  if (draftChained.has(name)) {
    check(`${name} — draft.ts에 러너 등록`, draftSrc.includes(`'${name}'`))
  }
}

/*
 * 초안 체인도 R3·R4를 지키는가. 「`runStep` 밖」은 「규약 밖」이 아니다 —
 * 예산 대조를 빠뜨리면 그 라우트만 AI를 무제한 부를 수 있게 된다.
 */
if (draftSrc) {
  check('draft.ts가 ai 스킬 앞에서 assertBudget으로 예산을 대조한다',
    /assertBudget\(/.test(draftSrc))
  check('draft.ts의 system이 promptOf()에서만 온다',
    /system:\s*promptOf\(/.test(draftSrc) && !/system:\s*[`'"]/.test(draftSrc))
  check('draft.ts의 user 지시문이 userPromptOf()로 들어온다',
    /userPromptOf\(/.test(draftSrc))
  check('draft.ts가 체인 순서를 매니페스트에서 읽는다 (하드코딩 아님)',
    /manifestRouteSpec\(/.test(draftSrc) && /spec\.skills/.test(draftSrc))
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

/* ── 9-1. 선언이 실제로 강제되는가 ───────────────────────────── */

/**
 * 매니페스트에 적혀 있지만 **아무도 읽지 않는 선언**을 잡는다.
 *
 * `asserts`가 정확히 그랬다 — 선언되고 `registry.ts`에 구워지기까지 했는데
 * 런타임에 평가하는 코드가 없었고, `impls.ts`에 손으로 베낀 검사는
 * `Array.isArray()`라 영원히 참이었다. **선언과 강제가 끊기면 빈 검사가 생긴다.**
 */
section('9-1. 매니페스트 선언이 코드로 강제된다')

const ASSERTS_FILE = p('lib', 'harness', 'asserts.ts')
const assertsSrc = existsSync(ASSERTS_FILE) ? readFileSync(ASSERTS_FILE, 'utf8') : ''
const runSrc = existsSync(p('lib', 'harness', 'run.ts'))
  ? readFileSync(p('lib', 'harness', 'run.ts'), 'utf8') : ''

check('runChain이 선언된 asserts를 실행한다',
  /ASSERTS\[/.test(runSrc) && /checkAsserts\(/.test(runSrc))

for (const [name, s] of Object.entries(m.skills)) {
  for (const a of (s as unknown as { asserts?: string[] }).asserts ?? []) {
    check(`${name}: assert «${a}»에 평가기가 있다`,
      new RegExp(`(^|\\s|,)${a}\\s*:`, 'm').test(assertsSrc), a)
  }
}

/**
 * `impl`이 **실제로 호출되는가.** §5는 「그 함수가 export되는가」만 봤다.
 * 매니페스트가 `normalizeFields`라 적고 코드가 다른 함수를 불러도 통과했다.
 */
/**
 * 호출 주체는 두 가지다.
 *   · 하네스 체인 스킬 → `impls.ts`가 부른다
 *   · `driven_by: "route"` 스킬 → **그 라우트 파일**이 직접 부른다
 *
 * 후자를 `impls.ts`에서 찾으면 실행되지 않는 러너를 쓰게 만든다. 어느 쪽이든
 * 「선언한 함수를 실제로 부르는가」를 보는 것이 이 검사의 목적이다.
 */
/**
 * `app/api/products/[id]/<라우트>/route.ts` 밖에 있는 라우트의 파일 경로.
 *
 * 전부 `{id}`를 받지 않는 라우트다 — `products`는 상품을 **만들고**,
 * `plan-draft`는 상품이 **아직 없는** 시점에 호출된다(§7.5).
 */
const ROUTE_FILES: Record<string, string[]> = {
  products: ['app', 'api', 'products', 'route.ts'],
  'plan-draft': ['app', 'api', 'plan-draft', 'route.ts'],
}

const routeSrcOf = (rk: string): string => {
  const f = routeFiles.find((x) => x.name === rk)
  if (f) return f.src
  const seg = ROUTE_FILES[rk]
  if (!seg) return ''
  const file = p(...seg)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

for (const [name, s] of Object.entries(m.skills)) {
  if (s.kind !== 'mechanical' || !s.impl) continue
  const sym = s.impl.split('#')[1]
  if (!sym) continue
  const calls = new RegExp(`\\b${sym}\\s*\\(`)

  if (harnessChained.has(name)) {
    check(`${name}: impls.ts가 «${sym}»을 실제로 호출한다`, calls.test(implsSrc), s.impl)
    continue
  }

  // 초안 체인의 스킬은 `draft.ts`가 부른다 — 라우트 파일이 아니다
  if (draftChained.has(name)) {
    check(`${name}: draft.ts가 «${sym}»을 실제로 호출한다`, calls.test(draftSrc), s.impl)
    continue
  }

  const owners = Object.entries(m.routes)
    .filter(([, r]) => r.skills.some((x) => x.name === name)).map(([rk]) => rk)
  check(`${name}: 라우트(${owners.join('·')})가 «${sym}»을 실제로 호출한다`,
    owners.some((rk) => calls.test(routeSrcOf(rk))), s.impl)
}

/** 죽은 배선 조회 함수 — 부르지 않으면 매니페스트의 `agent` 필드가 무의미하다 */
check('runAgent가 agentOf로 라우트↔에이전트 배선을 확인한다',
  /agentOf\(route\)/.test(runSrc))

/* ── 10. R5 — 에이전트 문서의 체인 표가 매니페스트와 같은가 ──── */

/**
 * 에이전트 문서는 CLAUDE.md가 「🔒 런타임 실행 근거」로 규정한 파일이다.
 * 그런데 체인의 실제 출처는 `manifest.json`이므로, 문서의 표는 **사본**이고
 * 사본은 조용히 낡는다 — 매니페스트에 스킬을 추가하고 표를 안 고쳐도
 * 런타임은 멀쩡히 돌아가기 때문에 아무도 눈치채지 못한다.
 *
 * 실제로 `memo-leak-check`가 두 에이전트 표에서 빠진 채 남아 있었고,
 * 검사기 103건이 전부 통과했다. 그 구멍을 막는 검사다.
 */
section('10. R5 — 에이전트 문서의 체인 표 ↔ 매니페스트')

/** `| 순서 | 스킬 | AI | 역할 |` 표에서 순서대로 스킬 이름을 뽑는다 */
function chainTables(md: string): { order: number; skill: string }[][] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const tables: { order: number; skill: string }[][] = []

  for (let i = 0; i < lines.length; i++) {
    if (!/^\|\s*순서\s*\|\s*스킬\s*\|/.test(lines[i])) continue
    const rows: { order: number; skill: string }[] = []
    // 헤더 다음 줄은 `|---|` 구분선이므로 건너뛴다
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
      const cells = lines[j].split('|').slice(1, -1).map((c) => c.trim())
      const skill = /`([a-z0-9-]+)`/.exec(cells[1] ?? '')?.[1]
      const order = Number(cells[0])
      if (skill && Number.isInteger(order)) rows.push({ order, skill })
    }
    if (rows.length > 0) tables.push(rows)
    i += rows.length + 1
  }
  return tables
}

for (const [agent, decl] of Object.entries(m.agents)) {
  const file = p('.claude', 'agents', `${agent}.md`)
  if (!existsSync(file)) continue
  const md = readFileSync(file, 'utf8')
  const tables = chainTables(md)

  /*
   * 표가 없는 에이전트(validator-agent)는 다른 형식으로 적는다.
   * 그 경우에도 **체인 스킬 이름이 문서 어딘가에는 나와야** 한다.
   */
  if (tables.length === 0) {
    const missing = decl.routes
      .flatMap((r) => m.routes[r]?.skills.map((s) => s.name) ?? [])
      .filter((s) => !md.includes(`\`${s}\``))
    check(`${agent}: 체인 스킬이 문서에 언급된다 (표 없음)`,
      missing.length === 0, missing)
    continue
  }

  /*
   * 라우트가 없는 에이전트(log-monitor-agent)의 표는 체인이 아니라
   * `owns_spec_skills` — 하네스 바깥을 문서화하는 kind:spec 스킬이다(R7).
   * 체인으로 대조하면 안 되고, 그렇다고 건너뛰면 이쪽 표가 낡는 것을 못 잡는다.
   */
  if (decl.routes.length === 0) {
    const want = decl.owns_spec_skills ?? []
    const got = tables[0].map((r) => r.skill)
    check(`${agent}: 표의 스킬 목록이 owns_spec_skills와 같다`,
      tables.length === 1 && got.length === want.length && got.every((s, i) => s === want[i]),
      { 문서: got, 매니페스트: want })
    check(`${agent}: 표의 스킬이 전부 kind:spec이다 (체인 실행 금지 — R7)`,
      got.every((s) => m.skills[s]?.kind === 'spec'),
      got.map((s) => `${s}:${m.skills[s]?.kind}`))
    continue
  }

  check(`${agent}: 체인 표 개수 = 담당 라우트 수`,
    tables.length === decl.routes.length,
    { 표: tables.length, 라우트: decl.routes.length })

  decl.routes.forEach((route, idx) => {
    const table = tables[idx]
    const want = m.routes[route]?.skills.map((s) => s.name) ?? []
    if (!table) return

    const got = table.map((r) => r.skill)
    check(`${agent} · ${route}: 표의 스킬 목록이 매니페스트와 같다`,
      got.length === want.length && got.every((s, i) => s === want[i]),
      { 문서: got, 매니페스트: want })

    // 번호가 1..n으로 이어지는가 — 스킬을 끼워 넣고 번호를 안 고친 경우를 잡는다
    check(`${agent} · ${route}: 표의 번호가 1..${want.length}로 이어진다`,
      table.every((r, i) => r.order === i + 1),
      table.map((r) => r.order))
  })
}

/* ── 결과 ────────────────────────────────────────────────────── */

console.log(`\n${'─'.repeat(60)}`)
console.log(`통과 ${pass} · 실패 ${fail} · 미구현 ${todo}`)
if (todo > 0) {
  console.log(`\n⏳ ${todo}건은 **알고 남겨둔 격차**다. 위반이 아니지만 통과도 아니다.`)
  console.log('   내용은 위 항목의 사유를 읽는다 — 각 항목이 왜 지금 그 상태인지 적혀 있다.')
}
if (fail > 0) {
  console.log('\n❌ 규약 위반이 있다. 커밋하지 않는다.')
  process.exit(1)
}
console.log('\n✅ 하네스 규약 위반 0건.')
