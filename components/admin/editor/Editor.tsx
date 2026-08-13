'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PageRenderer } from '@/components/page/PageRenderer'
import type { PageImage } from '@/components/page/types'
import type { PageContent, PageSection } from '@/lib/pipeline/page'
import {
  BLOCK_PREFIX, BLOCK_SPEC, BLOCK_TYPES, emptyBlock, isBlock, moveSection, renumber,
  type BlockType,
} from '@/lib/edit-contract'
import type { ProductStatus } from '@/lib/types'
import { SectionForm } from './SectionForm'
import { PreviewFrame } from './PreviewFrame'

/**
 * 편집기 (§10.1) — 좌측 섹션 목록 + 중앙 편집 패널 + 우측 실시간 미리보기.
 *
 * ## 저장 전에는 아무것도 서버에 보내지 않는다
 *
 * 자동 저장이 없다. 매 타이핑마다 `PATCH`를 보내면 `edit_history`에 글자 단위
 * 이력이 쌓이고(§10.3 5항), `draft → reviewing` 전이가 첫 글자에 일어난다.
 * 저장은 사람이 [저장]을 누른 시점 한 번이다.
 *
 * ## 미리보기는 공개 페이지와 **같은 컴포넌트**를 쓴다
 *
 * `PageRenderer`는 `/p/{slug}`가 쓰는 것과 같은 파일이다(§9.1). 미리보기 전용
 * 렌더러를 따로 두면 둘이 어긋나는 순간 미리보기의 의미가 사라진다.
 * 신청 폼 자리에는 비활성 안내를 넣는다 — 미리보기에서 신청이 접수되면 안 된다.
 */

const SECTION_LABEL: Record<string, string> = {
  hero: '대표', summary: '개요', itinerary: '일정', accommodation: '숙박',
  flight: '항공', meal: '식사', price: '가격', shop: '제휴상점', apply: '신청',
  free_text: '자유 문단', image: '사진', notice: '안내',
}

const VIEWPORTS = [375, 768, 1280] as const
type Viewport = (typeof VIEWPORTS)[number]

export interface EditorProps {
  productId: string
  eventName: string
  status: ProductStatus
  slug: string | null
  initialContent: PageContent
  images: PageImage[]
  updatedAt: string
}

/** 화면 상단 알림. 저장 결과와 §16.1.1의 동시 편집 안내를 같은 자리에 띄운다. */
type Notice =
  | { kind: 'saved'; text: string }
  | { kind: 'error'; text: string }
  /** 다른 사람이 먼저 저장함 — 편집분을 **지우지 않고** 남긴다(§16.1.1) */
  | { kind: 'stale'; text: string }
  | null

export function Editor(props: EditorProps) {
  const router = useRouter()

  const [content, setContent] = useState<PageContent>(() => ({
    ...props.initialContent,
    sections: renumber(props.initialContent.sections),
  }))
  const [alts, setAlts] = useState<Record<string, string>>(
    () => Object.fromEntries(props.images.map((i) => [i.id, i.alt])),
  )
  const [selected, setSelected] = useState<string>('sec_hero')
  const [viewport, setViewport] = useState<Viewport>(1280)
  const [updatedAt, setUpdatedAt] = useState(props.updatedAt)
  const [slug, setSlug] = useState(props.slug ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)

  const ordered = useMemo(() => renumber(content.sections), [content.sections])
  const current = ordered.find((s) => s.id === selected) ?? ordered[0]

  // 장소 설명(enrichment.요약) 편집 — 일정·숙박·상점 카드에 실제로 보이는 설명이다
  const places = useMemo(() => content.enrichment?.places ?? [], [content.enrichment])
  const placesMode = selected === '__places__'
  const setSummary = (이름: string, 요약: string) =>
    setContent((c) => (c.enrichment
      ? { ...c, enrichment: { ...c.enrichment, places: c.enrichment.places.map((p) => (p.이름 === 이름 ? { ...p, 요약 } : p)) } }
      : c))
  // 이름 → 요약. 섹션 편집 패널이 숙박·상점 행 옆에 설명을 인라인으로 띄우는 데 쓴다
  const summaryByName = useMemo(
    () => Object.fromEntries(places.map((p) => [p.이름, p.요약])) as Record<string, string>,
    [places],
  )
  // 이름 → 장소. 식당·카페 판별(isDining)에 태그·요약이 필요하다
  const enrichMap = useMemo(() => new Map(places.map((p) => [p.이름, p])), [places])
  // shop의 상점들 — 식사 섹션이 식당·카페 설명을 여기서 골라 편집한다
  const shopRows = useMemo(() => {
    const shop = content.sections.find((s) => s.type === 'shop')
    return (Array.isArray(shop?.data.상점들) ? shop.data.상점들 : []) as Record<string, string>[]
  }, [content.sections])

  /** 미리보기는 대체 텍스트도 즉시 반영한다 — 접근성 확인이 저장 뒤로 밀리지 않게. */
  const previewImages = useMemo(
    () => props.images.map((i) => ({ ...i, alt: alts[i.id] ?? i.alt })),
    [props.images, alts],
  )

  const canEditSlug = props.status === 'draft' || props.status === 'reviewing'

  /* ── 섹션 조작 ─────────────────────────────────────────────── */

  const replace = (id: string, patch: Partial<PageSection>) =>
    setContent((c) => ({ ...c, sections: c.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))

  const insertBlock = (type: BlockType) => {
    const id = `${BLOCK_PREFIX}${crypto.randomUUID().slice(0, 8)}`
    const block = emptyBlock(type, id)
    setContent((c) => {
      const list = renumber(c.sections)
      const applyAt = list.findIndex((s) => s.id === 'sec_apply')
      // 삽입 위치는 hero와 apply **사이**뿐이다(§10.2). 항상 apply 바로 앞에 넣는다.
      const at = applyAt < 0 ? list.length : applyAt
      return { ...c, sections: renumber([...list.slice(0, at), block, ...list.slice(at)]) }
    })
    setSelected(id)
  }

  const removeBlock = (id: string) => {
    setContent((c) => ({ ...c, sections: renumber(c.sections.filter((s) => s.id !== id)) }))
    setSelected('sec_hero')
  }

  const move = (id: string, dir: -1 | 1) =>
    setContent((c) => ({ ...c, sections: moveSection(c.sections, id, dir) }))

  /* ── 저장 ──────────────────────────────────────────────────── */

  const dirtyAlts = useMemo(() => {
    const out: Record<string, string> = {}
    for (const im of props.images) if ((alts[im.id] ?? '') !== im.alt) out[im.id] = alts[im.id] ?? ''
    return out
  }, [alts, props.images])

  async function save() {
    setBusy(true)
    setErrors({})
    setNotice(null)

    let res: Response
    try {
      res = await fetch(`/api/products/${props.productId}/content`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          updated_at: updatedAt,
          page_content: { ...content, sections: ordered },
          ...(Object.keys(dirtyAlts).length > 0 ? { image_alts: dirtyAlts } : {}),
        }),
      })
    } catch {
      setBusy(false)
      setNotice({ kind: 'error', text: '네트워크 오류가 발생했습니다. 다시 시도해 주세요.' })
      return
    }

    const body = await res.json().catch(() => ({}))
    setBusy(false)

    if (res.ok) {
      setUpdatedAt(String(body.updated_at ?? updatedAt))
      setNotice({
        kind: 'saved',
        text: body.edited > 0
          ? `저장했습니다. 섹션 ${body.edited}건이 바뀌었습니다.${body.alt_warning ? ` (${body.alt_warning})` : ''}`
          : '바뀐 내용이 없습니다.',
      })
      // 상태 배지(draft → reviewing)와 목록의 버튼 구성이 달라진다(§15.1)
      router.refresh()
      return
    }

    if (res.status === 400) {
      setErrors(body.field_errors ?? {})
      setNotice({ kind: 'error', text: '저장하지 않았습니다. 아래 항목을 고쳐 주세요.' })
      return
    }

    if (res.status === 409 && body.reason === 'stale') {
      /*
       * §16.1.1 — 「다른 사람이 먼저 저장했습니다」를 표시하고 다시 읽는다.
       * **편집분을 자동으로 덮어쓰지 않는다.** 지금 화면의 값은 그대로 두어
       * 사용자가 복사할 수 있게 하고, 불러오기는 명시적 조작으로 남긴다.
       */
      setNotice({
        kind: 'stale',
        text: '다른 사람이 먼저 저장했습니다. 지금 화면의 내용은 그대로 두었으니 필요한 부분을 복사한 뒤 최신 내용을 불러오세요.',
      })
      return
    }

    if (res.status === 409) {
      setNotice({ kind: 'stale', text: body.detail ?? '지금은 저장할 수 없는 상태입니다. 최신 내용을 불러오세요.' })
      return
    }

    setNotice({ kind: 'error', text: body.message ?? `저장에 실패했습니다 (${res.status}).` })
  }

  async function saveSlug() {
    setBusy(true)
    setErrors({})
    setNotice(null)

    const res = await fetch(`/api/products/${props.productId}/slug`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, updated_at: updatedAt }),
    }).catch(() => null)

    setBusy(false)
    if (!res) { setNotice({ kind: 'error', text: '네트워크 오류가 발생했습니다.' }); return }

    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      setUpdatedAt(String(body.updated_at ?? updatedAt))
      setNotice({ kind: 'saved', text: `주소를 /p/${body.slug} 로 저장했습니다.` })
      router.refresh()
      return
    }
    if (res.status === 400) { setErrors(body.field_errors ?? {}); return }
    if (body.reason === 'slug_conflict') {
      setErrors({ slug: '이미 쓰이고 있는 주소입니다. 다른 주소를 입력해 주세요.' })
      return
    }
    if (body.reason === 'stale') {
      setNotice({ kind: 'stale', text: '다른 사람이 먼저 저장했습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.' })
      return
    }
    setNotice({ kind: 'error', text: body.detail ?? '주소를 저장하지 못했습니다.' })
  }

  /* ── 화면 ──────────────────────────────────────────────────── */

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-200 px-5 py-3">
        <Link href={`/admin/products/${props.productId}`}
          className="text-sm text-neutral-500 hover:text-neutral-900">← 상세</Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{props.eventName}</h1>

        <div className="flex items-center gap-1 rounded-lg bg-neutral-100 p-0.5">
          {VIEWPORTS.map((w) => (
            <button
              key={w} type="button" onClick={() => setViewport(w)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                w === viewport ? 'bg-white font-medium text-neutral-900 shadow-sm' : 'text-neutral-600'
              }`}
            >{w}</button>
          ))}
        </div>

        <button
          type="button" onClick={save} disabled={busy}
          className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white
                     disabled:opacity-40"
        >{busy ? '저장 중…' : '저장'}</button>
      </header>

      {/*
        * §15.2 — 「`published` 상태에서의 편집은 즉시 공개 페이지에 반영된다.
        * 게시본/작업본 분리(스테이징)는 도입하지 않으며, 편집기 상단에 경고를 표시한다.」
        * 스테이징이 없으므로 이 한 줄이 유일한 안전장치다.
        */}
      {props.status === 'published' && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">
          이 상품은 현재 게시 중입니다 — 저장 시 즉시 반영됩니다.
          {slug && (
            <a
              href={`/p/${slug}`} target="_blank" rel="noreferrer"
              className="ml-3 font-medium underline"
            >공개 페이지 보기</a>
          )}
        </div>
      )}

      {notice && (
        <div className={`shrink-0 border-b px-5 py-2 text-sm ${
          notice.kind === 'saved' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : notice.kind === 'stale' ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-red-200 bg-red-50 text-red-900'
        }`}>
          <span>{notice.text}</span>
          {notice.kind === 'stale' && (
            <button
              type="button" onClick={() => window.location.reload()}
              className="ml-3 font-medium underline"
            >최신 내용 불러오기</button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── 좌: 섹션 목록 ─────────────────────────────────── */}
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-neutral-200 p-3">
          <ul className="space-y-0.5">
            {ordered.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button" onClick={() => setSelected(s.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                    s.id === current?.id ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'
                  }`}
                >
                  <span className="w-4 shrink-0 text-xs opacity-70">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {SECTION_LABEL[s.type] ?? s.type}
                    {isBlock(s) && <span className="ml-1 text-xs opacity-70">추가</span>}
                  </span>
                  {s.visible === false && <span className="text-xs opacity-70">숨김</span>}
                  {s.locked && <span className="text-xs opacity-70">고정</span>}
                </button>
              </li>
            ))}
          </ul>

          {/* 장소 설명(웹 검색) — 일정·숙박·상점 카드에 보이는 설명. enrichment가 있을 때만 */}
          {places.length > 0 && (
            <div className="mt-4 border-t border-neutral-200 pt-3">
              <button
                type="button" onClick={() => setSelected('__places__')}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  placesMode ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">장소 설명</span>
                <span className="text-xs opacity-70">{places.length}곳</span>
              </button>
            </div>
          )}

          <div className="mt-4 border-t border-neutral-200 pt-3">
            <p className="mb-2 text-xs font-medium text-neutral-500">블록 삽입</p>
            <div className="flex flex-wrap gap-1.5">
              {BLOCK_TYPES.map((t) => (
                <button
                  key={t} type="button" onClick={() => insertBlock(t)}
                  className="rounded-md bg-neutral-100 px-2 py-1 text-xs hover:bg-neutral-200"
                >+ {BLOCK_SPEC[t].label}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              대표와 신청 사이에만 들어갑니다. 삽입한 블록은 검증 대상이 아닙니다(§10.2).
            </p>
          </div>
        </nav>

        {/* ── 중앙: 편집 패널 ───────────────────────────────── */}
        <div className="min-w-0 flex-1 overflow-y-auto border-r border-neutral-200 p-5">
          {/* 장소 설명 편집 — 일정·숙박·상점 카드에 실제로 보이는 웹 검색 설명 */}
          {placesMode && (
            <div>
              <h2 className="text-base font-semibold">장소 설명</h2>
              <p className="mb-4 mt-1 text-xs text-neutral-500">
                일정·숙박·제휴상점 카드에 보이는 설명입니다. 이름·출처는 그대로 두고 설명만 고칩니다.
              </p>
              <ul className="space-y-4">
                {places.map((pl) => (
                  <li key={pl.이름} className="rounded-lg border border-neutral-200 p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold">{pl.이름}</p>
                      {pl.출처[0] && (
                        <a href={pl.출처[0].uri} target="_blank" rel="noreferrer"
                          className="shrink-0 truncate text-xs text-neutral-400 underline">출처</a>
                      )}
                    </div>
                    <textarea
                      value={pl.요약}
                      onChange={(e) => setSummary(pl.이름, e.target.value)}
                      rows={3}
                      className="w-full resize-y rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm leading-relaxed focus:border-neutral-900 focus:outline-none"
                    />
                    <p className="mt-1 text-right text-[11px] text-neutral-400">{pl.요약.length}자</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!placesMode && current && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-base font-semibold">
                  {SECTION_LABEL[current.type] ?? current.type}
                </h2>

                {!current.locked && (
                  <>
                    <button type="button" onClick={() => move(current.id, -1)}
                      className={btnClass}>위로</button>
                    <button type="button" onClick={() => move(current.id, 1)}
                      className={btnClass}>아래로</button>
                    {isBlock(current) ? (
                      <button type="button" onClick={() => removeBlock(current.id)}
                        className={`${btnClass} text-red-700`}>삭제</button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => replace(current.id, { visible: current.visible === false })}
                        className={btnClass}
                      >{current.visible === false ? '표시' : '숨김'}</button>
                    )}
                  </>
                )}
              </div>

              {current.locked && (
                <p className="mb-4 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                  이 섹션은 삭제하거나 순서를 바꿀 수 없습니다(§10.2).
                </p>
              )}

              <SectionForm
                section={current}
                images={props.images}
                errors={errors}
                onChange={(data) => replace(current.id, { data })}
                enrichSummaries={summaryByName}
                onSummaryChange={setSummary}
                enrich={enrichMap}
                shopRows={shopRows}
              />
            </>
          )}

          {/* 주소 — draft / reviewing 에서만 (§12.1) */}
          <section className="mt-8 border-t border-neutral-200 pt-5">
            <h3 className="text-sm font-semibold">공개 주소</h3>
            {canEditSlug ? (
              <>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-neutral-500">/p/</span>
                  <input
                    type="text" value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2
                               font-mono text-sm focus:border-neutral-900 focus:outline-none"
                  />
                  <button type="button" onClick={saveSlug} disabled={busy} className={btnClass}>
                    주소 저장
                  </button>
                </div>
                {errors.slug && <p className="mt-1 text-xs text-red-700">{errors.slug}</p>}
                <p className="mt-1 text-xs text-neutral-500">
                  영문 소문자·숫자·하이픈만. 게시하면 더 이상 바꿀 수 없습니다(§12.1).
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-neutral-600">
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">/p/{slug}</code>
                <span className="ml-2 text-xs text-neutral-500">게시 후에는 변경할 수 없습니다.</span>
              </p>
            )}
          </section>

          {/* 대체 텍스트 — §10.2 편집 범위 · §17.2 접근성 */}
          {props.images.length > 0 && (
            <section className="mt-8 border-t border-neutral-200 pt-5">
              <h3 className="text-sm font-semibold">사진 대체 텍스트</h3>
              <p className="mt-1 text-xs text-neutral-500">
                화면을 읽어 주는 도구가 사진 대신 읽는 문장입니다. 비울 수 없습니다(§17.2).
              </p>
              <ul className="mt-3 space-y-2">
                {props.images.map((im) => (
                  <li key={im.id} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-xs text-neutral-500">{im.slot}</span>
                    <input
                      type="text" value={alts[im.id] ?? ''}
                      onChange={(e) => setAlts((a) => ({ ...a, [im.id]: e.target.value }))}
                      className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm
                                 focus:border-neutral-900 focus:outline-none"
                    />
                  </li>
                ))}
              </ul>
              {Object.entries(errors).filter(([k]) => k.startsWith('alt.')).map(([k, v]) => (
                <p key={k} className="mt-1 text-xs text-red-700">{v}</p>
              ))}
            </section>
          )}

          {errors._ && <p className="mt-4 text-sm text-red-700">{errors._}</p>}
        </div>

        {/* ── 우: 실시간 미리보기 ───────────────────────────── */}
        <div className="shrink-0 overflow-auto bg-neutral-100 p-4">
          <PreviewFrame width={viewport} height={860} title={`미리보기 ${viewport}px`}>
            <PageRenderer
              content={{ ...content, sections: ordered }}
              images={previewImages}
              applyForm={
                <p className="rounded-xl border border-dashed border-[var(--t-primary)] px-4 py-6
                              text-center text-sm">
                  신청 폼 자리 — 게시된 페이지에서만 접수됩니다
                </p>
              }
            />
          </PreviewFrame>
        </div>
      </div>
    </div>
  )
}

const btnClass =
  'rounded-lg border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40'
