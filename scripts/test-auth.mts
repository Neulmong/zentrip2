/**
 * 로그인 시도 제한 실측 (§14.2 "IP당 분당 5회"). **AI 0회.**
 *
 * 세는 것이 **실패뿐**인지 확인한다. 성공까지 세면 정상 사용자가 자기 자신을
 * 잠그는데, 그 증상은 「테스트가 갑자기 로그인 실패한다」로 나타나 원인이
 * 앱인지 도구인지 구분되지 않는다. 실제로 그 일이 있었다.
 *
 *   npm run dev  (별도 터미널)
 *   npm run test:auth
 *
 * ⚠ 이 스위트는 **일부러 잠금 상태를 만든다.** 끝나면 창(60초)이 지나야
 *   그 IP로 다시 로그인할 수 있다. 다른 스위트보다 **나중에** 돌려라.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const GOOD = process.env.ADMIN_PASSWORD!
const BAD = 'definitely-not-the-password'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? `  → ${JSON.stringify(got)}` : ''}`) }
}
const section = (t: string) => console.log(`\n${t}`)

const login = (password: string) =>
  fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })

/* ══ 성공은 세지 않는다 ═══════════════════════════════════════════ */
section('§14.2 — 성공한 로그인은 제한에 세지 않는다')
{
  const codes: number[] = []
  for (let i = 0; i < 8; i++) codes.push((await login(GOOD)).status)
  check('연속 8회 성공이 전부 200이다 (전에는 6번째부터 429였다)',
    codes.every((c) => c === 200), codes)
}

/* ══ 실패는 센다 ═════════════════════════════════════════════════ */
section('§14.2 — 실패는 5회까지만 허용한다')
{
  const codes: number[] = []
  for (let i = 0; i < 7; i++) codes.push((await login(BAD)).status)

  check('처음 5회는 401이다 (잠금 아님)',
    codes.slice(0, 5).every((c) => c === 401), codes)
  check('6회째부터 429다 (잠금)',
    codes.slice(5).every((c) => c === 429), codes)

  const body = await (await login(BAD)).json()
  check('429 본문에 사유가 있다', body?.error === 'rate_limited', body)
  check('사유가 사람이 읽을 수 있다', /[가-힣]{4,}/.test(body?.message ?? ''), body?.message)
}

/* ══ 잠금 중에는 올바른 비밀번호도 막는다 ════════════════════════ */
section('잠금은 비밀번호가 맞아도 유지된다 (무차별 대입 방어의 핵심)')
{
  const r = await login(GOOD)
  check('잠금 중 올바른 비밀번호도 429다', r.status === 429, r.status)
  check('세션 쿠키를 발급하지 않는다', r.headers.getSetCookie().length === 0)
}

/* ══ 어떤 부분이 틀렸는지 알려주지 않는다 (§14.2) ════════════════ */
section('§14.2 — 실패 응답이 정보를 흘리지 않는다')
{
  const body = await (await login(BAD)).json()
  const text = JSON.stringify(body)
  check('비밀번호 값이 응답에 없다', !text.includes(BAD) && !text.includes(GOOD), body)
  check('길이·자릿수 같은 힌트가 없다', !/길이|자리|characters|length/i.test(text), body)
}

console.log('\n' + '─'.repeat(52))
console.log(`통과 ${pass} · 실패 ${fail}`)
console.log('※ 이 IP는 지금 잠금 상태다. 60초 뒤 풀린다.')
process.exit(fail > 0 ? 1 : 0)
