/**
 * place-enrichment (Task 2) — **순수 모듈**.
 *
 * 그라운딩 웹 검색으로 얻은 실제 장소 정보를 `page_content.enrichment`에 담는다.
 * 반환각 보장은 유지된다: 값은 **실제 검색 출처(URL)에 근거**해야 하고, 근거 없는
 * 장소는 조립 단계에서 버린다(§8.8 — 출처 없는 사실정보는 실패).
 *
 * ## 상태 기계 밖이다
 *
 * `plan-draft`(§7.5)처럼 파이프라인 상태 전이·검증 4축 밖의 **선택 보강**이다.
 * `page_content`에 별도 키로 얹으므로 `checkPage`(sections만 순회)·편집 계약을
 * 건드리지 않는다. 실패해도 기존 페이지는 그대로다.
 *
 * ## 사실을 새로 쓰지 않는다
 *
 * 구조화 AI는 검색 텍스트를 **요약**할 뿐 주소·가격 같은 사실을 창작하지 않는다.
 * 각 장소는 출처 번호로 실제 검색 출처를 가리켜야 하고, 그 대조를 여기 기계가 한다.
 */
import type { ConfirmedData } from './normalize'
import type { GroundingSource } from '@/lib/ai'
import type { EnrichmentStructureResult } from './ai-contracts'

export interface EnrichmentSource {
  title: string
  uri: string
}

export interface EnrichmentPlace {
  이름: string
  /** 검색 텍스트 기반 요약 (리뷰·특징). 출처가 뒷받침한다 */
  요약: string
  태그: string[]
  /** 실제 인용 출처. 최소 1건 — 없으면 이 장소는 조립되지 않는다 */
  출처: EnrichmentSource[]
}

export interface Enrichment {
  places: EnrichmentPlace[]
  /** 고객 화면에 붙는 출처 표기 라벨 (§Task 2 — 출처 태깅) */
  생성_라벨: string
}

/** 요약·태그 상한 — 과장·나열을 막는다 */
export const ENRICH_SUMMARY_MAX = 400
export const ENRICH_TAGS_MAX = 4

/** 검색 대상 장소 1건 */
export interface EnrichTarget {
  이름: string
  위치: string
  종류: '숙소' | '상점' | '여행지'
}

/** 검색 대상 상한 — 그라운딩 지연이 55초 예산 안에 들도록 (실측 15곳 ≈ 30초) */
export const ENRICH_TARGETS_MAX = 22

/**
 * 확정 데이터에서 검색할 장소 목록을 뽑는다. 숙소·상점 + **일정의 여행지 포인트**.
 *
 * 여행지 포인트는 일차별 `핵심표현`(AI가 신고한 장소·시설 명사)에서 온다 — 사람이
 * 준 일정 원문 안의 값이므로 실존 기준을 유지한다. 숙소·상점과 이름이 겹치면
 * 버리고(이미 대상), 활동어가 섞여도 검색이 「정보 없음」으로 걸러 낸다. 총 개수는
 * 상한으로 자른다(지연 보호).
 */
export function placesFor(cd: ConfirmedData): EnrichTarget[] {
  const out: EnrichTarget[] = []
  const seen = new Set<string>()
  const add = (이름: string, 위치: string, 종류: EnrichTarget['종류']) => {
    const key = 이름.trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push({ 이름: key, 위치: 위치 ?? '', 종류 })
  }

  for (const s of cd.숙박) if (s.숙소명?.trim()) add(s.숙소명, s.위치 ?? '', '숙소')
  for (const s of cd.상점) if (s.상점명?.trim()) add(s.상점명, s.위치 ?? '', '상점')
  // 일정의 여행지 포인트 (핵심표현) — 숙소·상점과 겹치는 것은 add가 걸러 낸다
  for (const d of cd.행사정보.일정) {
    for (const 표현 of d.핵심표현 ?? []) add(표현, '', '여행지')
  }

  return out.slice(0, ENRICH_TARGETS_MAX)
}

/** 검색 대상이 하나도 없으면 보강할 것이 없다 */
export function hasEnrichTargets(cd: ConfirmedData): boolean {
  return placesFor(cd).length > 0
}

/**
 * 페이지 생성 시점의 **기본 설명**(Q2 안전장치). 그라운딩이 아직 안 돌았거나
 * 완전히 실패해도 모든 장소에 사실 기반 1~2줄이 보이도록, `placesFor`의 전 장소에
 * `floorSummary`를 깐다. 그라운딩이 성공하면 그 결과가 이 기본을 통째로 덮는다
 * (enrich-structure 라우트가 `page_content.enrichment`를 교체). 출처는 웹 검색
 * 전이므로 정직하게 비운다. 대상이 없으면 빈 places를 돌려준다.
 */
export function baselineEnrichment(cd: ConfirmedData): Enrichment {
  const places: EnrichmentPlace[] = placesFor(cd).map((t) => ({
    이름: t.이름, 요약: floorSummary(t), 태그: [], 출처: [],
  }))
  return { places, 생성_라벨: '기본 소개' }
}

/**
 * 확정 데이터의 종류로 「무엇인가」 한 줄을 만든다 — 그라운딩이 전혀 못 채운
 * 장소의 **바닥 설명**. 사실(위치·종류)만 쓰고 특정 후기·메뉴·가격을 지어내지
 * 않는다(§16.1). 그라운딩 요약이 있으면 그것이 이 바닥을 덮는다.
 */
function floorSummary(t: EnrichTarget): string {
  const 종류말 = t.종류 === '숙소' ? '숙소' : t.종류 === '상점' ? '상점' : '여행지'
  const 위치말 = t.위치.trim() ? `${t.위치.trim()}에 자리한 ` : ''
  return `${위치말}${t.이름}은(는) 이번 여행 일정에 포함된 ${종류말}입니다. `
    + `현지의 분위기를 함께 느끼실 수 있는 곳으로, 방문 시 일정에 맞춰 안내드립니다.`
}

/**
 * 구조화 결과 + 검색 출처 → `Enrichment`. **모든 대상 장소에 설명을 보장한다.**
 *
 * 「무조건 1~2줄 설명」(Q2 · 사용자 결정)을 코드로 강제하는 지점이다. 규칙:
 *
 *   1. 그라운딩 요약이 있으면 그대로 싣는다. 요약은 실제 검색 텍스트 기반이다.
 *   2. AI가 `출처번호`를 못 달아도 요약을 **버리지 않는다** — 이 검색 배치의 실제
 *      전역 출처(최대 2건)를 대신 붙인다. 요약은 같은 검색에서 나온 것이므로
 *      「웹 검색 기반」 표기는 정직하다. (2.8까지는 여기서 버려 카드가 비었다.)
 *   3. AI가 통째로 빠뜨린 장소도 사실 기반 바닥 설명으로 채운다(`floorSummary`).
 *      바닥은 후기가 아니므로 출처를 붙이지 않는다 — 그 자체로 정직하다.
 *
 * 사람이 입력하지 않은 장소는 여전히 만들지 않는다(§16.1). 출력 순서는 `targets`
 * 순서를 따라 일정·숙박·상점 흐름과 어긋나지 않게 한다.
 */
export function assembleEnrichment(
  struct: EnrichmentStructureResult,
  sources: GroundingSource[],
  targets: EnrichTarget[],
): Enrichment {
  const 실제이름 = new Set(targets.map((t) => t.이름))

  // 이 검색 배치의 전역 출처(중복 제거) — 인용을 못 단 요약의 근거로 대체한다
  const 전역출처: EnrichmentSource[] = []
  {
    const seen = new Set<string>()
    for (const s of sources) {
      if (!s?.uri || seen.has(s.uri)) continue
      seen.add(s.uri)
      전역출처.push({ title: s.title || s.uri, uri: s.uri })
      if (전역출처.length >= 2) break
    }
  }

  const byName = new Map<string, EnrichmentPlace>()

  for (const raw of struct.places ?? []) {
    const 이름 = (raw.이름 ?? '').trim()
    // 사람이 입력하지 않은 장소는 만들지 않는다 (§16.1). 중복 이름은 첫 것만
    if (!실제이름.has(이름) || byName.has(이름)) continue

    const 요약 = (raw.요약 ?? '').trim().slice(0, ENRICH_SUMMARY_MAX)
    if (!요약) continue

    // 출처번호 → 실제 출처. 중복·범위 밖은 걸러낸다
    const seen = new Set<string>()
    const 출처: EnrichmentSource[] = []
    for (const n of raw.출처번호 ?? []) {
      const src = sources[n]
      if (!src?.uri || seen.has(src.uri)) continue
      seen.add(src.uri)
      출처.push({ title: src.title || src.uri, uri: src.uri })
    }

    const 태그 = (raw.태그 ?? [])
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, ENRICH_TAGS_MAX)

    // 인용을 못 달았으면 전역 출처로 대체한다 — 실측 설명을 버리지 않는다
    byName.set(이름, { 이름, 요약, 태그, 출처: 출처.length > 0 ? 출처 : 전역출처 })
  }

  // 바닥 보장 — 그라운딩이 통째로 빠뜨린 장소도 빈 카드로 두지 않는다
  for (const t of targets) {
    if (byName.has(t.이름)) continue
    byName.set(t.이름, { 이름: t.이름, 요약: floorSummary(t), 태그: [], 출처: [] })
  }

  // targets 순서를 유지한다 (일정·숙박·상점 흐름과 일치)
  const places = targets.map((t) => byName.get(t.이름)).filter((p): p is EnrichmentPlace => !!p)

  return { places, 생성_라벨: '웹 검색 기반 · 출처 표기' }
}
