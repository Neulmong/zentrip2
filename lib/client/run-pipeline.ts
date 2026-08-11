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

/**
 * 200 본문의 `axes`에서 `fail`로 굳은 축을 찾는다(§14.6).
 *
 * **200은 「단계 완료」이고 `fail` 확정도 포함한다.** 상태 코드만 보고 다음
 * 단계로 넘어가면, 재시도가 소진돼 축이 `fail`로 굳은 뒤에도 계속 호출해
 * §14.5의 시작 조건(`axis_1 = pass` 등)에서 409 `precondition`을 맞는다.
 */
function failedAxisOf(body: unknown): string | null {
  const axes = (body as { axes?: Record<string, string> })?.axes
  if (!axes || typeof axes !== 'object') return null
  for (const [name, verdict] of Object.entries(axes)) {
    if (verdict === 'fail') return name
  }
  return null
}

export type PipelineOutcome =
  | { kind: 'done'; body: Record<string, unknown> }
  /**
   * 축이 `fail`로 확정됐다 — 남은 단계를 호출하지 않고 멈춘다.
   * 화면은 §15.1 표대로 실패 항목과 다음 조작 버튼을 보여준다.
   */
  | { kind: 'axis_failed'; axis: string; body: Record<string, unknown> }
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

/**
 * 백오프 상한 (§4.2의 「재호출 전 대기」).
 *
 * 30초로 자르던 값을 60초로 올렸다. 실측에서 서버가 지시한 값은 11·20·49·52·57·59초였고,
 * **30초에서 끊고 재호출하면 한도가 아직 안 풀려 또 429를 맞는다** — 재시도 예산
 * 2회(§11.6)를 몇 초 만에 태우고 축이 `fail`로 굳는다. 기다림을 아끼려다
 * 파이프라인을 잃는 거래였다.
 *
 * 60초인 이유는 라우트의 `maxDuration`과 같은 크기이고, 관측된 지시값을 전부
 * 덮기 때문이다. 이보다 긴 지시가 오면 어차피 대기로 풀 문제가 아니다
 * (일일 쿼터 소진이 그렇다 — §4.3).
 */
export const MAX_BACKOFF_MS = 60_000

/**
 * 남은 시간을 1초마다 화면에 갱신하며 기다린다.
 *
 * 통째로 `setTimeout` 한 번을 걸면 최대 1분간 화면이 얼어붙은 것과 구분되지
 * 않는다 — 사용자가 새로고침하면 그 시점의 진행이 사라진다. 남은 초를 보여
 * 주는 것이 「멈춘 게 아니라 기다리는 중」임을 알리는 가장 싼 방법이다.
 */
export async function backoff(
  totalMs: number, label: string, attempt: number,
  onProgress: (label: string, attempt: number) => void,
) {
  const until = Date.now() + totalMs
  for (;;) {
    const leftMs = until - Date.now()
    if (leftMs <= 0) return
    onProgress(`${label} — 호출 한도로 ${Math.ceil(leftMs / 1000)}초 후 다시 시도합니다`, attempt)
    await new Promise((r) => setTimeout(r, Math.min(1000, leftMs)))
  }
}

/**
 * 순차 호출을 돌린다.
 *
 * ## `updated_at`을 이어서 나른다 (§16.1.1)
 *
 * 쓰기 라우트는 「클라이언트가 읽은 시점」을 함께 받아 대조한다. 단계마다
 * 행이 갱신되므로 **응답이 주는 새 값으로 매번 바꿔 들어야** 한다 —
 * 처음 값을 끝까지 쓰면 두 번째 단계부터 전부 409 `stale`이다.
 *
 * 409 `retry` 응답도 새 값을 준다. 재시도 카운터를 올리며 행이 바뀌기
 * 때문이다. 이걸 놓치면 **재시도가 시작도 못 하고** stale로 끝난다.
 *
 * `initialUpdatedAt`을 주지 않으면 `GET`으로 한 번 읽는다. 조회는 잠금
 * 대상이 아니므로(§16.1.1) 이 호출 자체는 경합을 만들지 않는다.
 */
export async function runPipeline(
  productId: string,
  phases: Phase[],
  onProgress: (label: string, attempt: number) => void,
  initialUpdatedAt?: string,
): Promise<PipelineOutcome> {
  let i = 0
  let guard = 0
  let attempt = 0

  let updatedAt = initialUpdatedAt
  if (!updatedAt) {
    try {
      const r = await fetch(`/api/products/${productId}`)
      if (r.ok) {
        const seen = await r.json().catch(() => ({}))
        if (typeof seen?.updated_at === 'string') updatedAt = seen.updated_at
      }
    } catch {
      // 읽지 못해도 진행한다 — 서버는 값이 없으면 잠금 검사를 건너뛴다.
    }
  }

  while (i < phases.length) {
    if (++guard > MAX_STEPS) {
      return { kind: 'error', message: '단계가 예상보다 많이 반복됐습니다. 화면을 새로고침해 주세요.' }
    }

    const phase = phases[i]
    onProgress(phase.label, attempt)

    let res: Response
    try {
      res = await fetch(`/api/products/${productId}/${phase.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updatedAt ? { updated_at: updatedAt } : {}),
      })
    } catch {
      return { kind: 'error', message: '네트워크 오류가 발생했습니다. 다시 시도해 주세요.' }
    }
    const body = await res.json().catch(() => ({}))

    // 행이 갱신됐으면 새 조회 시점으로 바꿔 든다 — 200이든 409 retry든(§16.1.1).
    if (typeof body?.updated_at === 'string') updatedAt = body.updated_at

    // 200 — 단계 완료. 검증 fail 확정도 여기에 포함된다(§14.6).
    if (res.ok) {
      // 축이 fail로 굳었으면 **남은 단계를 호출하지 않는다.** 호출해 봐야
      // §14.5의 시작 조건에서 409 precondition을 받을 뿐이다.
      const failed = failedAxisOf(body)
      if (failed) return { kind: 'axis_failed', axis: failed, body }

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
           * 429(호출 한도)처럼 즉시 재호출이 무의미한 경우 서버가
           * `retry_after_ms`를 준다. 이걸 무시하거나 **짧게 잘라** 재호출하면
           * 재시도 예산 2회를 몇 초 만에 태우고 전부 실패한다.
           *
           * 폴링이 아니다 — 재호출 전 한 번 쉬는 백오프다(§4.2는 상태를
           * 되묻는 폴링을 금지하지, 실패 후 대기를 금지하지 않는다).
           */
          const waitMs = Math.min(Number(body.retry_after_ms ?? 0), MAX_BACKOFF_MS)
          if (waitMs > 0) await backoff(waitMs, phase.label, attempt, onProgress)
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
