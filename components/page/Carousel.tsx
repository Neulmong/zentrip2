'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 가로 스와이프 카루셀 (인스타그램식) — **데스크톱에서도 넘길 수 있게 한다.**
 *
 * 원래는 `overflow-x-auto`만 걸려 있었는데 스크롤바를 숨겨서, 터치·트랙패드가 없는
 * 마우스 환경(노트북 외장 마우스 포함)에서는 **어떤 방식으로도 넘길 수 없었다.**
 * 그래서 세 경로를 모두 연다:
 *   1. 좌·우 화살표 버튼 — 마우스 클릭으로 한 칸씩 (스크롤 여지가 있을 때만 보인다)
 *   2. 드래그 스크롤 — 카드를 잡고 끌어 넘긴다(pointer)
 *   3. 터치 스와이프·스냅 — 원래 동작 그대로 유지
 *
 * 서버 렌더 페이지 안의 작은 클라이언트 섬이다(§16.3 — 데이터는 안 만진다).
 */
export function Carousel({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState(false)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setCanScroll(max > 4)
    setAtStart(el.scrollLeft <= 2)
    setAtEnd(el.scrollLeft >= max - 2)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [update])

  const nudge = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const amount = Math.max(el.clientWidth * 0.8, 260)
    el.scrollBy({ left: dir * amount, behavior: 'smooth' })
  }

  /* ── 드래그 스크롤 (pointer) ──────────────────────────────────
   * 끌기 시작한 뒤 움직였으면 카드 위 링크의 클릭을 한 번 삼킨다 —
   * 끌어서 넘겼는데 카드가 눌리는 오작동을 막는다. */
  const drag = useRef({ down: false, startX: 0, startLeft: 0, moved: false })

  const onPointerDown = (e: React.PointerEvent) => {
    // 터치는 브라우저 기본 스와이프가 더 낫다 — 마우스/펜만 가로챈다
    if (e.pointerType === 'touch') return
    const el = ref.current
    if (!el) return
    drag.current = { down: true, startX: e.clientX, startLeft: el.scrollLeft, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el || !drag.current.down) return
    const dx = e.clientX - drag.current.startX
    if (Math.abs(dx) > 3) drag.current.moved = true
    el.scrollLeft = drag.current.startLeft - dx
  }
  const endDrag = () => {
    if (drag.current.down) drag.current = { ...drag.current, down: false }
  }
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.preventDefault()
      e.stopPropagation()
      drag.current.moved = false
    }
  }

  return (
    <div className="group relative">
      <div
        ref={ref}
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={onClickCapture}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      {canScroll && !atStart && (
        <button
          type="button" aria-label="이전" onClick={() => nudge(-1)}
          className="absolute left-1 top-[38%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-black/[0.06] bg-white/95 text-neutral-800 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.35)] backdrop-blur transition hover:bg-white sm:flex"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
      )}
      {canScroll && !atEnd && (
        <button
          type="button" aria-label="다음" onClick={() => nudge(1)}
          className="absolute right-1 top-[38%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-black/[0.06] bg-white/95 text-neutral-800 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.35)] backdrop-blur transition hover:bg-white sm:flex"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      )}
    </div>
  )
}
