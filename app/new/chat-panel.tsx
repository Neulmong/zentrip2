'use client'

import { useRef, useState } from 'react'

/**
 * Task 1 — AI 역질문 챗봇 패널.
 *
 * `FreeformPanel`(붙여넣기)의 대화형 형제다. 기획자가 핵심 키워드만 던지면 AI가
 * 부족한 정보를 한 번에 하나씩 되묻고(multi-turn), 충분해지면 메모를 합성한다.
 * 그 메모가 `onReady`로 넘어가 **기존 자연어 초안 경로**(`fillFromText` →
 * `/api/plan-draft`)를 그대로 태우고 폼을 채운다 — 확정은 사람이 폼에서 한다.
 *
 * **대화 상태는 이 컴포넌트가 쥔다.** 서버는 무상태이므로 매 요청에 전체 이력을
 * 실어 보낸다(1요청 1AI · 서버 루프 없음).
 */

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const GREETING = '어떤 여행 상품을 만들고 싶으세요? 여행지와 대략의 일정부터 편하게 적어 주세요. 부족한 부분은 제가 여쭤볼게요.'

export function ChatPanel({
  busy, onReady,
}: {
  /** 초안이 폼을 채우는 중인지 (fillFromText 진행) */
  busy: boolean
  onReady: (memo: string) => Promise<void> | void
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function send() {
    const text = input.trim()
    if (!text || sending || busy) return

    const next: Msg[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setSending(true)
    setError(null)

    try {
      const res = await fetch('/api/plan-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const body = await res.json().catch(() => ({}))

      if (res.status === 409) {
        // AI 실패 — 방금 보낸 발화를 되돌려 다시 보낼 수 있게 한다(§4.2 재호출)
        setMessages(messages)
        setInput(text)
        setError('응답이 지연됐습니다. 다시 보내 주세요.')
        return
      }
      if (!res.ok) {
        setError(body.field_errors?.messages ?? '대화를 이어가지 못했습니다.')
        return
      }

      setMessages([...next, { role: 'assistant', content: body.message ?? '' }])
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 9e9, behavior: 'smooth' }))

      if (body.mode === 'ready' && typeof body.memo === 'string' && body.memo.trim()) {
        setReady(true)
        await onReady(body.memo)
      }
    } catch {
      setMessages(messages)
      setInput(text)
      setError('네트워크 오류가 발생했습니다. 다시 시도해 주세요.')
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter 전송, Shift+Enter는 쓰지 않는다(단일 줄 입력)
    if (e.key === 'Enter') { e.preventDefault(); send() }
  }

  return (
    <div className="space-y-3">
      <div
        ref={scrollRef}
        className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3"
      >
        {/* UI 전용 인사 — 대화 이력(messages)에는 넣지 않는다(서버는 사용자 발화부터 본다) */}
        <Bubble role="assistant" text={GREETING} />
        {messages.map((m, i) => <Bubble key={i} role={m.role} text={m.content} />)}
        {sending && <Bubble role="assistant" text="…" pulse />}
      </div>

      {ready ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          대화 내용으로 아래 폼을 채웠습니다. 검토·수정한 뒤 [소개서 생성]을 눌러 주세요.
          더 다듬고 싶으면 이어서 말씀하셔도 됩니다.
        </p>
      ) : (
        <p className="text-xs text-neutral-500">
          여행지·날짜·넣고 싶은 장소를 편하게 적어 주세요. AI가 부족한 것만 하나씩 여쭤봅니다.
        </p>
      )}

      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          maxLength={1000}
          placeholder="예: 제주로 3박4일 감성 커플여행 가려고 해요"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none
                     focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || busy || input.trim().length === 0}
          className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white
                     transition hover:bg-neutral-800 disabled:opacity-40"
        >
          {sending ? '…' : busy ? '채우는 중' : '보내기'}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </div>
  )
}

function Bubble({ role, text, pulse }: { role: 'user' | 'assistant'; text: string; pulse?: boolean }) {
  const mine = role === 'user'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] whitespace-pre-line break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          mine
            ? 'bg-neutral-900 text-white'
            : `bg-neutral-100 text-neutral-800 ${pulse ? 'animate-pulse' : ''}`}`}
      >
        {text}
      </div>
    </div>
  )
}
