'use client'

import { useState } from 'react'

/**
 * §7.5 — 폼 위의 자연어 입력 패널.
 *
 * 기획자는 폼 순서대로 생각하지 않는다. 축제 날짜, 가고 싶은 가게 목록, 숙소
 * 두 곳, 페르소나를 메모로 적어 놓고 시작한다. 그 메모를 그대로 붙여넣으면
 * `POST /api/plan-draft`(#20)가 폼 초안을 만들어 **아래 칸들을 채운다.**
 *
 * **확정은 이 패널이 하지 않는다.** 채워진 값은 사람이 검토·수정하고,
 * [소개서 생성]을 누르는 순간에만 §7.1 검증을 거쳐 `form_input`이 된다.
 * 그래서 이 패널에는 「제출」이 없고 「폼 채우기」만 있다.
 */

const PLACEHOLDER = `-여행일정: 4박5일 (11.04~11.08)
-여행주제: 제주걷기와 로컬 맛집·카페에서의 휴식
-행사: 제주올레걷기축제 (11.05~11.07)
-숙박:
 조금불편해도괜찮아 (구좌읍 김녕로1길 35-24)
 고요한하루 (북선로 241)
-카페 및 음식점:
 시간을담다 (구좌읍 평대7길)
 마레1440 (구좌읍 해맞이해안로 1440)
-여행지 포인트
 함덕해수욕장
 닭머르 (노을뷰)`

export interface DraftNotes {
  누락: { 이름: string; 주소: string }[]
  필수미입력: Record<string, string>
  날짜미정: boolean
}

export function FreeformPanel({
  busy, notes, onFill,
}: {
  busy: boolean
  /** 마지막 초안의 판정. 없으면 아직 안 돌렸다 */
  notes: DraftNotes | null
  onFill: (text: string) => Promise<void>
}) {
  // 기본으로 펼쳐 둔다 — 빈 폼을 처음부터 손으로 채우는 대신, 메모를 붙여넣어
  // 폼을 채우는 경로가 「첫 화면」이 되게 한다(Task 1 — 입력 수고 최소화).
  const [open, setOpen] = useState(true)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function fill() {
    setError(null)
    try {
      await onFill(text)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="mb-5 rounded-xl border border-neutral-900/15 bg-neutral-50/70 p-5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <span className="text-sm font-semibold text-neutral-900">자연어로 입력</span>
          <span className="ml-2 rounded bg-neutral-900 px-1.5 py-0.5 text-[11px]
                           font-medium text-white">AI 1회</span>
          <span className="mt-1 block text-xs text-neutral-600">
            메모를 붙여넣으면 AI가 일정을 배분해 아래 폼을 채웁니다. 값은 그대로 확정되지 않고,
            검토·수정한 뒤 [소개서 생성]을 누를 때 확정됩니다.
          </span>
        </span>
        <span className="ml-3 shrink-0 text-xs text-neutral-500">{open ? '접기' : '열기'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            maxLength={4000}
            placeholder={PLACEHOLDER}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2
                       font-mono text-[13px] leading-relaxed outline-none
                       focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={fill}
              disabled={busy || text.trim().length < 20}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white
                         transition hover:bg-neutral-800 disabled:opacity-40"
            >
              {busy ? '기획 중…' : notes ? '다시 채우기' : '폼 채우기'}
            </button>
            <span className="text-xs text-neutral-500">{text.trim().length} / 4000</span>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          {/*
            누락 목록 (§7.5 ②) — 추출된 장소 중 초안에 안 들어간 것.
            기계가 판정하므로 AI에게 되묻지 않는다. 사람이 보고 [다시 채우기]를
            누르거나 직접 입력한다.
          */}
          {notes && notes.누락.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-medium">
                초안에 들어가지 않은 장소 {notes.누락.length}곳
              </p>
              <ul className="mt-1 list-inside list-disc leading-relaxed">
                {notes.누락.map((c) => (
                  <li key={c.이름}>{c.이름}{c.주소 ? ` (${c.주소})` : ''}</li>
                ))}
              </ul>
              <p className="mt-1">
                [다시 채우기]를 누르거나 일정·상점 칸에 직접 넣어 주세요.
              </p>
            </div>
          )}

          {notes && notes.누락.length === 0 && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              메모에서 찾은 장소가 모두 초안에 들어갔습니다.
            </p>
          )}

          {notes?.날짜미정 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              메모에 연도가 없어 여행기간을 읽지 못했습니다. 아래에서 시작일·종료일을 고른 뒤
              [다시 채우기]를 누르면 그 날짜로 일정을 다시 배분합니다.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
