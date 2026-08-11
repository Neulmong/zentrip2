import type { ButtonKey } from '@/lib/status-view'

/**
 * **임시 비계(scaffolding).** 아직 만들지 않은 버튼 목록.
 *
 * `describeStatus()`는 §15.1 표대로 **상태별 버튼 전부**를 돌려준다 — 그게 맞다.
 * 규칙표가 구현 진척에 맞춰 줄어들면 표가 spec의 사본이 아니게 되고, 나중에
 * 무엇이 빠졌는지 알 수 없다.
 *
 * 대신 **그리는 쪽**에서 거른다. 여기 없는 버튼은 누를 곳(라우트·API)이 있다는 뜻이다.
 * 목록·상세가 같은 목록을 보므로 한쪽만 고쳐 어긋나는 일이 없다.
 *
 * | 버튼 | 언제 지우나 |
 * |---|---|
 * | ~~`edit`~~ | ~~4단계~~ — 완료(`/admin/products/{id}/edit`) |
 * | `publish` · `unpublish` | 5단계 — API #12·#13 |
 *
 * **이 파일은 6단계가 끝나면 통째로 지운다.**
 */
const UNAVAILABLE: readonly ButtonKey[] = ['publish', 'unpublish']

export function isAvailable(key: ButtonKey): boolean {
  return !UNAVAILABLE.includes(key)
}
