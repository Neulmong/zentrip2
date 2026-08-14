'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * 실시간 미리보기 틀 (§10.1) — **iframe 안으로 React 트리를 심는다.**
 *
 * ## 왜 고정 폭 `div`로는 안 되는가
 *
 * Tailwind의 `md:`·`sm:`은 **뷰포트** 폭에 걸린 미디어 쿼리다. 부모에 375px을
 * 주고 그 안에 페이지를 그리면, 브라우저 창이 1400px인 이상 데스크톱 레이아웃이
 * 그대로 나온다 — 폭만 좁아진 채로. 「375에서 어떻게 보이는가」를 확인하려는
 * 미리보기가 정반대의 답을 주게 된다.
 *
 * iframe은 자체 뷰포트를 가지므로 실제 브레이크포인트가 걸린다. 그런데 `src`로
 * 페이지를 띄우면 **저장 전 내용**을 볼 수 없다. 그래서 빈 iframe을 만들고
 * `createPortal`로 부모의 React 트리를 그 안에 심는다 — 상태가 부모에 있으므로
 * 타이핑과 동시에 갱신되고, 폭은 진짜 뷰포트다.
 *
 * ## 스타일 복제
 *
 * iframe 문서는 부모의 스타일시트를 상속하지 않는다. `<style>`·`<link>`를
 * 복제해 넣고, 개발 중 HMR이 스타일을 갈아끼우면 `MutationObserver`가 따라간다.
 * 이게 없으면 파일을 고칠 때마다 미리보기만 민무늬가 된다.
 *
 * ## 폭에 맞춰 축소한다 (노트북 대응)
 *
 * iframe은 선택한 뷰포트 폭(`width`, 예 1280)으로 렌더링해야 브레이크포인트가
 * 제대로 걸린다. 그런데 노트북에서는 미리보기 칸이 그보다 좁아 **가로로 잘린다.**
 * 그래서 iframe의 **내부 뷰포트는 `width` 그대로 두고**(=미디어 쿼리 유지),
 * 담는 칸의 실제 폭을 재서 `transform: scale`로 화면에서만 줄인다. 전체 폭
 * 레이아웃이 잘리지 않고 한눈에 들어온다. 칸이 `width`보다 넓으면 확대는 하지
 * 않는다(`min(1, …)`).
 */
export function PreviewFrame({
  width, height = 720, title, children,
}: {
  width: number
  height?: number
  title: string
  children: ReactNode
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState<HTMLElement | null>(null)
  const [scale, setScale] = useState(1)

  // 담는 칸의 실제 폭을 재서 축소 비율을 정한다. 칸이 좁아지면 따라 줄인다.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setScale(Math.min(1, el.clientWidth / width))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])

  useEffect(() => {
    const frame = ref.current
    if (!frame) return

    let observer: MutationObserver | null = null

    const sync = (doc: Document) => {
      const styles = document.head.querySelectorAll('style, link[rel="stylesheet"]')
      doc.head.replaceChildren(...Array.from(styles, (n) => n.cloneNode(true)))
    }

    const attach = () => {
      const doc = frame.contentDocument
      if (!doc) return
      sync(doc)
      // 폰트 변수(`--font-geist-sans`)는 html 요소의 class에 실려 있다
      doc.documentElement.className = document.documentElement.className
      doc.documentElement.lang = 'ko'
      doc.body.className = 'bg-white text-neutral-900'
      doc.body.style.margin = '0'
      setBody(doc.body)

      observer?.disconnect()
      observer = new MutationObserver(() => sync(doc))
      observer.observe(document.head, { childList: true, subtree: true })
    }

    // 브라우저에 따라 about:blank 문서가 이미 준비돼 있기도, load를 기다려야 하기도 한다
    attach()
    frame.addEventListener('load', attach)
    return () => {
      frame.removeEventListener('load', attach)
      observer?.disconnect()
    }
  }, [])

  return (
    // 바깥 칸: 실제 가용 폭을 잰다. 안쪽은 축소된 크기만큼만 자리를 차지하게 해
    // (transform은 레이아웃 박스를 안 줄이므로) 빈 공간·불필요한 스크롤을 없앤다.
    <div ref={wrapRef} className="w-full">
      <div
        style={{ width: width * scale, height: height * scale }}
        className="overflow-hidden"
      >
        <iframe
          ref={ref}
          title={title}
          width={width}
          height={height}
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
          className="block shrink-0 rounded-xl border border-neutral-300 bg-white"
        >
          {body && createPortal(children, body)}
        </iframe>
      </div>
    </div>
  )
}
