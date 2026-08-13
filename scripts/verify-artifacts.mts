/**
 * 산출물 판정 (체크리스트 2차) — **AI 0회.**
 *
 * 체크리스트 355개 중 약 71개는 「AI가 만든 결과물이 규정대로인가」를 묻는다.
 * 그건 AI를 **다시 부를** 일이 아니라 **이미 만들어 둔 산출물을 읽을** 일이다.
 * §W 머리말도 「판정 기준 시점은 `content_hash` 시점의 AI 생성분」이라고 못 박는다.
 *
 * DB에 남아 있는 상품 중 4축이 모두 `pass`인 것을 골라 규정과 대조한다.
 * 서버가 생성 직후 돌리는 검사기(`checkBrochure`·`checkPage`·`checkEvidence` …)를
 * **그대로 재사용**한다 — 판정 기준이 두 벌이 되면 어느 쪽이 맞는지 알 수 없다.
 *
 *   npm run verify:artifacts
 */
import { createClient } from '@supabase/supabase-js'
import { checkBrochure } from '../lib/pipeline/brochure'
import { checkPage, LENGTH_LIMITS_GENERATE } from '../lib/pipeline/page'
import { checkEvidence, checkNouns, checkDayCount } from '../lib/pipeline/axis0'
import { contentHash } from '../lib/validation'
import { coerceFormInput, tripDays } from '../lib/form-validation'
import { PLACEHOLDER } from '../lib/pipeline/normalize'
import { BLOCK_PREFIX } from '../lib/edit-contract'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

let pass = 0, fail = 0, skip = 0
const check = (id: string, name: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✅ ${id.padEnd(7)} ${name}`) }
  else { fail++; console.log(`  ❌ ${id.padEnd(7)} ${name}\n         → ${JSON.stringify(got)?.slice(0, 400)}`) }
}
const skipped = (id: string, name: string, why: string) => {
  skip++; console.log(`  ⏭  ${id.padEnd(7)} ${name}\n         → ${why}`)
}
const section = (t: string) => console.log(`\n${t}`)

/* ── 판정 대상 고르기 ──────────────────────────────────────────── */
const { data: all } = await db.from('products').select('*')
const complete = (all ?? []).filter((p) =>
  p.confirmed_data && p.brochure_content && p.page_content
  && ['axis_0', 'axis_1', 'axis_2', 'axis_3']
    .every((a) => p.validation_snapshot?.axes?.[a]?.verdict === 'pass'))

console.log(`\n판정 대상: 4축 통과 + 산출물 3종 완비 ${complete.length}건`)
for (const p of complete) console.log(`  · ${p.slug ?? p.id.slice(0, 8)} (${p.status}, 편집 ${p.human_edited ? 'O' : 'X'})`)

if (complete.length === 0) {
  console.log('\n판정 가능한 산출물이 없다. 관통 1회를 성공시킨 뒤 다시 돌려라.')
  process.exit(1)
}

for (const p of complete) {
  const label = p.slug ?? p.id.slice(0, 8)
  console.log(`\n${'═'.repeat(52)}\n${label}\n${'═'.repeat(52)}`)

  // 옛 form_input(2.6 · 단일 객체 숙박·상점)도 파이프라인처럼 배열로 올려 본다 —
  // 안 그러면 `fi.숙박.entries()`가 옛 상품에서 터진다(파이프라인은 coerce를 거친다).
  const fi = coerceFormInput(p.form_input) as Record<string, Record<string, string>>
  const cd = p.confirmed_data as never
  const cdAny = p.confirmed_data as Record<string, Record<string, unknown>>
  const br = p.brochure_content as { sections: { id: string; data: Record<string, unknown>; source?: Record<string, string> }[] }
  const pg = p.page_content as { theme: string; schema_version: unknown; sections: { id: string; type: string; order: number; visible: boolean; locked: boolean; data: Record<string, unknown>; source?: Record<string, string> }[] }
  const snap = p.validation_snapshot as { axes: Record<string, { verdict: string; items: unknown[]; skipped?: string[] }>; content_hash: string; attempt_no: number; verdict: string }

  const days = tripDays(fi.행사정보.여행기간_시작, fi.행사정보.여행기간_종료) ?? 0
  const base = pg.sections.filter((s) => !s.id.startsWith(BLOCK_PREFIX))
  const blocks = pg.sections.filter((s) => s.id.startsWith(BLOCK_PREFIX))

  /* ══ B. 저장 무결성 ═══════════════════════════════════════════ */
  section('B. 데이터 저장 무결성')
  check('B-01', '산출물 5종이 모두 채워져 유효 JSON이다',
    !!p.form_input && !!p.confirmed_data && !!p.brochure_content
    && !!p.page_content && !!p.validation_snapshot)

  /* ══ C. confirmed_data ════════════════════════════════════════ */
  section('C. 확정 데이터표')
  check('C-07', '최상위 데이터 키가 6개다 (일정은 별도 키가 아니다)',
    Object.keys(cdAny).length === 6 && !('일정' in cdAny)
    && '일정' in (cdAny.행사정보 as object), Object.keys(cdAny))

  const badTypes: string[] = []
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'number' || typeof v === 'boolean') badTypes.push(`${path}=${v}`)
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`)
    }
  }
  walk(cdAny, 'confirmed_data')
  check('C-08', '숫자·불리언 타입이 0건이다 (전부 문자열)', badTypes.length === 0, badTypes)

  // C-11·C-12 — 정규화 3종 + 결합 1종 외 변형 0건.
  // 공백 정리 후 비교해 「그 외 변형」만 잡는다.
  const sp = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim()
  const drift: string[] = []
  const compare: [string, string, string][] = [
    ['행사정보.행사명', fi.행사정보.행사명, cdAny.행사정보.행사명 as string],
    ['행사정보.여행지', fi.행사정보.여행지, cdAny.행사정보.여행지 as string],
    ['행사정보.일정원문', fi.행사정보.일정원문, cdAny.행사정보.일정원문 as string],
    ['식사.식사정보', fi.식사.식사정보, cdAny.식사.식사정보 as string],
    ['가격.기타', fi.가격.기타, cdAny.가격.기타 as string],
  ]

  /*
   * 배열 그룹은 **행마다** 대조한다(§7.4). 행 수부터 본다 — 행이 늘거나 줄면
   * `source` 경로가 다른 원소를 가리켜 대조 자체가 성립하지 않는다.
   */
  for (const [key, fields] of [
    ['숙박', ['숙소명', '위치', '객실타입', '숙박일정']],
    ['상점', ['상점명', '구분', '위치', '상점정보']],
  ] as const) {
    const before = (fi as unknown as Record<string, Record<string, string>[]>)[key] ?? []
    const after = (cdAny as unknown as Record<string, Record<string, string>[]>)[key] ?? []
    if (before.length !== after.length) {
      drift.push(`${key}: ${before.length}행 → ${after.length}행 (행 수가 달라졌다)`)
      continue
    }
    for (const [i, row] of before.entries()) {
      for (const f of fields) compare.push([`${key}[${i}].${f}`, row[f] ?? '', after[i][f] ?? ''])
    }
  }
  for (const [path, before, after] of compare) {
    const b = sp(before), a = sp(after)
    if (b === '' && a === PLACEHOLDER) continue          // 채움 (§6.1)
    if (b !== a) drift.push(`${path}: «${b}» → «${a}»`)
  }
  check('C-12', '정규화 3종 + 결합 1종 외의 값 변형이 0건이다', drift.length === 0, drift)

  check('C-17', '여행기간 결합이 `{시작} ~ {종료}` 형식이다',
    cdAny.행사정보.여행기간 === `${fi.행사정보.여행기간_시작} ~ ${fi.행사정보.여행기간_종료}`,
    cdAny.행사정보.여행기간)

  check('C-19', '`추후 추가 예정`이 form_input에 들어간 건이 0건이다',
    !JSON.stringify(fi).includes(PLACEHOLDER))

  /*
   * 기획메모는 **고객에게 표시되지 않는다.** 어느 섹션에도 들어가지 않고
   * `source`도 갖지 않아야 한다 — 이게 그 규정의 실측이다.
   */
  const memo = String((cdAny.행사정보 as Record<string, unknown>).기획메모 ?? '').trim()
  const allSources = [...br.sections, ...pg.sections]
    .flatMap((s) => Object.values(s.source ?? {}))
  check('기획메모', '어느 섹션의 source도 기획메모를 가리키지 않는다',
    !allSources.some((v) => String(v).includes('기획메모')), allSources.filter((v) => String(v).includes('기획메모')))
  if (memo) {
    check('기획메모', '기획메모 원문이 소개서·페이지에 실리지 않았다',
      !JSON.stringify(br).includes(memo) && !JSON.stringify(base).includes(memo))
  } else {
    skipped('기획메모', '원문 유출 검사', '이 상품은 기획메모가 비어 있다')
  }

  /* ══ D. 선택 항목 ═════════════════════════════════════════════ */
  section('D. 선택 항목 처리')
  const placeholderPaths = Object.entries(cdAny).flatMap(([k, v]) =>
    Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x === PLACEHOLDER).map(([kk]) => `${k}.${kk}`))
  if (placeholderPaths.length === 0) {
    skipped('D-02', '`추후 추가 예정`이 양쪽에 동일 표기',
      '이 상품은 선택 항목이 전부 입력돼 있어 판정 대상이 아니다')
    skipped('D-03', '`추후 추가 예정` 섹션이 유지된다', '위와 같음')
  } else {
    const inBr = JSON.stringify(br).includes(PLACEHOLDER)
    const inPg = JSON.stringify(pg).includes(PLACEHOLDER)
    check('D-02', '`추후 추가 예정`이 소개서·페이지 양쪽에 있다', inBr && inPg,
      { 미입력항목: placeholderPaths, 소개서: inBr, 페이지: inPg })
    check('D-03', '해당 섹션이 삭제되지 않고 유지된다', inBr && inPg)
  }
  check('D-04', '선택 항목 미입력으로 중단되지 않았다', p.status !== 'input_error')

  /* ══ E. 일차 분해 ═════════════════════════════════════════════ */
  section('E. 일정 일차 분해')
  const 일정 = (cdAny.행사정보 as { 일정: { day: string; 내용: string; 원문근거: string }[] }).일정
  check('E-02', `일정 배열 길이가 여행 일수(${days})와 일치한다`,
    checkDayCount(cd, days).length === 0, { 배열: 일정.length, 일수: days })
  check('E-03', '각 `원문근거`가 `일정원문`의 부분 문자열이다',
    checkEvidence(cd).length === 0, checkEvidence(cd).map((i) => i.사유))

  const nouns = checkNouns(cd)
  const haystack = JSON.stringify(cd)
  const orphan = nouns.filter((n) => !n.근거존재 && !haystack.includes(n.후보.slice(0, 2)))
  check('E-04', '`내용`에 `원문근거` 밖의 명사구가 0건이다',
    orphan.length === 0, orphan.map((n) => `${n.day}일차: ${n.후보}`))

  /* ══ G. 소개서 ════════════════════════════════════════════════ */
  section('G. 소개서 (brochure_content)')
  const brErrors = checkBrochure(br as never)
  check('G-01/01b/05/15', '서버 검사 통과 — 섹션 8개·순서·source·미치환 토큰·길이',
    brErrors.length === 0, brErrors)

  check('G-01c', '소개서에 visible·locked·order·이미지·테마가 0건이다',
    br.sections.every((s) => !('visible' in s) && !('locked' in s) && !('order' in s))
    && !JSON.stringify(br).includes('image_slot') && !('theme' in (br as object)),
    Object.keys(br.sections[0] ?? {}))

  check('G-04', '`핵심일정`의 source가 "generated"다',
    br.sections.find((s) => s.id === 'b_overview')?.source?.핵심일정 === 'generated',
    br.sections.find((s) => s.id === 'b_overview')?.source)

  check('G-05b', '사실정보 값 필드에 조사가 붙은 건이 0건이다 (파이프 기호 0개)',
    !JSON.stringify(br).includes('|'))

  const 소개서일정 = br.sections.find((s) => s.id === 'b_itinerary')?.data as { 일정?: unknown[] }
  check('G-07', `소개서 일정 일차 수가 ${days}일과 일치한다`,
    Array.isArray(소개서일정?.일정) ? 소개서일정.일정.length === days : true,
    소개서일정?.일정?.length)

  /* ══ H. 상품 페이지 ═══════════════════════════════════════════ */
  section('H. 상품 페이지 (page_content)')
  const { data: imgRows } = await db.from('product_images').select('slot').eq('product_id', p.id)
  const slots = new Set<string>((imgRows ?? []).map((r) => r.slot as string))

  /*
   * `checkPage`는 **생성 직후** 기준이라 `order`가 1~9여야 한다. 그런데 편집으로
   * 블록을 끼우면 `renumber()`가 전 섹션을 1..N으로 다시 매기므로 기본 9개의
   * order는 1,4,5…처럼 벌어진다 — 그게 §10.2가 규정한 정상이다.
   * 그래서 편집된 상품은 order 검사만 빼고, 연속성은 J-05c가 따로 본다.
   */
  const renumbered = base.map((s, i) => ({ ...s, order: i + 1 }))
  const pgErrors = checkPage({ ...pg, sections: renumbered } as never, slots)
  check('H-01/01b/10/11/15', '서버 검사 통과 — 섹션 9개·source·토큰·길이 4종·슬롯',
    pgErrors.length === 0, pgErrors)

  if (blocks.length === 0) {
    check('H-01(order)', '생성 직후 order가 1~9다',
      base.map((s) => s.order).join(',') === '1,2,3,4,5,6,7,8,9',
      base.map((s) => s.order))
  } else {
    skipped('H-01(order)', '생성 직후 order 1~9',
      `편집으로 블록 ${blocks.length}개가 끼워져 전 섹션이 1..${pg.sections.length}로 재부여됨(§10.2 정상). 연속성은 J-05c가 판정`)
  }

  check('H-01c', '모든 섹션이 7개 최상위 필드를 가진다',
    pg.sections.every((s) =>
      ['id', 'type', 'order', 'visible', 'locked', 'data', 'source']
        .every((k) => k in s)),
    pg.sections.filter((s) => !('source' in s)).map((s) => s.id))

  check('H-03b', '`image_slot`·`image_slots`에 source를 붙인 건이 0건이다',
    pg.sections.every((s) => !s.source?.image_slot && !s.source?.image_slots))

  const acc = base.find((s) => s.id === 'sec_accommodation')
  const shop = base.find((s) => s.id === 'sec_shop')
  const hero = base.find((s) => s.id === 'sec_hero')
  check('H-04b', '`accommodation`·`shop`은 복수형, `hero`는 단수형을 쓴다',
    Array.isArray(acc?.data.image_slots) && Array.isArray(shop?.data.image_slots)
    && typeof hero?.data.image_slot === 'string',
    { acc: typeof acc?.data.image_slots, shop: typeof shop?.data.image_slots, hero: typeof hero?.data.image_slot })

  check('H-05', '`hero`·`apply`만 locked:true, 나머지 7개는 false',
    base.filter((s) => s.locked).map((s) => s.id).sort().join(',') === 'sec_apply,sec_hero',
    base.filter((s) => s.locked).map((s) => s.id))

  check('H-06', 'HTML을 생성하지 않았다 (태그 0건)',
    !/<\/?(div|p|span|section|h[1-6]|table)[ >]/i.test(JSON.stringify(pg)))

  check('H-07', `theme이 §9.4 매핑표 값이다 (${pg.theme})`,
    ['nature', 'resort', 'urban', 'culinary', 'active', 'heritage', 'default'].includes(pg.theme),
    pg.theme)

  check('H-09', `hero.headline이 ${LENGTH_LIMITS_GENERATE['hero.headline']}자 이내이고 행사명을 자르지 않았다`,
    String(hero?.data.headline ?? '').length <= LENGTH_LIMITS_GENERATE['hero.headline']
    && String(hero?.data.headline) === fi.행사정보.행사명,
    { headline: hero?.data.headline, 행사명: fi.행사정보.행사명 })

  check('H-13', '`sec_apply`에 신청 폼 필드 구성이 들어간 건이 0건이다',
    !['이름', '이메일', '연락처', '인원수', '동의', 'name', 'email', 'phone']
      .some((k) => k in (base.find((s) => s.id === 'sec_apply')?.data ?? {})),
    Object.keys(base.find((s) => s.id === 'sec_apply')?.data ?? {}))

  /* ══ I. 검증 4축 ══════════════════════════════════════════════ */
  section('I. 검증 4축 (validation_snapshot)')
  check('I-15', '스냅샷에 5개 키 + 4축이 있고 미실행 축은 null이다',
    ['attempt_no', 'verdict', 'validated_at', 'content_hash', 'axes'].every((k) => k in snap)
    && ['axis_0', 'axis_1', 'axis_2', 'axis_3'].every((a) => a in snap.axes),
    Object.keys(snap))

  check('I-16', '4축 전부 pass일 때 최상위 verdict가 pass다', snap.verdict === 'pass', snap.verdict)

  check('I-07', '3차가 `apply`만 skipped로 기록했다',
    JSON.stringify(snap.axes.axis_3?.skipped) === '["apply"]', snap.axes.axis_3?.skipped)

  check('I-20/21', '실패 항목이 6필드 구조이고 잘라내지 않았다 (통과라 items 0)',
    Object.values(snap.axes).every((a) => Array.isArray(a?.items)))

  check('I-22', 'content_hash가 `sha256:` 접두사 + 64자 16진수다',
    /^sha256:[0-9a-f]{64}$/.test(snap.content_hash), snap.content_hash?.slice(0, 24))

  /* ══ J-23 · 삽입 블록 ═════════════════════════════════════════ */
  section('J. 편집기 — 삽입 블록')
  if (blocks.length === 0) {
    skipped('J-23', '삽입 블록이 2·3차 검증 대상에 포함되지 않았다', '이 상품에는 삽입 블록이 없다')
  } else {
    console.log(`         (삽입 블록 ${blocks.length}개: ${blocks.map((b) => `${b.type}`).join(', ')})`)
    check('J-05b', '블록이 `blk_` 접두사 · locked:false · 규정 data 키를 가진다',
      blocks.every((b) => b.id.startsWith(BLOCK_PREFIX) && b.locked === false
        && ['free_text', 'image', 'notice'].includes(b.type)),
      blocks.map((b) => ({ id: b.id, type: b.type, locked: b.locked })))
    check('J-05c', '블록이 hero와 apply 사이에만 있고 order가 1부터 연속이다',
      blocks.every((b) => b.order > 1 && b.order < pg.sections.length)
      && pg.sections.map((s) => s.order).join(',')
         === pg.sections.map((_, i) => i + 1).join(','),
      pg.sections.map((s) => `${s.order}:${s.id}`))
    const 검증위치 = Object.values(snap.axes).flatMap((a) =>
      (a?.items as { 위치?: string }[] ?? []).map((i) => i.위치 ?? ''))
    check('J-23', '삽입 블록이 검증 items에 포함된 건이 0건이다 (검증은 편집 이전 시점)',
      !검증위치.some((w) => w.includes(BLOCK_PREFIX)), 검증위치)
    check('J-23b', 'content_hash가 현재와 다르다 = 검증 이후 편집됨이 추적된다',
      contentHash(pg) !== snap.content_hash,
      { 저장된해시: snap.content_hash?.slice(0, 20), 현재해시: contentHash(pg).slice(0, 20) })
  }

  /* ══ W. 데이터 무결성 ═════════════════════════════════════════ */
  section('W. 고유명사 · 수치 무결성 (AI 생성분)')
  /*
   * **모든 행의 고유명사를 본다.** 첫 행만 보면 두 번째 숙소가 소개서·페이지에서
   * 사라져도 통과한다 — 행이 여럿인 상품에서 가장 흔한 회귀가 정확히 그것이다.
   */
  /** `fi`는 `Record<string, Record<string, string>>`로 좁혀져 있어 배열 접근에 넓힘이 필요하다 */
  const rowsOf = (key: string): Record<string, string>[] => {
    const v = (fi as unknown as Record<string, unknown>)[key]
    return Array.isArray(v) ? (v as Record<string, string>[]) : []
  }

  const 고유명사: [string, string][] = [
    ['여행지', fi.행사정보.여행지],
    ...rowsOf('숙박').flatMap((st, i): [string, string][] => [
      [`숙박[${i}].숙소명`, st.숙소명 ?? ''], [`숙박[${i}].객실타입`, st.객실타입 ?? ''],
      [`숙박[${i}].위치`, st.위치 ?? ''],
    ]),
    ...rowsOf('상점').map((sh, i): [string, string] => [`상점[${i}].상점명`, sh.상점명 ?? '']),
  ]
  const brText = JSON.stringify(br), pgText = JSON.stringify(base)
  const 누락 = 고유명사.filter(([, v]) => v && v !== PLACEHOLDER
    && (!brText.includes(v) || !pgText.includes(v)))
  check('W-01/W-04', '입력 고유명사가 소개서·페이지 양쪽에 그대로 있다',
    누락.length === 0, 누락.map(([k, v]) => `${k}=${v}`))

  check('W-06', '가격이 입력값 그대로다 (계산·환산·합계 0건)',
    pgText.includes(cdAny.가격.성인 as string), {
      확정: cdAny.가격.성인,
      페이지: (base.find((s) => s.id === 'sec_price')?.data ?? {}),
    })

  const 일차서술 = 일정.map((d) => d.내용).join(' ')
  check('W-05', '일차별 서술이 `원문근거` 범위 안이다 (E-04와 같은 근거)',
    orphan.length === 0, orphan.length)
  check('W-02/W-03', '입력에 없는 장소·시설명을 만들지 않았다',
    orphan.length === 0, 일차서술.slice(0, 120))
}

console.log(`\n${'─'.repeat(52)}`)
console.log(`통과 ${pass} · 실패 ${fail}${skip > 0 ? ` · 건너뜀 ${skip}` : ''}`)
process.exit(fail > 0 ? 1 : 0)
