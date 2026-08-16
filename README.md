# zentrip

여행 상품 페이지 **자동 생성·배포 플랫폼**. 기획이 끝난 여행 상품 정보를 웹 폼에 입력하면, AI가 소개서와 고객용 반응형 상품 페이지를 생성하고, 기획자가 편집기에서 검토·수정한 뒤 버튼 하나로 상품별 고유 URL에 배포한다. 고객 신청은 데이터베이스에 적재되고 상품 정보 이메일이 자동 발송된다.

> **측정 기준**: 기획자 1명이 상품 정보 입력부터 공개 URL 배포까지 **10분 이내**, 코드·디자인 작업 **0건**으로 완료.

## 흐름 (엔드투엔드)

```
로그인 → /new 폼+이미지 → 소개서 생성 → 상품 페이지 생성 → 편집기 → 게시
      → 비로그인 /p/{slug} 열람 → 신청 → 확인 이메일 → /admin/logs/{execution_id}
```

폼 앞단에는 **자연어 초안**(`/new` 챗·프리폼 패널)이 있어, 기획자가 자유롭게 적은 메모에서 AI가 폼 초안을 만들어 준다. `form_input` 확정은 여전히 사람이 한다.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프레임워크 | Next.js 16 (App Router) · React 19 |
| 데이터베이스 | Supabase (Postgres) |
| AI | Gemini `gemini-3.5-flash-lite` (`@google/genai`) · 예비 공급자 DeepSeek |
| 이메일 | Resend |
| 스타일 | Tailwind CSS 4 |
| 배포 | Vercel 단일 프로젝트 |

## 아키텍처 — 하네스 규약

파이프라인은 **라우트 → 에이전트 → 스킬 체인** 3층 구조다.

```
라우트  →  runStep(상태·로그·재시도)  →  runAgent(에이전트 1개)
                                            └→ 스킬 체인 (선언된 순서)
                                                 ├ mechanical 스킬 (AI 0회)  ← 기본
                                                 └ ai 스킬 (AI 1회)          ← 라우트당 최대 1개
```

핵심 원칙:

1. **1요청 1AI호출.** 서버 라우트 1건은 AI를 최대 1회 호출한다. `manifest.json`의 `ai_budget`이 이를 기계적으로 강제한다.
2. **재시도는 클라이언트가 같은 API를 재호출.** 서버 내부 루프·폴링·큐·Cron 없음.
3. **AI 출력은 JSON 스키마로 강제.** 어긋난 구조가 파이프라인에 들어가는 경로는 없다.
4. **AI는 콘텐츠 JSON만 만든다. HTML 생성 금지.** 렌더링은 고정 React 컴포넌트가 한다.
5. **사실정보 값은 AI를 거치지 않는다.** 값은 `confirmed_data`에서 기계적으로 치환되고, AI는 디자인 스펙·블록 계획·서술만 만든다.

프롬프트·스킬 체인·판정 규칙의 유일한 출처는 `.claude/skills/`·`.claude/agents/`·`.claude/harness/manifest.json`이며, 코드젠(`npm run build:harness`)이 이를 `lib/harness/generated/`로 구워 낸다.

## 문서

| 문서 | 지위 |
|---|---|
| `spec.md` (2.8) | **구현의 유일한 권위.** 스키마·상한·규정·응답코드 전부 |
| `workflow.md` (2.5) | 단계 순서·분기·복귀 |
| `checklist.md` (2.4) | 판정 항목 약 355개, 게이트 G0~G6 |
| `CHANGELOG.md` | 개정 근거(부록 A~H) |
| `docs/harness-skill-map.md` | 스킬·에이전트 지도 (사람용) |
| `docs/harness-migration.md` | 전환 계획·실사용 기록·인계 문서 |
| `CLAUDE.md` | 구현 지침 요약 (에이전트용) |

> spec 2.8은 상품 상세페이지의 「고정 9섹션」을 없애고 구성·순서·분위기를 AI가 짜게 한 판본이다.

## 시작하기

### 키 없이 도는 것

```bash
npm ci
npm run build:harness    # .claude/ → lib/harness/generated/registry.ts 코드젠
npm run test:harness     # 하네스 규약 위반 검사 (커밋 전 필수)
npm run test:policy      # 규칙·계약 회귀
npx tsc --noEmit && npm run lint
npm run build            # 프로덕션 빌드
```

### AI·DB 키가 필요한 것

```bash
npm run dev              # 개발 서버
npm run probe:gemini     # AI 경로 실측 (키·모델을 건드렸으면 이것부터)
npm run test:real        # §20 엔드투엔드 관통 (AI 6회 + 이메일 1통)
npm run test:plan-draft  # 자연어 초안 관통 (AI 2회)
```

## 환경 변수

전부 **서버 전용** (`NEXT_PUBLIC_` 접두사 사용 금지).

| 변수 | 용도 |
|---|---|
| `GEMINI_API_KEY` | 주 AI 공급자 키 |
| `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` | 데이터베이스 |
| `RESEND_API_KEY` | 이메일 발송 |
| `ADMIN_PASSWORD` · `SESSION_SECRET` | 관리자 인증 |
| `SITE_URL` · `CONTACT_INFO` | 페이지 렌더링 |
| `AI_MODEL` *(선택)* | 같은 공급자 내 다른 모델로 교체 |
| `AI_PROVIDER` *(선택)* | 비우면 gemini(주경로), `deepseek`이면 예비경로 |
| `DEEPSEEK_API_KEY` *(선택)* | 예비경로용 |
| `EMAIL_ENABLED` *(선택)* | `true`일 때만 신청 확인 메일 발송 (기본 꺼짐) |
| `MAIL_FROM` *(선택)* | 도메인 인증 후 발신 주소 |

## 디렉터리 구조

```
app/          Next.js App Router (라우트·페이지·API)
  api/        서버 라우트 (products·applications·plan-chat·plan-draft ...)
  new/        상품 등록 폼 + 자연어 초안 패널
  p/[slug]/   공개 상품 페이지
  admin/      관리 페이지 (products·logs·applications·preview)
lib/
  ai/         provider 중립 AI 인터페이스 (라우트는 이것만 호출)
  harness/    에이전트 + 코드젠 결과 (generated/)
  pipeline/   실제 변환 로직 (스킬 impl)
  client/     클라이언트 재개 파이프라인
components/    고정 React 렌더 컴포넌트
supabase/      DB 마이그레이션
scripts/       코드젠·테스트·프로브 스크립트
.claude/       스킬·에이전트·매니페스트 (런타임 실행 근거)
```

## 라이선스

Private.
