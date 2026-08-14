/**
 * 상태 × 화면 × 버튼 (§15.1) — **순수 모듈**.
 *
 * §15.1은 「이 표가 상태 관련 규정의 단일 출처다」라고 못박고 있다.
 * 그 표를 **코드로 한 번만** 적어두는 곳이 여기다.
 *
 * 화면 3개(목록 §14.1 · 상세 §8.9 · 편집기 §10.1)가 같은 판정을 필요로 하는데,
 * 각자 조건문을 쓰면 규정이 바뀔 때 세 곳이 어긋난다 — spec이 이 표를 둔 이유가
 * 「도달할 수 없는 상태를 전제한 기능」을 막는 것이므로, 구현도 같은 방식으로 막는다.
 *
 * ## 이 파일에 두면 안 되는 것
 *
 * `server-only` 모듈과 `node:*` import. 편집기(클라이언트 컴포넌트)가 이 판정을
 * 그대로 쓰기 때문이다. 그래서 `lib/validation.ts`(`node:crypto` 사용)를
 * import하지 않고 `validation_snapshot.verdict`를 직접 읽는다.
 */
import type { ProductStatus, RetryCounts, CurrentStep, ValidationSnapshot } from './types'

/* ════════════════════════════════════════════════════════════════
 * 입력 — ProductRow의 부분집합
 *
 * 구조적 타이핑이라 `ProductRow`를 그대로 넘길 수 있고, GET #9 응답도
 * 같은 모양이라 클라이언트에서 그대로 넘길 수 있다.
 * ════════════════════════════════════════════════════════════════ */

export interface StatusInput {
  status: ProductStatus
  validation_snapshot: { verdict: 'pass' | 'fail' } | null
  human_edited: boolean
  publish_override_at: string | null
}

/**
 * 최상위 판정. 스냅샷이 없으면 **`null`(미검증)이지 `pass`가 아니다.**
 *
 * 없는 것을 통과로 읽으면 아직 검증하지 않은 상품이 게시 게이트를 그냥
 * 통과한다(§11.5). 반대로 `fail`로 읽으면 아직 검증 전인 상품에 「검증 실패」
 * 배지가 붙는다(§10.4). 둘 다 틀리므로 세 번째 값을 둔다.
 */
export function verdictOf(p: StatusInput): 'pass' | 'fail' | null {
  return p.validation_snapshot?.verdict ?? null
}

/* ════════════════════════════════════════════════════════════════
 * 버튼 (§15.1 「제공 버튼」 열)
 * ════════════════════════════════════════════════════════════════ */

export type ButtonKey =
  | 'resume'      // [이어서 진행]        §15.1.1
  | 'restart'     // [처음부터 다시]      §15.1.1 → #8
  | 'resubmit'    // [입력 수정 후 재제출] §14.4 #17
  | 'create-page' // [상품 생성]          §9.5 ①②③
  | 'regenerate'  // [다시 생성]          §15.3 → #8
  | 'edit-input'  // [입력 수정]          → /new?product_id=
  | 'edit'        // [편집]               → 편집기
  | 'publish'     // [게시] / [책임 게시]  §11.5 → #12
  | 'unpublish'   // [게시 중단]          §14.4 #13

export interface ActionButton {
  key: ButtonKey
  label: string
  /** 화면에 **보이되 누를 수 없다.** §15.1의 「[상품 생성] 잠김」이 이것이다 */
  disabled?: boolean
  /** 비활성 사유 — 툴팁·안내 문구로 쓴다. 막힌 길이 아님을 알려야 한다 */
  disabledReason?: string
  /** 누르기 전 명시적 확인이 필요하다 (§11.5·§15.3) */
  confirm?: string
}

export interface StatusView {
  /** §15.1 「표시 이름」 열. DB의 영어 status를 화면에 그대로 쓰지 않는다 */
  label: string
  /** §14.1의 「도달 화면 → 경로」 대응 */
  screen: Screen
  /** 검증 실패 항목 전체를 함께 보여줘야 하는가 (§15.1 「+ 실패 항목」) */
  showsFailedItems: boolean
  /** `/p/{slug}`가 200을 반환하는가. `published` 하나뿐이다 */
  isPublic: boolean
  buttons: ActionButton[]
}

export type Screen = 'detail' | 'form-resubmit' | 'editor'

export function screenPath(screen: Screen, productId: string): string {
  switch (screen) {
    case 'form-resubmit': return `/new?product_id=${productId}`
    case 'editor': return `/admin/products/${productId}/edit`
    case 'detail': return `/admin/products/${productId}`
  }
}

/**
 * 목록 행의 버튼이 데려갈 화면 (§14.1).
 *
 * ## 왜 목록에서 바로 실행하지 않는가
 *
 * §15.1의 「제공 버튼」은 **「도달 화면」과 같은 줄에 있는 열**이다 — 그 화면에서
 * 제공된다는 뜻이다. 목록 행에서 곧바로 실행하면 규정을 지킬 수 없는 버튼이 있다.
 *
 *   · [게시]가 `fail`이면 §11.5는 **실패 항목 전체를 열람**한 뒤 체크를 요구한다.
 *     목록 행에는 그 항목이 없다.
 *   · [다시 생성]이 편집분을 지울 때는 §15.3이 확인을 요구한다.
 *   · [상품 생성]은 AI 3요청을 순차 호출하며 진행 표시가 필요하다(§9.6).
 *
 * 그래서 목록의 버튼은 **「지금 이 상품에 무엇을 할 수 있는가」를 한눈에 보여주고
 * 그 자리로 데려가는 입구**다. 실행은 맥락이 갖춰진 화면에서 한다.
 */
export function buttonTarget(key: ButtonKey, productId: string): string {
  switch (key) {
    // 입력 수정 계열은 언제나 값이 유지되는 폼으로 간다 (§14.1)
    case 'edit-input':
    case 'resubmit':
      return `/new?product_id=${productId}`
    case 'edit':
      return `/admin/products/${productId}/edit`
    /**
     * 나머지는 전부 상세다. 검증 4축과 실패 항목 전체가 그 화면에 있어
     * §11.5의 열람 요건을 그대로 만족한다.
     */
    default:
      return `/admin/products/${productId}`
  }
}

/* ── 버튼 조립 ─────────────────────────────────────────────────── */

/**
 * [게시] 버튼 (§11.5 게시 게이트).
 *
 * ## §15.1과 §11.5를 맞춘 지점
 *
 * §15.1 표는 `draft`·`reviewing`의 `fail` 행에만 「책임 게시」라고 적고,
 * `unpublished` 행은 verdict 「무관」에 「[게시]」로만 적혀 있다. 글자 그대로 읽으면
 * **게시 중단했다가 다시 게시할 때만 검증 실패가 무시되는** 셈이 되는데,
 * §11.5는 게시 게이트를 상태와 무관하게 규정하고 「`input_error`에는 게시 경로가
 * 없다」만 예외로 둔다.
 *
 * 그래서 **버튼은 하나로 두고 절차만 verdict로 가른다** — 표기가 갈리는 것은
 * 같은 게이트의 두 얼굴이지 서로 다른 버튼이 아니다. 두 절을 모두 만족한다.
 */
function publishButton(p: StatusInput): ActionButton {
  const proc = publishProcedure(p)

  switch (proc.kind) {
    case 'override':
      return {
        key: 'publish', label: '책임 게시',
        confirm: '검증 실패 항목을 모두 확인했으며 책임하에 게시합니다.',
      }
    case 'blocked':
      return {
        key: 'publish', label: '게시', disabled: true, disabledReason: proc.reason,
      }
    case 'acknowledge':
      // 편집분은 AI 검증 대상이 아니다 — 게시 전에 그 사실을 알린다(§10.4·§11.5)
      return { key: 'publish', label: '게시', confirm: '편집된 내용은 AI 검증 대상이 아닙니다.' }
    case 'plain':
      return { key: 'publish', label: '게시' }
  }
}

/* ════════════════════════════════════════════════════════════════
 * 게시 게이트 (§11.5) — **버튼 표기와 서버 판정의 공통 뿌리**
 *
 * 화면이 활성화한 버튼이 서버에서 403으로 튕기면(또는 그 반대) 게이트가
 * 두 개 있는 것과 같다. verdict 축을 함수 하나로 뽑아 양쪽이 나눠 쓴다.
 * ════════════════════════════════════════════════════════════════ */

export type PublishProcedure =
  /** 게시 경로가 없다 — verdict가 없으면 통과로 볼 근거가 없다 */
  | { kind: 'blocked'; reason: string }
  /** `verdict = fail` → 실패 항목 전체 열람 + 책임 확인 후 `publish_override_at` 기록 */
  | { kind: 'override' }
  /** `pass` + `human_edited` → 「편집분은 검증 대상이 아니다」 확인 */
  | { kind: 'acknowledge' }
  /** `pass` + 편집 없음 → 확인 없이 게시 */
  | { kind: 'plain' }

export function publishProcedure(p: StatusInput): PublishProcedure {
  const verdict = verdictOf(p)
  if (verdict === 'fail') return { kind: 'override' }
  if (verdict === null) {
    return {
      kind: 'blocked',
      reason: '검증 결과가 없습니다. [다시 생성]으로 검증을 실행해 주세요.',
    }
  }
  return p.human_edited ? { kind: 'acknowledge' } : { kind: 'plain' }
}

/** §15.2 — [게시]로 `published`에 갈 수 있는 상태. `input_error`에는 경로가 없다(§11.5). */
export const PUBLISHABLE_STATUSES: ProductStatus[] = ['draft', 'reviewing', 'unpublished']

/* ── 삭제 게이트 (§12.4 · #18) ─────────────────────────────────── */

/**
 * §12.4가 금지하는 상태는 `published` 하나다. 나머지 6개는 전부 삭제할 수 있고,
 * **`generating`도 포함된다** — 「진행 주체가 사라진 상품을 정리하는 것이 이
 * 기능의 주 용도」라고 §12.4가 명시한다(§15.1.1).
 *
 * 그래서 목록을 열거하지 않고 `published`만 뺀다. 열거하면 상태가 늘 때
 * 빠뜨리고, 그때 「지울 수 없는 상품」이 조용히 생긴다.
 */
export const UNDELETABLE_STATUS: ProductStatus = 'published'

export interface DeleteInput {
  status: ProductStatus
  /** 이 상품에 `applications` 행이 1건 이상 있는가 */
  hasApplications: boolean
}

export type DeleteGate =
  | { ok: true }
  /** §14.6 — 미충족은 409 `precondition` + 사유. 재호출로는 풀리지 않는다 */
  | { ok: false; detail: string }

/**
 * 서버의 최종 판정 (§14.4 #18 · §12.4).
 *
 * 신청이 있으면 막는 이유는 §12.3이 신청 데이터 보존을 규정하기 때문이다 —
 * 상품만 지우면 고아 신청이 남는다. DB의 `on delete restrict`가 같은 것을
 * 강제하지만(§5.3) 그쪽은 오류 메시지가 영문 제약 이름이라 화면에 쓸 수 없다.
 * 판정을 여기서 하고 DB 제약은 최후 방어선으로 둔다.
 */
export function deleteGate(p: DeleteInput): DeleteGate {
  if (p.status === UNDELETABLE_STATUS) {
    return {
      ok: false,
      detail: '게시 중인 상품은 삭제할 수 없습니다. 먼저 [게시 중단]을 해주세요.',
    }
  }
  if (p.hasApplications) {
    return {
      ok: false,
      detail: '신청 내역이 있는 상품은 삭제할 수 없습니다. 신청 내역을 먼저 삭제해 주세요.',
    }
  }
  return { ok: true }
}

export interface PublishInput extends StatusInput {
  slug: string | null
  /** `page_content`가 있는가. 없으면 공개할 내용 자체가 없다 */
  hasPageContent: boolean
}

export type PublishGate =
  | { ok: true; override: boolean }
  /** §14.6 — #12의 미통과는 409가 아니라 **403**이다 */
  | { ok: false; reason: string }

/**
 * 서버의 최종 판정 (§14.4 #12 · §14.5).
 *
 * `override`를 요구하는 이유: `verdict = fail`의 게시는 `publish_override_at`과
 * `publish_override` 로그를 남기는 **기록되는 결정**이다(§11.5). 요청에 그
 * 의사가 없으면 사고로 눌린 것과 구분할 수 없으므로, 클라이언트의 모달을
 * 믿지 않고 요청 본문으로 받는다.
 *
 * 반대로 `pass` + `human_edited`의 확인은 DB에 아무것도 남기지 않는 **화면
 * 규정**이라 서버가 강제하지 않는다 — 강제하면 §11.5에 없는 조건이 늘어난다.
 */
export function publishGate(p: PublishInput, opts: { override?: boolean } = {}): PublishGate {
  if (p.status === 'published') {
    return { ok: false, reason: '이미 게시된 상품입니다.' }
  }
  if (!PUBLISHABLE_STATUSES.includes(p.status)) {
    return { ok: false, reason: `${p.status} 상태에는 게시 경로가 없습니다(§11.5).` }
  }
  if (!p.hasPageContent) {
    return { ok: false, reason: '상품 페이지가 없습니다. 먼저 [상품 생성]을 실행해 주세요.' }
  }
  if (!p.slug) {
    return { ok: false, reason: '공개 주소(slug)가 없습니다.' }
  }

  const proc = publishProcedure(p)
  if (proc.kind === 'blocked') return { ok: false, reason: proc.reason }
  if (proc.kind === 'override' && !opts.override) {
    return {
      ok: false,
      reason: '검증 실패 항목을 확인하고 책임 게시에 동의해야 게시할 수 있습니다(§11.5).',
    }
  }

  return { ok: true, override: proc.kind === 'override' }
}

/** [다시 생성] (§15.3). 편집분이 있으면 사라진다는 것을 먼저 알린다. */
function regenerateButton(p: StatusInput): ActionButton {
  return {
    key: 'regenerate',
    label: '다시 생성',
    ...(p.human_edited ? { confirm: '편집한 내용이 사라집니다.' } : {}),
  }
}

/* ════════════════════════════════════════════════════════════════
 * §15.1 표 본체
 * ════════════════════════════════════════════════════════════════ */

export function describeStatus(p: StatusInput): StatusView {
  const verdict = verdictOf(p)
  const failed = verdict === 'fail'

  switch (p.status) {
    /**
     * 버림받을 수 있는 유일한 상태다. 재시도 주체가 클라이언트이므로(§4.2)
     * 브라우저를 닫으면 진행시킬 사람이 없다. 그래서 이 상태에만 복구 버튼 2개를 둔다.
     */
    case 'generating':
      return {
        label: '처리중', screen: 'detail', showsFailedItems: false, isPublic: false,
        buttons: [
          { key: 'resume', label: '이어서 진행' },
          { key: 'restart', label: '처음부터 다시' },
        ],
      }

    /** **입력 문제 전용**이다. AI가 재시도를 소진한 경우는 여기로 오지 않는다(§15.1). */
    case 'input_error':
      return {
        label: '입력오류', screen: 'form-resubmit', showsFailedItems: false, isPublic: false,
        buttons: [{ key: 'resubmit', label: '입력 수정 후 재제출' }],
      }

    /**
     * `fail`에서 [상품 생성]을 **잠그되 숨기지 않는다.** 소개서가 입력과 어긋난
     * 채로 페이지를 만들면 오류가 증폭되기 때문인데, 버튼을 아예 없애면
     * 기획자가 "왜 다음으로 못 가지?"를 알 수 없다. 잠금 + 사유가 정답이다.
     */
    case 'brochure_ready':
      return {
        label: '소개서 완료', screen: 'detail', showsFailedItems: failed, isPublic: false,
        buttons: [
          {
            key: 'create-page', label: '상품 생성',
            ...(verdict === 'pass' ? {} : {
              disabled: true,
              disabledReason: '1차 검증을 통과해야 상품을 생성할 수 있습니다. '
                + '[다시 생성]하거나 입력을 수정해 주세요.',
            }),
          },
          regenerateButton(p),
          { key: 'edit-input', label: '입력 수정' },
        ],
      }

    case 'draft':
      return {
        label: '임시저장', screen: 'editor', showsFailedItems: failed, isPublic: false,
        buttons: [
          { key: 'edit', label: '편집' },
          publishButton(p),
          regenerateButton(p),
        ],
      }

    /**
     * **[다시 생성]을 제공하지 않는다.** `draft`에서 한 번이라도 저장하면
     * `reviewing`이 되고, 그 시점부터는 사람이 편집한 내용이 있다 —
     * 재생성은 그것을 지운다(§15.1).
     */
    case 'reviewing':
      return {
        label: '검토중', screen: 'editor', showsFailedItems: failed, isPublic: false,
        buttons: [{ key: 'edit', label: '편집' }, publishButton(p)],
      }

    /** 편집은 가능하고 저장 시 **즉시** 공개 페이지에 반영된다. 스테이징 없음(§15.2). */
    case 'published':
      return {
        label: '게시됨', screen: 'editor', showsFailedItems: failed, isPublic: true,
        buttons: [
          { key: 'edit', label: '편집' },
          {
            key: 'unpublish', label: '게시 중단',
            /*
             * §12.3에 확인 절차 규정은 없다. 그래도 확인을 받는 이유: 이 버튼은
             * **공개 중인 페이지를 즉시 404로 만든다.** 되돌릴 수는 있지만
             * 그 사이 링크를 탄 고객은 빈손으로 돌아간다. [편집] 옆에 나란히
             * 있어 오클릭 거리도 짧다.
             */
            confirm: '공개 페이지가 즉시 접속되지 않게 됩니다. 이미 접수된 신청은 그대로 보관됩니다.',
          },
        ],
      }

    case 'unpublished':
      return {
        label: '게시중단', screen: 'editor', showsFailedItems: failed, isPublic: false,
        buttons: [{ key: 'edit', label: '편집' }, publishButton(p)],
      }
  }
}

/** §14.1 목록 화면의 상태 필터 — 7개 상태 전부 + 「전체」. */
export const STATUS_FILTERS: { value: ProductStatus | 'all'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'generating', label: '처리중' },
  { value: 'input_error', label: '입력오류' },
  { value: 'brochure_ready', label: '소개서 완료' },
  { value: 'draft', label: '임시저장' },
  { value: 'reviewing', label: '검토중' },
  { value: 'published', label: '게시됨' },
  { value: 'unpublished', label: '게시중단' },
]

/* ════════════════════════════════════════════════════════════════
 * 배지 2종 (§10.4) — **두 축은 서로 독립이다**
 *
 * 하나로 합치면 조건이 겹치고, 검증 실패 시 편집 여부가 화면에서 사라진다.
 * `AI 검증 실패` + `사람 편집됨`은 동시에 표시될 수 있어야 한다.
 * ════════════════════════════════════════════════════════════════ */

export type VerificationBadge = 'pass' | 'fail' | 'override' | null

/**
 * 검증축 3종. **상호 배타이며 위에서 아래 순으로 판정한다**(§10.4).
 * 미검증(`null`)은 배지를 붙이지 않는다 — 아직 판정이 없는 것을
 * 「실패」로 표시하면 생성 중인 상품이 전부 빨갛게 보인다.
 */
export function verificationBadge(p: StatusInput): VerificationBadge {
  const verdict = verdictOf(p)
  if (verdict === 'pass') return 'pass'
  if (verdict === 'fail') return p.publish_override_at ? 'override' : 'fail'
  return null
}

export const VERIFICATION_BADGE_LABEL: Record<Exclude<VerificationBadge, null>, string> = {
  pass: 'AI 검증 통과',
  fail: 'AI 검증 실패',
  override: '검증 실패 · 책임 게시됨',
}

/** 편집축. `false`면 **표시하지 않는다** — 「사람 편집 안 됨」 배지는 없다(§10.4). */
export function editBadge(p: StatusInput): '사람 편집됨' | null {
  return p.human_edited ? '사람 편집됨' : null
}

/* ════════════════════════════════════════════════════════════════
 * GET /api/products/{id} 응답 (§14.4 #9)
 * ════════════════════════════════════════════════════════════════ */

/**
 * 「상태·단계·검증 결과 조회(새로고침 복귀용)」.
 *
 * 산출물 본문(`brochure_content`·`page_content`·`confirmed_data`)은 **넣지 않는다.**
 * 이 응답의 용도는 §14.6이 규정한 「409를 받은 뒤 현재 상태를 다시 읽고 화면을
 * §15.1 표에 맞춰 갱신한다」와 §15.1.1의 재개 판단이며, 둘 다 상태값만 있으면 된다.
 * 수십 KB짜리 콘텐츠를 매 재조회마다 실어 나를 이유가 없다.
 *
 * `updated_at`은 §16.1.1의 조건부 갱신 때문에 필요하다 — `stale` 409를 받은
 * 클라이언트가 최신 값을 다시 잡는 경로가 이것뿐이다.
 */
export interface ProductStatusResponse {
  id: string
  execution_id: string
  status: ProductStatus
  current_step: CurrentStep
  attempt_no: number
  retry_counts: RetryCounts
  slug: string | null
  human_edited: boolean
  publish_override_at: string | null
  failure_reason: string | null
  published_at: string | null
  updated_at: string
  validation_snapshot: ValidationSnapshot | null
}
