/**
 * 공개 페이지의 404 (§12.3) — **고객이 보는 화면이다.**
 *
 * Next.js 기본 404는 「404 | This page could not be found.」 한 줄이라, 링크를
 * 받고 들어온 고객이 「주소를 잘못 눌렀나」로 읽는다. 실제로 가장 흔한 경우는
 * **게시가 중단된 상품**이고(§12.3), 그때 필요한 안내는 「문의처로 연락」이다.
 *
 * §13.3이 이메일 본문에 넣도록 규정한 문구
 * 「상품이 마감·중단된 경우 링크가 열리지 않을 수 있습니다. 문의처로 연락해
 * 주세요.」와 같은 말을 한다 — 메일을 보고 눌렀다가 여기 닿는 경로가 있으므로
 * 두 화면의 설명이 어긋나면 안 된다.
 *
 * 상품이 실제로 없는지 내렸는지는 **구분하지 않는다.** 구분해 알려주면
 * 「그 주소에 뭔가 있긴 하다」는 정보가 새 나간다.
 */
export default function ProductNotFound() {
  // 폼 입력이 아니라 환경 변수다(§13.3). 미설정이면 문구를 통째로 생략한다.
  const contact = process.env.CONTACT_INFO?.trim()

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
        페이지를 찾을 수 없습니다
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-neutral-700">
        상품이 마감·중단된 경우 링크가 열리지 않을 수 있습니다.
        {contact ? ' 아래 문의처로 연락해 주세요.' : ' 담당자에게 문의해 주세요.'}
      </p>

      {contact && (
        <p className="mt-4 rounded-xl bg-neutral-100 px-4 py-3 text-[15px] text-neutral-900">
          {contact}
        </p>
      )}
    </main>
  )
}
