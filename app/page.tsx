import { redirect } from 'next/navigation'

/** 루트는 관리 화면으로 보낸다. 미인증이면 middleware가 로그인으로 돌린다(§14.2). */
export default function Home() {
  redirect('/admin')
}
