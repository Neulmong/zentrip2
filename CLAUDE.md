# zentrip — 구현 지침

여행 상품 페이지 자동 생성·배포 플랫폼. Next.js(App Router) + Supabase + Claude API + Resend, Vercel 단일 프로젝트.

## ⚠️ 문서 권위 — 이것부터 읽는다

| 문서 | 지위 |
|---|---|
| **`spec.md` (2.4)** | **구현의 유일한 권위.** 스키마·상한·규정·응답코드 전부 |
| `workflow.md` (2.4) | 단계 순서·분기·복귀. spec과 어긋나면 spec |
| `checklist.md` (2.4) | 판정 항목 약 355개. 게이트 G0~G6 |
| `origin-spec.md` (2.2) | **이전 판본.** 방향성 대조용 히스토리. 구현 근거로 쓰지 않는다 |
| **`.claude/agents/` · `.claude/skills/`** | **🚫 구현 중 참조 금지.** 2.2 기준이라 spec 2.4와 23건 어긋난다 |

`.claude/skills/`의 15개 스킬 문서는 **틀린 게 아니라 2.2 시점에 정확했다.** spec만 2.4로 갔다.
스킬 문서가 필요한 순간이 오면 **그 1개를 spec 2.4 기준으로 고친 뒤** 쓴다. 그대로 복사하지 않는다.

### 2.2 → 2.4에서 뒤집힌 값 (스킬 문서가 아직 2.2인 지점)

| 항목 | 2.2 (스킬 문서) | **2.4 (구현할 값)** | spec |
|---|---|---|---|
| 재시도 카운터 | 3종, 0차가 `brochure` 공유 | **4종** `normalization`·`brochure`·`page`·`consistency`, 예산 비공유 | §11.6 |
| 라우트 시작 조건 | `current_step` 값으로 판정 | **재료 기준** (산출물 존재 + 선행 축 판정값) | §14.5 |
| 409 응답 | 코드만 | **`reason` 필수** `retry`/`precondition`/`stale`/`slug_conflict`/`product_not_published` | §14.6 |
| 여행기간 | 단일 필드 | `form_input`은 `여행기간_시작`·`여행기간_종료` **2필드**, `confirmed_data`에서만 결합 | §6.2.1·§7.4 |
| 정규화 대상 | 모든 날짜·금액 값 | 날짜는 여행기간 2필드만, 금액은 `가격.성인`·`가격.아동` 2필드만 | §6.2 |
| 조사 파이프 | 값 필드에도 적용 | **`source: "generated"` 서술 필드에만.** 값 필드 금지 | §8.8 |
| 길이 계약 | 항상 6종 | 생성 시 **4종** / 편집 저장 시 **6종** | §17.1 |
| 로그 `verdict` | `통과`/`반려` | **저장은 영어** `pass`/`fail`/`-`, 화면에서만 한글 | §5.4 |
| 신청 로그 | 원본 기록 | `category=application`은 **저장 시점 마스킹** | §5.4 |
| 이상 플래그 중복 | `(step, type)` | **`(execution_id, attempt_no, step, type)`** | §5.5 |
| 동시성 | 없음 | 전 쓰기 라우트 `updated_at` 조건부 갱신 → **409 `stale`** | §16.1.1 |

## 절대 원칙

1. **1요청 1AI호출.** 서버 라우트 1건은 AI를 최대 1회. 타임아웃 25초, `maxRetries: 0`, `maxDuration` 60초 (§4.2·§4.3)
2. **재시도는 클라이언트가 같은 API를 재호출.** 서버 내부 루프·폴링·큐·Cron 없음. `202` 사용 안 함
3. **AI 출력은 `output_config.format`으로 JSON 스키마 강제.** 프롬프트로 "JSON만 출력" 지시 금지 (§4.3)
4. **검증 기준값은 `form_input`.** `confirmed_data`는 0차의 검증 대상이지 기준이 아니다 (§11.1)
5. **AI는 `page_content`/`brochure_content` JSON만 만든다. HTML 생성 금지.** 렌더링은 고정 React 컴포넌트 (§9.1)
6. **`source` 맵 필수.** `source` 없는 사실정보 필드는 그 자체로 실패 (§8.8·§9.3)
7. **입력에 없는 값을 만들지 않는다.** 일차 서술은 `원문근거` 범위 안에서만 (§6.3·§16.1)
8. **모델은 `claude-opus-5`** (날짜 접미사 없음). `temperature`·`top_p`·`top_k` 금지, `thinking: {type:"adaptive"}`, effort 생성 `medium`/검증 `low` (§4.3)

## 목표

**데모: 2026-08-14(금).** 평가 대상은 *돌아가는 결과물의 시연*이며, 종료 조건은 **spec §20의 3분 시나리오**다.
로그인 → `/new` 폼+이미지 → [소개서 생성](4요청) → [상품 생성](3요청) → 편집기 → [게시] → 비로그인 `/p/{slug}` → 신청 → 이메일 → `/admin/logs/{execution_id}`.

§20 경로에 없는 기능은 후순위. 측정 기준은 §1 — 입력부터 배포까지 10분, 코드·디자인 작업 0건.

### 데모 대본 제약 (확정)

- **Resend 도메인 미인증으로 간다** (§13.3이 규정한 경로). 발신은 `onboarding@resend.dev` 고정이고
  **수신은 Resend 가입 이메일 주소로만** 된다. 따라서 §20 2:40의 신청 폼에는 **본인 가입 이메일**을 입력한다.
- 컷 라인: §20에 안 나오는 **삽입 블록 3종·순서변경**이 1순위 축소 대상.
  절대 자르지 않는 것은 **4축 검증 배지(1:15)** 와 **비로그인 `/p/{slug}` 접속(2:20)** 이다.

## 환경 변수

전부 **서버 전용**. `NEXT_PUBLIC_` 접두사 변수를 만들지 않는다 (공개 페이지도 서버 렌더링).
`ANTHROPIC_API_KEY` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `RESEND_API_KEY` · `ADMIN_PASSWORD` · `SESSION_SECRET` · `SITE_URL` · `CONTACT_INFO`

## 명령

```bash
npm run dev     # 개발 서버
npm run build   # 프로덕션 빌드
npm run lint
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
