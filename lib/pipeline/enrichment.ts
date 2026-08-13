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
  종류: '숙소' | '상점'
}

/**
 * 확정 데이터에서 검색할 장소 목록을 뽑는다. 숙소·상점 이름과 위치만 — 검색에
 * 필요한 최소값이다. 사람이 입력한 값이므로 이 목록 자체가 실존 기준이다.
 */
export function placesFor(cd: ConfirmedData): EnrichTarget[] {
  const out: EnrichTarget[] = []
  for (const s of cd.숙박) {
    if (s.숙소명?.trim()) out.push({ 이름: s.숙소명.trim(), 위치: s.위치 ?? '', 종류: '숙소' })
  }
  for (const s of cd.상점) {
    if (s.상점명?.trim()) out.push({ 이름: s.상점명.trim(), 위치: s.위치 ?? '', 종류: '상점' })
  }
  return out
}

/** 검색 대상이 하나도 없으면 보강할 것이 없다 */
export function hasEnrichTargets(cd: ConfirmedData): boolean {
  return placesFor(cd).length > 0
}

/**
 * 구조화 결과 + 검색 출처 → `Enrichment`. **실존 대조가 여기서 일어난다.**
 *
 * 각 장소의 `출처번호`가 실제 `sources`를 가리켜야 남긴다 — 하나도 못 가리키면
 * 그 장소는 근거 없는 서술이므로 버린다(§8.8). 번호가 범위를 벗어나면 무시한다.
 * 요약·태그는 상한으로 자르고, 사람이 입력한 실제 장소 이름과 매칭되는 것만 남긴다.
 */
export function assembleEnrichment(
  struct: EnrichmentStructureResult,
  sources: GroundingSource[],
  targets: EnrichTarget[],
): Enrichment {
  const 실제이름 = new Set(targets.map((t) => t.이름))
  const places: EnrichmentPlace[] = []

  for (const raw of struct.places ?? []) {
    const 이름 = (raw.이름 ?? '').trim()
    // 사람이 입력하지 않은 장소는 만들지 않는다 (§16.1)
    if (!실제이름.has(이름)) continue

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
    // 출처 없는 서술은 버린다 — 실존 대조 실패
    if (출처.length === 0) continue

    const 태그 = (raw.태그 ?? [])
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, ENRICH_TAGS_MAX)

    places.push({ 이름, 요약, 태그, 출처 })
  }

  return { places, 생성_라벨: '웹 검색 기반 · 출처 표기' }
}
