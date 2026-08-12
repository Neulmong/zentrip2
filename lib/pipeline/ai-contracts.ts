import { Type } from '@google/genai'

/**
 * AI 호출별 **출력 스키마와 TS 타입** (§4.3의 출력 강제).
 *
 * ## 시스템 프롬프트는 여기 없다 (규약 R4)
 *
 * `.claude/skills/<스킬>/SKILL.md`의 `## 프롬프트` 펜스가 유일한 출처이고,
 * `npm run build:harness`가 그것을 `lib/harness/generated/registry.ts`로 굽는다.
 * 프롬프트를 바꾸려면 SKILL.md를 고친다 — 이 파일에 `*_SYSTEM` 상수를
 * 다시 만들면 `npm run test:harness`가 실패한다.
 *
 * 사본을 두지 않는 이유: 두 곳에 있으면 **어느 쪽이 실제로 실행되는지**
 * 코드를 읽어야 알게 된다. 문서가 실행 근거라는 전제가 그 순간 무너진다.
 *
 * 스키마와 타입이 여기 남는 이유: 둘은 **짝이어야 한다.** 스키마를 문서로
 * 옮기면 타입과 어긋나도 컴파일이 통과한다. SKILL.md는 스키마의 이름만 적는다.
 */

/* ════════════════════════════════════════════════════════════════
 * Step 02 — 일차 분해 (§6.3)
 * ════════════════════════════════════════════════════════════════ */

export const DECOMPOSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    판정: { type: Type.STRING, enum: ['pass', 'day_overflow', 'no_day_marker'] },
    일정: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          day: { type: Type.STRING },
          원문근거: { type: Type.STRING },
          내용: { type: Type.STRING },
        },
        required: ['day', '원문근거', '내용'],
      },
    },
  },
  required: ['판정', '일정'],
}

export interface DecomposeResult {
  판정: 'pass' | 'day_overflow' | 'no_day_marker'
  일정: { day: string; 원문근거: string; 내용: string }[]
}

/* ════════════════════════════════════════════════════════════════
 * Step 03 — 소개서 개요 서술 (§8.7의 `핵심일정`)
 *
 * 값 필드는 서버가 기계 치환하므로 AI는 이 서술 하나만 만든다.
 * (근거는 lib/pipeline/brochure.ts 상단)
 * ════════════════════════════════════════════════════════════════ */

export const OVERVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: { 핵심일정: { type: Type.STRING } },
  required: ['핵심일정'],
}

/* ════════════════════════════════════════════════════════════════
 * Step 04·06 — 사실정보 대조 (§11.1 1·2차)
 * ════════════════════════════════════════════════════════════════ */

export const VALIDATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    판정: { type: Type.STRING, enum: ['pass', 'fail'] },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          검증영역: { type: Type.STRING },
          source경로: { type: Type.STRING },
          기준값: { type: Type.STRING },
          발견값: { type: Type.STRING },
          사유: { type: Type.STRING },
          위치: { type: Type.STRING },
        },
        required: ['검증영역', '기준값', '발견값', '사유', '위치'],
      },
    },
  },
  required: ['판정', 'items'],
}

export interface ValidationResult {
  판정: 'pass' | 'fail'
  items: {
    검증영역: string; source경로?: string
    기준값: string; 발견값: string; 사유: string; 위치: string
  }[]
}

/* ════════════════════════════════════════════════════════════════
 * Step 05 — 페이지 확장 서술 (§9.3)
 *
 * 값 필드는 서버가 승계하므로 AI는 일차별 확장 서술과 신청 문구만 만든다.
 * (근거는 lib/pipeline/page.ts 상단)
 * ════════════════════════════════════════════════════════════════ */

export const EXPAND_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    days: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { day: { type: Type.STRING }, text: { type: Type.STRING } },
        required: ['day', 'text'],
      },
    },
    apply: {
      type: Type.OBJECT,
      properties: { 제목: { type: Type.STRING }, 안내문구: { type: Type.STRING } },
      required: ['제목', '안내문구'],
    },
  },
  required: ['days', 'apply'],
}

export interface ExpandResult {
  days: { day: string; text: string }[]
  apply: { 제목: string; 안내문구: string }
}

/* ════════════════════════════════════════════════════════════════
 * Step 07 — 3차 정합성 (§11.1)
 * ════════════════════════════════════════════════════════════════ */

