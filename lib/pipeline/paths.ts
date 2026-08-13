/**
 * `source` 경로 해석 (§7.4) — **순수 모듈.**
 *
 * `source` 맵의 값은 `form_input`·`confirmed_data` 양쪽에 그대로 적용되는
 * 경로 문자열이다(§8.8). 2.7에서 `숙박`·`상점`이 객체 배열로 올라가면서
 * 경로 표기에 **인덱스**가 들어왔다.
 *
 * ```text
 * 가격.성인            스칼라 필드
 * 숙박[0].숙소명       배열 원소의 필드
 * 숙박                 배열 자체 (섹션의 `source`가 가리키는 형태)
 * ```
 *
 * 이 세 형태를 읽는 곳이 여러 군데다 — 소개서 보호값 검증, 3차 교차 대조,
 * 로그 뷰. 각자 문자열을 쪼개면 표기가 갈리는 순간 조용히 다른 값을 본다.
 * **경로를 해석하는 코드는 여기 하나뿐이어야 한다.**
 */
import type { ConfirmedData } from './normalize'
import { BLOCK_TYPES, VOCABULARY } from './vocabulary'

/** `숙박[0]` → `{ key: '숙박', index: 0 }`, `가격` → `{ key: '가격' }` */
function segment(s: string): { key: string; index?: number } {
  const m = /^(.+)\[(\d+)\]$/.exec(s)
  return m ? { key: m[1], index: Number(m[2]) } : { key: s }
}

/**
 * 경로 1개를 값으로 해석한다. 없으면 `undefined`.
 *
 * 없는 것과 빈 문자열을 구분한다 — 호출부가 「source가 가리키는 곳에 값이
 * 없다」(계약 위반)와 「값이 빈 문자열이다」(채움 대상)를 다르게 처리한다.
 */
export function resolvePath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const raw of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    const { key, index } = segment(raw)
    cur = (cur as Record<string, unknown>)[key]
    if (index !== undefined) {
      if (!Array.isArray(cur)) return undefined
      cur = cur[index]
    }
  }
  return cur
}

/**
 * 객체 배열을 **원소 단위 경로 → 값** 목록으로 펼친다.
 *
 * ```text
 * expandRows('숙박', [{숙소명: 'A', 위치: 'B'}])
 *   → [['숙박[0].숙소명', 'A'], ['숙박[0].위치', 'B']]
 * ```
 *
 * 3차 교차 대조가 이 경로를 조인 키로 쓴다(§11.1). 인덱스가 붙으므로 원소를
 * 맞대는 데 추가 규약이 필요 없다 — **행 수가 다르면 한쪽에만 있는 경로가
 * 생겨 그 자체로 항목이 된다.**
 */
export function expandRows(
  prefix: string, rows: readonly unknown[],
): [string, string][] {
  const out: [string, string][] = []
  for (const [i, row] of rows.entries()) {
    if (row === null || typeof row !== 'object') continue
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (typeof v !== 'string' && typeof v !== 'number') continue
      out.push([`${prefix}[${i}].${k}`, String(v)])
    }
  }
  return out
}

/**
 * 콘텐츠 모델에서 **원소 단위 대조 대상**인 배열 필드.
 *
 * `days`가 여기 없는 것이 핵심이다 — 일차별 `text`는 소개서가 압축·페이지가
 * 확장이라 문자열이 당연히 다르고, 그 대조는 명사구 생존 검사로 따로 한다
 * (`consistency.ts`). 반면 `숙소들`·`상점들`은 **값 배열**이므로 문자열이
 * 같아야 한다.
 */
export const ROW_FIELDS: Readonly<Record<string, string>> = {
  숙소들: '숙박',
  상점들: '상점',
}

/**
 * 커버리지의 기준 목록 (spec 2.8 §9.2 · 명령서 ⑤) — **순수 함수**.
 *
 * 구성이 자유로워지면 「9섹션·순서」로는 사실정보 누락을 잡을 수 없다. 대신
 * **확정 데이터의 모든 사실정보 경로가 페이지의 `source` 집합에 있어야 한다**로
 * 옮긴다 — 어느 블록에 있든 상관없다.
 *
 * 반환값은 페이지가 **반드시 덮어야 하는 최상위 `source` 경로**의 집합이다.
 * 어휘(`VOCABULARY`)의 `fact` 블록이 정의한 재료 경로를 모아, 재료가 없는 것
 * (`available: false`)과 값이 `해당 없음`인 스칼라 경로를 뺀다. `추후 추가 예정`은
 * **포함**한다 — §6.1의 목적이 「빈칸을 기획자가 알아차리게」이므로 페이지에 남아야 한다.
 */
export function requiredPaths(cd: ConfirmedData): Set<string> {
  const out = new Set<string>()
  for (const t of BLOCK_TYPES) {
    const def = VOCABULARY[t]
    if (def.role !== 'fact' || !def.materialPaths) continue
    if (def.available && !def.available(cd)) continue
    for (const p of def.materialPaths(cd)) {
      const v = resolvePath(cd, p)
      // 값이 `해당 없음`인 스칼라 경로는 커버리지 대상에서 제외(§8.5)
      if (typeof v === 'string' && v.trim() === '해당 없음') continue
      out.add(p)
    }
  }
  return out
}
