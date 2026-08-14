# 신청 확인 이메일 — 아무 손님에게나 보내기 (도메인 인증)

> **현재 상태.** 신청 접수·저장·관리자 확인은 **완전히 정상**이다. 다만 확인 이메일은
> Resend가 **가입 계정 본인 주소로만** 보낸다(도메인 미인증 기본 제약). 손님 아무
> 이메일로나 보내려면 아래 3단계를 한 번만 하면 된다. **코드 수정은 없다 — 환경변수만 바꾼다.**

## 왜 지금은 본인에게만 오나

도메인을 인증하지 않으면 Resend는 발신 주소를 공용 `onboarding@resend.dev`로 강제하고,
그 주소에서는 **Resend 계정 소유자 이메일**에게만 배달한다. 다른 주소로 보내면 422로 거부되고,
그 신청의 `email_status`는 `failed`로 남는다(신청 자체는 성공으로 확정됨 — 이메일은 부가 절차).

- **테스트로 지금 당장 이메일을 받아보려면**: 신청 폼 이메일에 **Resend 가입 계정 주소**를
  넣으면 실제로 도착한다.
- **손님 누구에게나 보내려면**: 아래 도메인 인증을 한다.

## 3단계 (한 번만)

### 1. 도메인 인증
1. https://resend.com/domains 접속 → **Add Domain** → 보유한 도메인 입력(예 `example.com`)
2. Resend가 주는 **DNS 레코드**(SPF·DKIM 등)를 도메인 관리 페이지(가비아·카페24·Cloudflare 등)에
   추가
3. Resend 화면에서 **Verified** 로 바뀔 때까지 대기(보통 몇 분~수십 분)

> 도메인이 없으면 먼저 도메인을 하나 구입해야 한다. (Resend 자체는 도메인을 팔지 않는다)

### 2. 환경변수 `MAIL_FROM` 설정
발신 주소를 **그 인증된 도메인의 주소**로 지정한다. 반드시 `이름 <주소@인증도메인>` 형식.

- **Vercel**: 프로젝트 → Settings → Environment Variables →
  `MAIL_FROM = 제트립 <no-reply@example.com>` 추가 (Production)
- **로컬**(선택): `.env.local`에 같은 줄 추가

### 3. 재배포 / 재시작
- **Vercel**: 환경변수는 **Redeploy** 해야 반영된다.
- **로컬**: dev 서버 재시작.

끝. 이제 손님이 어떤 이메일을 넣어도 확인 메일이 그 주소로 발송된다.

## 확인 방법
- 공개 페이지에서 아무 이메일로 신청 → 그 주소 받은편지함 확인
- 또는 관리자 실행 로그/`applications.email_status`가 `sent`인지 확인(실패면 `failed` + 사유가 남음)

## 코드 근거 (참고)
- 발신 주소: `lib/env.ts`의 `MAIL_FROM` 게터(없으면 `onboarding@resend.dev` 폴백)
- 발송: `lib/email.ts` `sendApplicationEmail` — `from: env.MAIL_FROM`
- 이 설계 규정: spec §13.3
