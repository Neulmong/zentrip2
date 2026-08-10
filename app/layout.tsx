import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'zentrip',
  description: '여행 상품 페이지 자동 생성·배포 플랫폼',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // spec §17.2 — 라이트 테마 단일. 다크 모드는 범위 제외다.
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-white text-neutral-900">{children}</body>
    </html>
  )
}
