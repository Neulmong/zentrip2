/**
 * §7.5 자연어 초안의 기계 처리 — **순수 모듈 · AI 0회.**
 *
 * 두 스킬의 구현이 여기 있다.
 *
 *   freeform-parse    → parseFreeform   메모에서 알아볼 수 있는 것만 추출
 *   draft-form-check  → checkDraft      §7.1 검사 + origin 3종 + 누락 목록
 *
 * 둘을 한 파일에 두는 이유: `장소후보`가 앞의 산출물이면서 뒤의 **판정 기준**이다.
 * 두 파일로 나누면 그 목록의 형태가 두 곳에서 정의되고, 어긋나는 순간
 * 누락 검사가 조용히 아무것도 못 잡는다.
 */
import { hasDayMarker, validateFormInput, type FieldErrors } from '../form-validation'
import { normalizeSpace } from './normalize'
import type { FormInput, Shop, Stay } from '../types'
import type { PlanResult } from './ai-contracts'

/* ════════════════════════════════════════════════════════════════
 * freeform-parse
 * ════════════════════════════════════════════════════════════════ */

export interface PlaceCandidate {
  이름: string
  주소: string
  /**
   * 이 후보가 나온 라벨 블록의 이름 (`숙박` · `카페 및 음식점` · `여행지 포인트`).
   *
   * AI에게 분류 신호로 넘긴다 — 「어느 것이 숙소이고 어느 것이 가게인가」를
   * 이름만으로는 알 수 없고, 기획자는 이미 블록으로 분류해 두었다.
   */
  출처: string
}

export interface FreeformParse {
  블록: { 라벨: string; 본문: string }[]
  /** 연도를 읽을 수 있었을 때만 채운다. 추정하지 않는다 */
  날짜: { 시작: string; 종료: string } | null
  일수: number | null
  장소후보: PlaceCandidate[]
  URL: string[]
  /**
   * 라벨로 알아본 서술 필드. **AI를 거치지 않고 블록 본문을 그대로 옮긴다.**
   *
   * 왜 기계가 하나: 이 세 값은 기획자가 이미 문장으로 적어 둔 것이고, AI가 다시
   * 쓰면 (1) 출력 토큰을 먹고 (2) 문장이 바뀐다. 특히 페르소나 문단은 이 초안에서
   * 가장 긴 문자열이라 AI에게 옮기게 하면 예산의 큰 몫을 그것이 차지한다.
   */
  필드: { 여행주제: string; 타겟층: string; 기획메모: string }
  /**
   * 기획자가 **직접 쓴 일차별 일정** (2026-08-13 · 사용자 버그).
   *
   * `일정` 라벨 블록의 본문에 일차 구분(§6.3의 6종)이 있으면 그것을 그대로 담는다.
   * 있으면 `assembleDraft`가 후보를 재배분하지 않고 **이 문장을 일정원문으로 쓴다** —
   * 사람이 이미 짠 일정이 AI 배분보다 정확하기 때문이다(§9 설계). 일차 마커가 없으면
   * (`4박5일`처럼 기간만 적힌 경우) 담지 않는다 — 그때는 후보로 조립한다.
   */
  일정원문: string
}

/* ── 라벨 → 서술 필드 (확정 목록) ─────────────────────────────────
 * 구현에서 임의로 넓히지 않는다. 넓히면 엉뚱한 블록이 기획메모로 들어가고,
 * 기획메모는 고객에게 보이지 않는 필드라 **잘못 들어간 것을 아무도 못 본다.**
 * ──────────────────────────────────────────────────────────────── */
const FIELD_WORDS = {
  기획메모: ['페르소나', '의도', '메모', '컨셉'],
  타겟층: ['타겟', '고객층', '연령'],
  여행주제: ['주제', '테마'],
} as const

/** 텍스트 상한 (§7.5). 4000자를 넘으면 25초 예산을 밀어낸다 */
export const FREEFORM_MIN = 20
export const FREEFORM_MAX = 4000

/**
 * 라벨 줄. 콜론이 있으면 그 앞이 라벨이고, **콜론이 없어도 짧은 줄은 라벨이다.**
 *
 * 뒤쪽 규칙이 없으면 실제 메모의 `-여행지 포인트`(콜론 없음)가 라벨로 인식되지
 * 않고 **앞 블록의 본문에 붙는다.** 그러면 함덕해수욕장·아부오름이 「카페 및
 * 음식점」 출처를 갖게 되고, AI가 그것들을 상점 배열에 넣는다.
 *
 * ## 불릿(`-`)을 **선택**으로 바꿨다 (2026-08-13 · 사용자 버그)
 *
 * 전에는 `[-·*]`가 **필수**였다. 기획자가 플레이스홀더의 대시를 빼고 `숙박:` ·
 * `숙소:` · `카페:`처럼 적으면 라벨로 안 잡혀 그 블록의 항목이 **출처 없이** 흘렀고,
 * 괄호(주소)까지 없으면 후보로 **아예 추출되지 않아** 숙소·상점이 빈 채로 왔다.
 * (`숙박\n롯데호텔 제주` — 대시도 괄호도 없는 형태가 그렇다.)
 *
 * 그래서 불릿을 선택으로 내리되, **불릿이 없을 때는 아는 라벨 낱말일 때만** 라벨로
 * 본다(`isLabelWord`). 불릿이 있으면 지금처럼 아무 낱말이나 라벨이다 — 대시는
 * 기획자가 「이건 라벨」이라고 명시한 신호이기 때문이다. 이 게이트가 없으면
 * `롯데호텔 제주: 좋은 곳` 같은 평범한 콜론 문장이 전부 라벨로 먹힌다.
 */
const LABEL_RE = /^\s*[-·*]?\s*([^:：]{1,20})\s*[:：]\s*(.*)$/
const BARE_LABEL_RE = /^\s*[-·*]?\s*([^:：]{1,20})\s*$/
const BULLET_RE = /^\s*[-·*]/

/* ── 콜론 없는 라벨로 인정하는 낱말 (확정 목록) ───────────────────
 * ⚠️ **이 목록이 없으면 불릿으로 적은 항목이 라벨로 먹힌다.**
 *
 * ```text
 * -카페 및 음식점:
 * - 종달달        ← 콜론이 없고 짧다. 라벨로 오인되면
 * - 공든          ← 이 두 곳이 후보에서 사라지고
 * ```
 * 후보에서 사라지면 **누락 검사가 그 가게를 아예 보지 않는다** — 「누락 0건」이
 * 나오는데 실제로는 두 곳이 없는 상태가 된다. 조용히 사라지는 쪽이 가장 나쁘다.
 *
 * 그래서 콜론 없는 불릿은 **아래 낱말이 들어 있을 때만** 라벨로 본다.
 * 구현에서 임의로 넓히지 않는다 — 넓히면 가게 이름이 라벨로 먹히기 시작한다.
 * ──────────────────────────────────────────────────────────────── */
const BARE_LABEL_WORDS = [
  // 장소 목록 블록
  '숙박', '숙소', '카페', '음식점', '맛집', '식당', '상점', '가게',
  '여행지', '포인트', '장소', '코스', '방문',
  // 서술 필드 블록
  '페르소나', '의도', '메모', '컨셉', '타겟', '고객층', '연령', '주제', '테마',
  // 그 외 메모에 흔한 라벨
  '일정', '기간', '행사', '가격', '요금', '식사', '항공', '교통', '참고', '비고',
] as const
const URL_RE = /https?:\/\/[^\s)>,]+/g

/**
 * `이름 (주소)` 후보. 괄호 앞의 이름은 구분자(쉼표·줄바꿈·불릿)까지만 본다.
 *
 * 괄호 안이 주소인지 설명인지 **판정하지 않는다.** 판정하려면 주소 사전이
 * 필요하고, 틀리면 실재하는 가게가 목록에서 빠진다 — 그 목록이 누락 검사의
 * 기준이므로, 빠진 가게는 「누락 아님」이 되어 조용히 사라진다.
 */
const PLACE_RE = /([^\n,·()]{2,40}?)\s*\(([^()\n]{0,80})\)/g

/* ── 장소 목록 블록 (확정 목록) ───────────────────────────────────
 * 라벨에 아래 낱말이 들어 있으면 그 블록의 **줄 하나가 장소 하나**다.
 *
 * 왜 필요한가: 실제 메모에서 괄호가 빠진 줄이 나온다 —
 * `보롬창고 구좌읍 종달항길3)`. 괄호 규칙만 쓰면 이 가게가 후보에서 빠지고,
 * 후보에서 빠지면 **누락 검사가 그 가게를 보지 않는다.** 「누락 0건」이 나오는데
 * 실제로는 한 곳이 사라져 있는 상태가 가장 나쁘다.
 *
 * 왜 라벨로 좁히는가: 모든 블록의 모든 줄을 후보로 보면 페르소나 문단 한 덩어리가
 * 「장소」가 된다. 이 목록이 판정 기준이므로 구현에서 임의로 넓히지 않는다 —
 * §6.3의 일차 구분 6종과 같은 성격의 확정 목록이다.
 * ──────────────────────────────────────────────────────────────── */
export const PLACE_BLOCK_WORDS = [
  '숙박', '숙소', '카페', '음식점', '맛집', '식당', '상점', '가게',
  '여행지', '포인트', '장소', '코스', '방문',
] as const

/** 목록 줄에서 이름·주소를 가른다. 괄호가 없으면 첫 공백까지를 이름으로 본다 */
function splitPlaceLine(line: string): { 이름: string; 주소: string } | null {
  const t = line.replace(/^[\s\-·*]+/, '').replace(/[\s]+$/, '')
  if (!t) return null

  const paren = /^(.+?)\s*\(([^()]*)\)?\s*$/.exec(t)
  if (paren) return { 이름: paren[1].trim(), 주소: paren[2].trim() }

  /*
   * 괄호가 없다. 닫는 괄호만 있는 줄(`보롬창고 구좌읍 종달항길3)`)이 여기 온다 —
   * 첫 공백까지를 이름으로 보고 나머지를 주소로 둔다. 주소가 한 글자라도 틀리면
   * 사람이 폼에서 바로 보고 고칠 수 있지만, **이름이 후보에 없으면 누락 검사가
   * 그 가게를 아예 보지 않는다.** 그래서 이름을 살리는 쪽으로 가른다.
   */
  const clean = t.replace(/\)$/, '').trim()
  const sp = clean.indexOf(' ')
  if (sp < 0) return { 이름: clean, 주소: '' }
  if (!/\)$/.test(t)) return { 이름: clean, 주소: '' }
  return { 이름: clean.slice(0, sp).trim(), 주소: clean.slice(sp + 1).trim() }
}

/** `11.04~11.08` 처럼 연도가 없는 표기. 연도를 만들지 않는 근거는 SKILL.md */
const MD_RANGE = /(\d{1,2})[.\/](\d{1,2})\s*[~-]\s*(\d{1,2})[.\/](\d{1,2})/
const YMD_RANGE =
  /(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})\s*[~-]\s*(?:(\d{4})[-.\/])?(\d{1,2})[-.\/](\d{1,2})/

const pad = (n: string) => n.padStart(2, '0')

/** 양끝 포함 일수 (§6.2.1). `form-validation#tripDays`와 같은 식이다 */
function daysBetween(start: string, end: string): number | null {
  const s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  if (Number.isNaN(s) || Number.isNaN(e)) return null
  const d = Math.round((e - s) / 86_400_000) + 1
  return d >= 1 ? d : null
}

/**
 * 스킬 `freeform-parse` — 메모에서 기계로 알아볼 수 있는 것만 뽑는다.
 *
 * 실패하지 않는다. 아무것도 못 찾으면 빈 배열·`null`을 반환한다.
 */
export function parseFreeform(text: string): FreeformParse {
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  /* ── 라벨 블록 ─────────────────────────────────────────────── */
  const isLabelWord = (w: string) => BARE_LABEL_WORDS.some((x) => w.includes(x))
  const 블록: { 라벨: string; 본문: string }[] = [{ 라벨: '', 본문: '' }]
  for (const line of lines) {
    const m = LABEL_RE.exec(line)
    // 콜론 라벨 — 불릿이 있으면 아무 낱말이나, 없으면 아는 낱말일 때만(위 근거)
    if (m && (BULLET_RE.test(line) || isLabelWord(m[1]))) {
      블록.push({ 라벨: m[1].trim(), 본문: m[2] }); continue
    }
    // 콜론 없는 라벨 — 불릿 유무와 무관하게 아는 낱말일 때만
    const bare = BARE_LABEL_RE.exec(line)
    if (bare && isLabelWord(bare[1])) {
      블록.push({ 라벨: bare[1].trim(), 본문: '' }); continue
    }
    블록[블록.length - 1].본문 += (블록[블록.length - 1].본문 ? '\n' : '') + line
  }
  // 라벨 없는 첫 덩어리가 비어 있으면 버린다. 내용이 있으면 남긴다
  if (블록[0].라벨 === '' && normalizeSpace(블록[0].본문) === '') 블록.shift()
  for (const b of 블록) b.본문 = b.본문.trim()

  /* ── 날짜 ──────────────────────────────────────────────────── */
  let 날짜: { 시작: string; 종료: string } | null = null
  const ymd = YMD_RANGE.exec(text)
  if (ymd) {
    const 시작 = `${ymd[1]}-${pad(ymd[2])}-${pad(ymd[3])}`
    // 종료의 연도가 생략되면 시작의 연도를 쓴다 — 「2026.11.04~11.08」
    날짜 = { 시작, 종료: `${ymd[4] ?? ymd[1]}-${pad(ymd[5])}-${pad(ymd[6])}` }
  }
  /*
   * 연도 없는 `11.04~11.08`은 **날짜로 인정하지 않는다.** 연도를 고르는 것은
   * 추정이고, 여행기간은 일차 수와 이미지 슬롯 수를 결정하는 값이다(§6.2.1).
   * 대신 화면이 사람에게 날짜를 고르게 한다.
   */
  const 연도미정 = 날짜 === null && MD_RANGE.test(text)

  const 일수 = 날짜 ? daysBetween(날짜.시작, 날짜.종료) : null

  /* ── 장소 후보 ─────────────────────────────────────────────── */
  const 장소후보: PlaceCandidate[] = []
  const 본 = new Set<string>()
  const add = (이름: string, 주소: string, 출처: string) => {
    /*
     * 라벨이 이름에 딸려 오는 경우를 떼어낸다 — `-행사: 제주올레걷기축제 (11.05~11.07)`은
     * 규칙 A에서 이름이 «행사: 제주올레걷기축제»로 잡힌다. 콜론 뒤가 실제 이름이다.
     * 떼지 않으면 「행사: 제주올레걷기축제」라는 상호가 후보 목록에 들어가고,
     * 누락 검사가 그 문자열을 초안에서 찾다가 실패한다.
     */
    const n = 이름.replace(/^[\s\-·*]+/, '').replace(/^[^:：]{1,20}[:：]\s*/, '').trim()
    // URL이 들린 괄호(«관련기사: https://...»)는 장소가 아니다
    if (!n || n.length < 2 || /^https?:/.test(주소) || /^https?:/.test(n) || 본.has(n)) return
    /*
     * 정리된 이름이 여행기간 표기(`4박5일`·`5일`)면 장소가 아니다. 규칙 A의
     * `이름이기간` 검사는 **정리 전** 문자열(`여행일정: 4박5일`)을 보므로, 라벨이
     * 이름에 붙어 온 경우 그 검사를 통과해 버린다 — 여기서 정리 후 다시 막는다.
     */
    if (/^\d+\s*박\s*\d*\s*일?$|^\d+\s*일$/.test(n)) return
    본.add(n)
    장소후보.push({ 이름: n, 주소: 주소.trim(), 출처 })
  }

  /*
   * 규칙 B를 **먼저** 돈다. 목록 블록의 줄 단위 해석이 더 정확하기 때문이다 —
   * 규칙 A(전역 괄호)는 `고요한하루 (북선로 241)` 같은 줄에서 이름을 잘 뽑지만
   * 한 줄에 두 곳이 쉼표로 이어져 있으면 앞의 것만 잡는다. 순서를 뒤집으면
   * 먼저 등록된 쪽이 이기므로(`본` 집합) 덜 정확한 결과가 남는다.
   */
  for (const b of 블록) {
    if (!PLACE_BLOCK_WORDS.some((w) => b.라벨.includes(w))) continue
    for (const line of b.본문.split('\n')) {
      // 한 줄에 쉼표로 여러 곳이 이어진 경우(`A (주소), B (주소)`)를 먼저 가른다
      const parts = /\(/.test(line) ? line.split(/,(?![^(]*\))/) : line.split(',')
      for (const part of parts) {
        const got = splitPlaceLine(part)
        if (got) add(got.이름, got.주소, b.라벨)
      }
    }
  }

  /*
   * 규칙 A — 목록 블록 밖의 `이름 (주소)`. `-행사: 제주올레걷기축제 (11.05~11.07)`의
   * 축제명이 여기서 잡힌다.
   *
   * **블록 단위로 돈다.** 전체 텍스트에 한 번 돌리면 후보의 `출처`가 비고, 그러면
   * AI가 그 항목을 어디에 넣어야 할지 신호를 못 받아 조용히 빠뜨린다(실측).
   */
  for (const b of 블록) {
    if (PLACE_BLOCK_WORDS.some((w) => b.라벨.includes(w))) continue
    for (const m of b.본문.matchAll(PLACE_RE)) {
      /*
       * 괄호 안이 기간·날짜면 **주소가 아니다.** `4박5일 (11.04~11.08)`처럼
       * 장소가 아닌 것도 걸리는데, 이름이 기간 표현이면 후보에서 뺀다 —
       * 후보에 남으면 누락 검사가 「4박5일이 초안에 없다」고 보고한다.
       */
      const 기간표기 = /^\d{1,4}[-.\/]\d{1,2}([-.\/]\d{1,2})?\s*[~-]/.test(m[2].trim())
      const 이름이기간 = /^\d+\s*박\s*\d*\s*일?$|^\d+\s*일$/.test(m[1].trim())
      if (이름이기간) continue
      add(m[1], 기간표기 ? '' : m[2], b.라벨)
    }
  }

  /* ── 서술 필드 ─────────────────────────────────────────────── */
  const 필드 = { 여행주제: '', 타겟층: '', 기획메모: '' }
  for (const [name, words] of Object.entries(FIELD_WORDS) as
    [keyof typeof 필드, readonly string[]][]) {
    if (필드[name]) continue
    const b = 블록.find((x) => words.some((w) => x.라벨.includes(w)) && x.본문.trim())
    // 여러 줄이면 줄바꿈을 살린다 — 페르소나 문단이 한 줄이 아닐 수 있다
    if (b) 필드[name] = b.본문.trim()
  }

  /* ── 사람이 직접 쓴 일정 ────────────────────────────────────────
   * `일정`/`스케줄` 라벨 블록에 일차 마커가 있으면 그 본문을 그대로 쓴다.
   * `여행일정: 4박5일`처럼 마커 없이 기간만 적힌 블록은 거른다(hasDayMarker).
   * ──────────────────────────────────────────────────────────── */
  const 일정블록 = 블록.find((b) => {
    if (!/일정|스케줄/.test(b.라벨)) return false
    // 기간 표현(`4박5일`)을 먼저 뺀다 — `hasDayMarker`가 그 안의 「5일」을 일차
    // 마커로 오인한다. 뺀 뒤에도 마커가 남으면 진짜 일차별 일정이다.
    const 기간뺀본문 = b.본문.replace(/\d+\s*박\s*\d*\s*일?/g, '')
    return hasDayMarker(기간뺀본문)
  })
  const 일정원문 = 일정블록 ? 일정블록.본문.trim() : ''

  return {
    블록,
    날짜: 연도미정 ? null : 날짜,
    일수,
    장소후보,
    URL: [...new Set(text.match(URL_RE) ?? [])],
    필드,
    일정원문,
  }
}

/* ════════════════════════════════════════════════════════════════
 * draft-form-check
 * ════════════════════════════════════════════════════════════════ */

export type Origin = 'input' | 'planned' | 'empty'

export interface DraftNotes {
  /** 추출됐지만 초안 어디에도 없는 장소 */
  누락: PlaceCandidate[]
  /** §7.1 위반 — 이 칸이 채워지지 않으면 제출이 막힌다 */
  필수미입력: FieldErrors
  /** 연도가 없어 날짜를 못 읽었다. 화면이 사람에게 고르게 한다 */
  날짜미정: boolean
}

export interface DraftResult {
  /** `form_input`과 같은 구조 (§7.4). 화면이 변환 없이 채운다 */
  draft: FormInput
  origin: Record<string, Origin>
  notes: DraftNotes
}

/** 가격 3필드는 `PLAN_SCHEMA`에 없다 — 항상 `empty`다(§7.5 ③) */
const 가격경로 = ['가격.성인', '가격.아동', '가격.기타'] as const

/**
 * 스킬 `draft-assemble` — 후보 번호를 **실제 값으로 치환해** `form_input` 구조를 만든다.
 *
 * ## 이 단계가 있는 이유 (실측)
 *
 * 처음에는 AI가 `숙박`·`상점` 행에 이름·주소를 그대로 출력하게 했다. 카페 13곳이
 * 들어오자 **`max_tokens`로 실패했다**(2026-08-12 · 62초). 값을 옮기는 일은 규약
 * R3의 mechanical 영역이고, AI에게 시키면 출력이 커지는 것으로 끝나지 않는다 —
 * 옮기는 과정에서 이름이 바뀌거나 행이 사라진다.
 *
 * 그래서 AI는 **번호만** 고르고 값은 여기서 옮긴다. `buildBrochure`·`buildPage`가
 * 값 필드를 기계로 치환하는 것과 같은 구조다. 결과로 **이름·주소가 AI를 거치지
 * 않으므로 바뀔 수 없다** — §7.5 ②의 누락 0건 검사가 문자열 대조로 성립하는 근거다.
 *
 * 없는 번호는 **버린다.** AI가 범위 밖 번호를 고르면 그 행이 사라지고, 그러면
 * 그 장소가 `notes.누락`에 잡혀 사람이 본다. 빈 이름으로 행을 만들면 필수 검사가
 * 「숙소명을 2자 이상」이라 말하는데 사람은 무엇을 넣어야 할지 알 수 없다.
 */
export function assembleDraft(
  plan: PlanResult, parsed: Pick<FreeformParse, '장소후보' | '필드' | '일정원문'>,
): FormInput {
  const 장소후보 = parsed.장소후보
  const at = (i: unknown): PlaceCandidate | undefined =>
    typeof i === 'number' && Number.isInteger(i) ? 장소후보[i] : undefined

  const 숙박: Stay[] = []
  for (const row of plan.숙박 ?? []) {
    const c = at(row?.후보)
    if (!c) continue
    숙박.push({
      // 이름·주소는 추출된 원문 그대로다. AI가 준 문자열을 쓰지 않는다
      숙소명: c.이름, 위치: c.주소,
      객실타입: row.객실타입 ?? '', 숙박일정: row.숙박일정 ?? '',
    })
  }

  const 상점: Shop[] = []
  for (const i of plan.상점 ?? []) {
    const c = at(i)
    if (!c) continue
    // `구분`은 항상 `추천`이다. `제휴`로 올리는 경로는 사람이 폼에서 고르는 것뿐(§6.1)
    상점.push({ 상점명: c.이름, 구분: '추천', 위치: c.주소, 상점정보: '' })
  }

  /*
   * `일정원문`을 **문장으로 조립한다.** AI는 「몇째 날에 어디」만 정했다.
   *
   * 왜 기계가 쓰나: 번호와 산문을 함께 요구하면 추론이 발산한다 — low·medium
   * 양쪽에서 8000 토큰을 전부 추론에 쓰고 출력이 0으로 잘렸다(실측 55.8/60.4초).
   * 「어디에 둘 것인가」는 판단이고 「그것을 적는 일」은 조립이다.
   *
   * 형식은 §6.3의 일차 표기(`n일:`)를 지킨다 — 이 문자열이 그대로 폼의
   * `일정원문`이 되고, 나중에 `itinerary-decomposition`이 다시 분해한다.
   * 그때 원문근거 대조가 성립해야 하므로 **장소 이름을 원문 그대로** 적는다.
   */
  const 일정줄: string[] = []
  for (const day of [...(plan.일정 ?? [])].sort((a, b) => (a?.day ?? 0) - (b?.day ?? 0))) {
    const 이름들 = (day?.후보 ?? []).map((i) => at(i)?.이름).filter(Boolean)
    // 장소가 없는 일차도 줄을 남긴다 — 일차 수가 여행기간과 맞아야 한다(§6.3)
    일정줄.push(`${day?.day ?? 일정줄.length + 1}일: ${이름들.join(', ') || '자유 일정'}`)
  }
  /*
   * 기획자가 일정을 **직접 썼으면** 그것을 쓴다(2026-08-13). AI 배분(`일정줄`)은
   * 후보를 나열할 뿐이라, 사람이 「오전 공항 도착, 오후 올레 7코스」처럼 적어 둔
   * 서술을 버리고 「1일: 자유 일정」으로 덮어썼다. 사람이 쓴 일정이 더 정확하다(§9).
   */
  const 일정원문 = parsed.일정원문.trim() || 일정줄.join('\n')

  return {
    행사정보: {
      행사명: plan.행사명 ?? '',
      여행지: plan.여행지 ?? '',
      // 행사 기간은 초안에서 채우지 않는다 — 메모의 행사 날짜는 연도가 없는 경우가
      // 많아 추정하지 않는다(§7.5). 사람이 폼에서 넣는다. 선택 필드라 빈 값이 정상이다.
      행사기간_시작: '', 행사기간_종료: '',
      여행기간_시작: plan.여행기간_시작 ?? '',
      여행기간_종료: plan.여행기간_종료 ?? '',
      일정원문,
      // 서술 3종은 메모의 블록 본문을 그대로 옮긴다. AI를 거치지 않는다
      타겟층: parsed.필드.타겟층,
      여행스타일: plan.여행스타일 ?? '',
      여행주제: parsed.필드.여행주제,
      기획메모: parsed.필드.기획메모,
    },
    숙박,
    상점,
    // 초안은 금액을 만들지 않는다. 사람이 채운다(§7.5 ③)
    가격: { 성인: '', 아동: '', 기타: '' },
    식사: { 식사정보: plan.식사정보 ?? '' },
    항공편: {
      공항: plan.항공편?.공항 ?? '', 항공사: plan.항공편?.항공사 ?? '',
      편명: plan.항공편?.편명 ?? '', 출발시간: plan.항공편?.출발시간 ?? '',
      도착시간: plan.항공편?.도착시간 ?? '',
    },
  }
}

/**
 * 스킬 `draft-form-check` — 검사·출처·누락. **초안을 고치지 않는다.**
 *
 * 세 판정 모두 기계가 한다. AI에게 되묻지 않는 이유는 두 가지다: 라우트의 AI
 * 예산이 1회이고 이미 `trip-planning`이 썼다(규약 R3), 그리고 자기 누락을
 * 자기가 판정하는 구조를 만들지 않는다(§7.5 ②).
 */
export function checkDraft(
  draft: FormInput, text: string, 장소후보: readonly PlaceCandidate[],
  parsed?: Pick<FreeformParse, '날짜'>,
): DraftResult {
  const 원문 = normalizeSpace(text)

  /* ── origin 3종 ────────────────────────────────────────────── */
  const origin: Record<string, Origin> = {}
  const mark = (경로: string, v: string) => {
    const t = normalizeSpace(v ?? '')
    if (t === '') { origin[경로] = 'empty'; return }
    origin[경로] = 원문.includes(t) ? 'input' : 'planned'
  }

  const g = draft.행사정보
  mark('행사정보.행사명', g.행사명)
  mark('행사정보.여행지', g.여행지)
  mark('행사정보.일정원문', g.일정원문)
  mark('행사정보.타겟층', g.타겟층)
  mark('행사정보.여행스타일', g.여행스타일)
  mark('행사정보.여행주제', g.여행주제)
  mark('행사정보.기획메모', g.기획메모)
  mark('식사.식사정보', draft.식사.식사정보)
  for (const [k, v] of Object.entries(draft.항공편)) mark(`항공편.${k}`, v)

  /*
   * 날짜는 예외다 — `11.04`가 `2026-11-04`로 바뀌므로 부분 문자열이 아니다.
   * `freeform-parse`가 읽은 값과 같으면 입력에서 온 것이다(SKILL.md의 판정 규칙).
   */
  for (const [필드, 읽은값] of [
    ['여행기간_시작', parsed?.날짜?.시작],
    ['여행기간_종료', parsed?.날짜?.종료],
  ] as const) {
    const v = normalizeSpace(g[필드])
    origin[`행사정보.${필드}`] = v === ''
      ? 'empty'
      : v === 읽은값 ? 'input' : 'planned'
  }

  for (const [i, st] of draft.숙박.entries()) {
    for (const [k, v] of Object.entries(st)) mark(`숙박[${i}].${k}`, v)
  }
  for (const [i, sh] of draft.상점.entries()) {
    for (const [k, v] of Object.entries(sh)) {
      /*
       * `구분`에는 출처를 붙이지 않는다 — **기계가 넣은 값**이다(`추천` 고정).
       * 입력에서 온 것도 AI가 쓴 것도 아니므로 3종 어디에도 해당하지 않는다.
       * `planned`로 두면 상점이 13곳일 때 「AI 초안」 배지가 13개 붙어, 정작
       * AI가 쓴 칸이 그 소음에 묻힌다.
       */
      if (k === '구분') continue
      mark(`상점[${i}].${k}`, v)
    }
  }
  // 스키마에 없으므로 AI가 채울 수 없다. 사람이 채운다
  for (const 경로 of 가격경로) origin[경로] = 'empty'

  /* ── 누락 (§7.5 ②) ─────────────────────────────────────────── */
  const haystack = normalizeSpace([
    draft.행사정보.일정원문,
    ...draft.숙박.map((s) => s.숙소명),
    ...draft.상점.flatMap((s) => [s.상점명, s.상점정보]),
  ].join(' '))

  const 누락 = 장소후보.filter((c) => !haystack.includes(normalizeSpace(c.이름)))

  /* ── §7.1 검사 ─────────────────────────────────────────────── */
  return {
    draft,
    origin,
    notes: { 누락, 필수미입력: validateFormInput(draft), 날짜미정: !parsed?.날짜 },
  }
}
