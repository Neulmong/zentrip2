import type { Metadata } from 'next'
import { Geist_Mono, Noto_Sans_KR, Noto_Serif_KR } from 'next/font/google'
import './globals.css'

/**
 * 타이포그래피 (젠트립 정렬) — **한글 웹폰트를 실제로 싣는다.**
 *
 * 이전에는 라틴 전용 Geist만 로드해 한글이 시스템 폴백(맑은 고딕·바탕)으로 떨어졌다.
 * 특히 `font-serif`를 헤드라인·가격·일차에 두루 쓰는데 한글 세리프가 없어
 * 「매거진 감성」이 화면에서 실제로는 살지 않았다.
 *
 * 젠트립(휴플)은 밝고 둥근 **산세리프** 톤이다 — 본문·UI는 Noto Sans KR로 그 톤을
 * 입히고, 세리프(Noto Serif KR)는 감성 포인트(히어로 카피·섹션 키커·가격)에만 쓴다.
 * CJK는 무거우므로 preload 하지 않고 swap으로 붙인다.
 */
const sansKR = Noto_Sans_KR({
  variable: '--font-sans-kr',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})
const serifKR = Noto_Serif_KR({
  variable: '--font-serif-kr',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'zentrip',
  description: '여행 상품 페이지 자동 생성·배포 플랫폼',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // spec §17.2 — 라이트 테마 단일. 다크 모드는 범위 제외다.
    <html
      lang="ko"
      className={`${sansKR.variable} ${serifKR.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-white text-neutral-900">{children}</body>
    </html>
  )
}
