import type { AiErrorType } from '@/lib/ai'
import type { ConfirmedData, NormalizeChange } from '@/lib/pipeline/normalize'
import type { BrochureContent } from '@/lib/pipeline/brochure'
import type { PageContent } from '@/lib/pipeline/page'
import type { ResolvedTheme } from '@/lib/pipeline/theme'
import type { ComposeBlock, ComposeResult } from '@/lib/pipeline/ai-contracts'
import type { GateInfo } from '@/lib/pipeline/vocabulary'
import type { NounCandidate } from '@/lib/pipeline/axis0'
import type { FormInput, ProductRow, ValidationItem } from '@/lib/types'

/**
 * 스킬 체인이 공유하는 **자료 버스**.
 *
 * 스킬은 서로를 모른다 — 앞 스킬이 여기 쓰고, 뒤 스킬이 여기서 읽는다.
 * 이 간접이 없으면 스킬이 서로를 직접 호출하게 되고 그 순간 「에이전트가
 * 스킬을 부른다」가 「스킬이 스킬을 부른다」로 바뀐다(규약 R2 붕괴).
 *
 * 필드가 대부분 optional인 이유: 라우트마다 체인이 다르므로 채워지는 칸도 다르다.
 * `decompose`는 `cd`까지, `brochure`는 `brochure`까지, `page`는 `page`까지 만든다.
 */
export interface Materials {
  /** 업로드된 이미지 슬롯 (§16.1 — 없는 슬롯을 만들지 않는다) */
  imageSlots: { slot: string; alt: string | null }[]
  /** 이미 쓰인 slug. `p.slug`가 있으면 적재하지 않는다 (§12.1 재발급 금지) */
  usedSlugs: Set<string>
}

/** AI 실패 1건. 어느 스킬에서 났는지 함께 남긴다 (§4.3 — output에 기록) */
export interface AiFailure {
  skill: string
  errorType: AiErrorType
  retryAfterMs?: number
}

/**
 * 체인 중단 사유. `runChain`이 이 값을 보면 남은 스킬을 실행하지 않는다.
 *
 * 계약 검사 실패는 여기 없다 — 검사 항목을 **모아서** 보여줘야 하므로
 * 첫 실패에서 멈추지 않고 `errors`에 누적한다(§8.7·§9.3).
 */
export type StopReason = 'ai_fail' | 'input_error'

export interface HarnessContext {
  readonly route: string
  readonly p: ProductRow
  /** 검증 기준값. `confirmed_data`가 아니다 (§11.1) */
  readonly fi: FormInput
  readonly days: number
  readonly materials: Materials

  /* ── 스킬 산출물 ─────────────────────────────────────────── */
  filled?: FormInput
  cd?: ConfirmedData
  changes: NormalizeChange[]
  채운경로: string[]
  분해판정?: 'pass' | 'day_overflow' | 'no_day_marker'
  /** 원문 일차가 부족해 `추후 추가 예정`으로 채운 일차 (§5.5 itinerary_partial) */
  partialDays: string[]
  핵심일정?: string
  brochure?: BrochureContent
  /** block-vocabulary-gate 산출 — AI에게 넘길 어휘·재료 요약 (명령서 ⑥) */
  gate?: GateInfo
  /** content-structuring 산출 — AI의 디자인 의도(색이 아니라 hue+mood) */
  themeSpec?: ComposeResult['theme']
  /** content-structuring 산출 — AI의 블록 계획 (구성·순서·스타일·서술) */
  plan?: ComposeBlock[]
  /** theme-design-token-match 산출 — 계산·검증이 끝난 테마 (§9.4) */
  theme?: ResolvedTheme
  expanded?: Map<string, string>
  apply?: { 제목: string; 안내문구: string }
  page?: PageContent
  slug?: string | null
  /** slug 충돌이 해소되지 않은 경우의 후보값 */
  slug충돌?: string

  /* ── 판정 누적 ───────────────────────────────────────────── */
  /** 확정 위반. 1건 이상이면 그 단계는 실패다 */
  items: ValidationItem[]
  /** 계약 검사·유출 검사의 사람이 읽는 사유. 모아서 한 항목으로 보고한다 */
  errors: string[]
  /** §6.3 2단계의 「표시」. 실패로 세지 않는다 */
  위반후보: NounCandidate[]
  /** AI 검증 스킬의 판정 */
  verdict?: 'pass' | 'fail'

  /* ── AI ──────────────────────────────────────────────────── */
  /** 누적 호출 수. `ai_budget`과 대조된다 (규약 R3) */
  aiCalls: number
  aiLog: Record<string, unknown>
  aiFail?: AiFailure

  stop?: StopReason
  /** `execution_logs.output`에 덧붙일 값 */
  extra: Record<string, unknown>
}

export function newContext(
  route: string, p: ProductRow, days: number, materials: Materials,
): HarnessContext {
  return {
    route, p, fi: p.form_input, days, materials,
    changes: [], 채운경로: [], partialDays: [],
    items: [], errors: [], 위반후보: [],
    aiCalls: 0, aiLog: {}, extra: {},
  }
}
