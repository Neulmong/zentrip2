'use client'

import type { Phase } from '@/lib/client/run-pipeline'

/**
 * AI 생성 대기 화면 (Task 4 — 스켈레톤 로딩).
 *
 * 파이프라인 한 묶음(소개서 ②③④ · 페이지 ⑤⑥⑦)이 도는 30~60초 동안, 단순
 * 텍스트 진행 표시 대신 **최종 산출물의 뼈대**를 스켈레톤으로 보여 주고 그 위에
 * 단계 스테퍼를 얹는다. 사용자가 「멈춘 게 아니라 만들어지는 중」임을 형태로 읽는다.
 *
 * ## 스트리밍이 아닌 이유 (Task 4 ②의 한계)
 *
 * 스펙은 AI 출력을 `responseSchema`로 강제하고 서버가 통째로 검증한 뒤에야
 * 파이프라인에 넣는다(절대원칙 3). 부분 JSON을 흘려보내는 경로가 없으므로 토큰
 * 스트리밍은 구조와 충돌한다. 대신 **단계가 끝날 때마다 스테퍼가 전진**하고
 * 스켈레톤이 맥동해 실시간으로 채워지는 감각을 준다 — 진행이 살아 있음을 보인다.
 *
 * ## 진행 단계 판정
 *
 * `runPipeline`은 매 단계 `onProgress(label, attempt)`를 부르고, 백오프·재시도는
 * 그 라벨을 **접두어로 유지**한다(`"${label} — 호출 한도로 …"`, `"${label} (재시도 N회)"`).
 * 그래서 현재 진행 문자열이 어느 `phase.label`로 시작하는지로 활성 단계를 찾는다.
 */

function activeIndex(phases: Phase[], progress: string | null): number {
  if (!progress) return 0
  const i = phases.findIndex((p) => progress.startsWith(p.label))
  if (i >= 0) return i
  // 파이프라인 밖 상태("완료 …", "저장 중 …")는 매칭되지 않는다
  if (progress.includes('완료')) return phases.length
  return 0
}

/* ── 스켈레톤 원시 조각 ─────────────────────────────────────────── */

function Bar({ className = '', delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-neutral-200/90 motion-reduce:animate-none ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}

/** 상품 페이지 뼈대 — hero · 개요 · 일정 타임라인 · 카드 그리드 · 가격 */
function PageSkeleton() {
  return (
    <div aria-hidden className="space-y-10">
      {/* hero */}
      <div className="relative aspect-[16/10] w-full animate-pulse overflow-hidden rounded-2xl
                      bg-gradient-to-br from-neutral-200 to-neutral-300 motion-reduce:animate-none">
        <div className="absolute inset-x-0 bottom-0 space-y-3 p-6 md:p-8">
          <Bar className="h-7 w-2/3 bg-neutral-100/80 md:h-9" />
          <Bar className="h-4 w-1/2 bg-neutral-100/70" delay={120} />
        </div>
      </div>

      {/* 개요 */}
      <section className="space-y-4">
        <Bar className="h-5 w-28" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Bar className="h-3 w-16" delay={i * 60} />
              <Bar className="h-4 w-3/4" delay={i * 60 + 40} />
            </div>
          ))}
        </div>
      </section>

      {/* 일정 타임라인 */}
      <section className="space-y-5">
        <Bar className="h-5 w-20" />
        <ol className="space-y-6 border-l-2 border-neutral-200 pl-6">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="relative space-y-2">
              <span className="absolute -left-[1.72rem] top-0.5 size-6 animate-pulse rounded-full
                               bg-neutral-200 motion-reduce:animate-none" style={{ animationDelay: `${i * 90}ms` }} />
              <Bar className="h-4 w-24" delay={i * 90} />
              <Bar className="h-4 w-full" delay={i * 90 + 40} />
              <Bar className="h-4 w-5/6" delay={i * 90 + 80} />
            </li>
          ))}
        </ol>
      </section>

      {/* 카드 그리드 (숙박·상점) */}
      <section className="space-y-5">
        <Bar className="h-5 w-32" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-neutral-200 p-4">
              <Bar className="aspect-[3/2] w-full" delay={i * 100} />
              <Bar className="h-4 w-2/3" delay={i * 100 + 40} />
              <Bar className="h-3 w-1/2" delay={i * 100 + 80} />
            </div>
          ))}
        </div>
      </section>

      {/* 가격 */}
      <section className="space-y-5">
        <Bar className="h-5 w-16" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-neutral-200 px-4 py-3">
              <Bar className="h-3 w-12" delay={i * 80} />
              <Bar className="h-6 w-24" delay={i * 80 + 40} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/** 소개서 뼈대 — 제목 · 여러 섹션(제목 + 본문 줄) */
function DocumentSkeleton() {
  return (
    <div aria-hidden className="space-y-9">
      <div className="space-y-3">
        <Bar className="h-8 w-3/4" />
        <Bar className="h-4 w-1/2" delay={120} />
      </div>
      {Array.from({ length: 5 }, (_, s) => (
        <section key={s} className="space-y-3">
          <Bar className="h-5 w-32" delay={s * 60} />
          <Bar className="h-4 w-full" delay={s * 60 + 40} />
          <Bar className="h-4 w-11/12" delay={s * 60 + 80} />
          <Bar className="h-4 w-4/6" delay={s * 60 + 120} />
        </section>
      ))}
    </div>
  )
}

/* ── 단계 스테퍼 ────────────────────────────────────────────────── */

function StepIcon({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M5 10l3.5 3.5L15 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-900">
        <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white
                         motion-reduce:animate-none" />
      </span>
    )
  }
  return <span className="flex size-6 shrink-0 rounded-full border-2 border-neutral-300" />
}

/**
 * 생성 진행 오버레이. `phases`가 있는 동안만 뜬다 — 호출부가 파이프라인 시작 시
 * 세팅하고 종료 시 `null`로 지운다.
 */
export function GenerationProgress({
  phases, progress, variant, title,
}: {
  phases: Phase[]
  progress: string | null
  variant: 'page' | 'document'
  title: string
}) {
  const active = activeIndex(phases, progress)
  const done = Math.min(active, phases.length)
  const pct = Math.round((done / phases.length) * 100)
  // 활성 단계의 라이브 상태 문구(백오프 카운트다운·재시도 회차 포함)
  const liveNote = progress && active < phases.length && progress !== phases[active]?.label
    ? progress
    : null

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-white/85 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="mx-auto max-w-3xl px-5 py-8 md:py-12">
        {/* 스테퍼 카드 */}
        <div className="sticky top-4 z-10 mb-8 rounded-2xl border border-neutral-200 bg-white/95
                        p-5 shadow-lg shadow-neutral-900/5 backdrop-blur md:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
            <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-500">
              {done} / {phases.length}
            </span>
          </div>

          {/* 진행 바 */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-neutral-900 transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>

          <ol className="mt-4 space-y-2.5">
            {phases.map((p, i) => {
              const state = i < active ? 'done' : i === active ? 'active' : 'pending'
              return (
                <li key={p.num} className="flex items-center gap-3">
                  <StepIcon state={state} />
                  <span className={`text-sm ${
                    state === 'pending' ? 'text-neutral-400'
                      : state === 'done' ? 'text-neutral-500' : 'font-medium text-neutral-900'}`}>
                    {p.label.replace(/…$/, '')}
                  </span>
                </li>
              )
            })}
          </ol>

          {liveNote && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              {liveNote}
            </p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-neutral-500">
            AI가 입력하신 정보로 {variant === 'page' ? '상품 페이지를' : '소개서를'} 구성하는 중입니다.
            최대 1분가량 걸릴 수 있어요. 이 창을 닫지 말고 잠시만 기다려 주세요.
          </p>
        </div>

        {/* 최종 산출물 뼈대 */}
        {variant === 'page' ? <PageSkeleton /> : <DocumentSkeleton />}
      </div>
    </div>
  )
}
