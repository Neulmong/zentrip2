/**
 * 클라이언트 순차 호출 (§8.5·§9.6·§14.6) — **상위 오케스트레이션**.
 *
 * 단계 순서·진행 표시·`reason` 분기·재개 판단은 클라이언트가 담당한다.
 * 서버는 요청 1건만 처리하고, 재시도는 **클라이언트가 같은 API를 재호출**한다.
 * 폴링은 사용하지 않는다(§4.2).
 */

export interface Phase {
  /** §14.4 표의 라우트 번호 — `retry_from`이 이 값을 가리킨다 */
  num: number
  path: string
  label: string
}

/** §8.5 — [소개서 생성] 4요청 중 ②③④ (①은 폼 제출이 담당) */
export const BROCHURE_PHASES: Phase[] = [
  { num: 2, path: 'decompose', label: '일정 정리 중…' },
  { num: 3, path: 'brochure', label: '소개서 작성 중…' },
  { num: 4, path: 'validate-brochure', label: '검사 중…' },
]

/** §9.6 — [상품 생성] 3요청 */
export const PAGE_PHASES: Phase[] = [
  { num: 5, path: 'page', label: '페이지 구성 중…' },
  { num: 6, path: 'validate-page', label: '사실 확인 중…' },
  { num: 7, path: 'validate-consistency', label: '소개서와 대조 중…' },
]

/**
 * §15.1.1 — `current_step` → 다음 호출 대상.
 * **이 표가 클라이언트 재개 규칙의 단일 출처다.**
 *
 * `validation_3_completed`·`draft_registered`는 없다 — 그 단계가 끝나면 `draft`로
 * 전이하므로 `generating`에서 나타날 수 없고, 따라서 재개 대상도 아니다.
 */
const RESUME_AT: Record<string, number> = {
  pipeline_started: 2,
  normalization_validated: 3,
  brochure_generated: 4,
  validation_1_completed: 5,
  page_generated: 6,
  validation_2_completed: 7,
}

/**
 * 라우트 번호부터 **그 묶음의 끝까지**를 돌려준다.
 *
 * 소개서(②③④)와 페이지(⑤⑥⑦)는 서로 다른 사용자 조작이므로 이어 붙이지 않는다 —
 * ④가 끝나면 기획자가 소개서를 검토하고 [상품 생성]을 눌러야 ⑤가 시작된다(§8.5·§9.6).
 * 한 번에 ⑦까지 달리면 검토 단계가 사라진다.
 */
export function phasesFrom(num: number): Phase[] {
  for (const group of [BROCHURE_PHASES, PAGE_PHASES]) {
    const i = group.findIndex((p) => p.num === num)
    if (i >= 0) return group.slice(i)
  }
  return []
}

/** [이어서 진행](§15.1.1) — 멈춘 지점부터 남은 단계. */
export function resumePhases(currentStep: string): Phase[] {
  const num = RESUME_AT[currentStep]
  return num === undefined ? [] : phasesFrom(num)
}

export type PipelineOutcome =
  | { kind: 'done'; body: Record<string, unknown> }
  /** 입력 문제로 중단 — 폼으로 돌아가 사유를 표시한다(§14.6 422) */
  | { kind: 'input_error'; failure_reason: string }
  /** 시작 조건 미충족·동시 편집 — 재호출하지 않고 재조회한다 */
  | { kind: 'refetch'; reason: 'precondition' | 'stale'; detail?: string }
  | { kind: 'error'; message: string }

/**
 * 재시도 상한. 서버가 카운터를 소진하면 200으로 확정하므로 원래는 끝나지만,
 * 어떤 이유로든 루프가 닫히지 않는 경우를 막는 안전장치다.
 */
const MAX_STEPS = 24

export async function runPipeline(
  productId: string,
  phases: Phase[],
  onProgress: (label: string, attempt: number) => void,
): Promise<PipelineOutcome> {
  let i = 0
  let guard = 0
  let attempt = 0

  while (i < phases.length) {
    if (++guard > MAX_STEPS) {
      return { kind: 'error', message: '단계가 예상보다 많이 반복됐습니다. 화면을 새로고침해 주세요.' }
    }

    const phase = phases[i]
    onProgress(phase.label, attempt)

    let res: Response
    try {
      res = await fetch(`/api/products/${productId}/${phase.path}`, { method: 'POST' })
    } catch {
      return { kind: 'error', message: '네트워크 오류가 발생했습니다. 다시 시도해 주세요.' }
    }
    const body = await res.json().catch(() => ({}))

    // 200 — 단계 완료. 검증 fail 확정도 여기에 포함된다(§14.6).
    if (res.ok) {
      i += 1
      attempt = 0
      continue
    }

    if (res.status === 422) {
      return { kind: 'input_error', failure_reason: body.failure_reason ?? '입력을 확인해 주세요.' }
    }

    if (res.status === 409) {
      // reason이 없으면 전부 "재호출하라"로 해석해 무한 반복에 빠진다(§14.6).
      switch (body.reason) {
        case 'retry': {
          // retry_from이 지정한 라우트부터 재호출한다. §11.6의 복귀 대상과 항상 일치한다.
          const back = phases.findIndex((p) => p.num === body.retry_from)
          i = back >= 0 ? back : i
          attempt += 1

          /*
           * 429(무료 티어 분당 한도)처럼 즉시 재호출이 무의미한 경우 서버가
           * `retry_after_ms`를 준다. 이걸 무시하고 바로 재호출하면 재시도
           * 예산 2회를 몇 초 만에 태우고 전부 실패한다.
           *
           * 폴링이 아니다 — 재호출 전 한 번 쉬는 백오프다(§4.2는 상태를
           * 되묻는 폴링을 금지하지, 실패 후 대기를 금지하지 않는다).
           */
          const waitMs = Number(body.retry_after_ms ?? 0)
          if (waitMs > 0) {
            onProgress(`${phase.label} 잠시 후 다시 시도합니다`, attempt)
            await new Promise((r) => setTimeout(r, Math.min(waitMs, 30_000)))
          }
          continue
        }
        case 'precondition':
        case 'stale':
          // **재호출하지 않는다.** 현재 상태를 다시 읽고 화면을 갱신한다.
          return { kind: 'refetch', reason: body.reason, detail: body.detail }
        default:
          return { kind: 'error', message: body.detail ?? '요청을 처리할 수 없습니다.' }
      }
    }

    if (res.status === 401) {
      return { kind: 'error', message: '로그인이 만료됐습니다. 다시 로그인해 주세요.' }
    }
    return { kind: 'error', message: body.message ?? `요청이 실패했습니다 (${res.status}).` }
  }

  return { kind: 'done', body: {} }
}
