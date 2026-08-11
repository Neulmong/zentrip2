/**
 * Gemini 스키마 → JSON Schema 변환 + **로컬 검증** — 순수 모듈.
 *
 * ## 왜 로컬 검증이 필요한가
 *
 * §4.3은 「출력을 `responseSchema`로 강제한다」고 규정한다. Gemini는 이것을
 * 제공자 쪽에서 지켜 주지만, **DeepSeek은 `json_object`(문법만 JSON 보장)까지만
 * 지원하고 `json_schema` strict 모드가 없다.** 스키마를 프롬프트로 알려주는
 * 것만으로는 「구조가 맞는 출력」이 보증되지 않는다.
 *
 * 그래서 예비 경로는 **강제 지점을 제공자에서 우리 쪽으로 옮긴다.**
 * 받은 JSON을 여기서 스키마에 대조하고, 어긋나면 `schema_invalid`로 실패
 * 처리한다 — 그 뒤는 기존 재시도 기계가 그대로 처리한다(§11.6).
 *
 * 계약의 **결과**는 같다: 라우트는 「스키마를 만족하는 데이터」 아니면
 * 「타입이 붙은 실패」만 받는다. 어긋난 값이 파이프라인에 들어가는 경로는 없다.
 *
 * ## 지원 범위
 *
 * `lib/pipeline/ai-contracts.ts`가 실제로 쓰는 것만 다룬다 —
 * `OBJECT` · `ARRAY` · `STRING` + `properties` · `required` · `items`.
 * 모르는 키워드는 **무시한다**(거부하지 않는다) — 스키마가 늘어날 때
 * 검증기가 조용히 통과시키는 쪽이, 멀쩡한 출력을 거부하는 쪽보다 안전하다.
 * 새 타입을 쓰기 시작하면 `TYPE_CHECKS`에 한 줄 추가하면 된다.
 */

/**
 * Gemini는 `type`을 대문자(`OBJECT`)로, JSON Schema는 소문자(`object`)로 쓴다.
 * 그 외 구조는 동일하므로 `type` 값만 내려 쓴다.
 */
export function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema)
  if (!node || typeof node !== 'object') return node

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v)
  }
  return out
}

const TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
}

/**
 * 값이 스키마를 만족하는지 검사하고 **어긋난 지점의 경로**를 돌려준다.
 * 빈 배열이면 통과다. 경로를 남기는 이유는 실패 로그에서 어느 필드가
 * 문제였는지 보여야 재시도가 의미를 갖기 때문이다(§5.4).
 */
export function validateAgainstSchema(
  value: unknown,
  schema: unknown,
  path = '$',
): string[] {
  if (!schema || typeof schema !== 'object') return []
  const s = schema as Record<string, unknown>
  const errors: string[] = []

  const type = typeof s.type === 'string' ? s.type.toLowerCase() : null
  if (type) {
    const ok = TYPE_CHECKS[type]
    // 모르는 타입은 검사하지 않는다 — 통과시킨다.
    if (ok && !ok(value)) {
      errors.push(`${path}: ${type}이어야 하는데 ${describe(value)}입니다`)
      // 타입이 틀렸으면 하위 검사는 의미가 없다.
      return errors
    }
  }

  if (Array.isArray(s.enum) && s.enum.length > 0 && !s.enum.includes(value as never)) {
    errors.push(`${path}: 허용값 ${JSON.stringify(s.enum)} 밖의 «${String(value)}»입니다`)
  }

  if (type === 'object' || (!type && isPlainObject(value) && s.properties)) {
    const obj = value as Record<string, unknown>

    if (Array.isArray(s.required)) {
      for (const key of s.required) {
        if (typeof key !== 'string') continue
        if (!(key in obj) || obj[key] === undefined) {
          errors.push(`${path}.${key}: 필수 필드가 없습니다`)
        }
      }
    }

    const props = isPlainObject(s.properties) ? s.properties : null
    if (props) {
      for (const [key, sub] of Object.entries(props)) {
        if (!(key in obj) || obj[key] === undefined) continue
        errors.push(...validateAgainstSchema(obj[key], sub, `${path}.${key}`))
      }
    }
  }

  if (type === 'array' && Array.isArray(value) && s.items) {
    for (const [i, item] of value.entries()) {
      errors.push(...validateAgainstSchema(item, s.items, `${path}[${i}]`))
    }
  }

  return errors
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}
