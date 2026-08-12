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
 * §7.5 — 자연어 초안 (`plan-draft` · #20)
 *
 * 폼 앞단이다. 산출물은 `form_input`이 **아니라** 사람이 검토할 초안이며,
 * 구조는 `form_input`과 같게 맞춘다(§7.4) — 화면이 변환 없이 칸에 채운다.
 *
 * ## 가격 3필드가 스키마에 없다
 *
 * 금액은 공개 페이지(§9.3)와 신청 이메일(§13.3)에 그대로 실린다. 사람이 입력하지
 * 않은 숫자가 고객에게 도달하는 경로를 만들지 않는다(§7.5 ③).
 *
 * 프롬프트로 「가격을 쓰지 마라」고 지시하는 대신 **구조에서 뺐다** — 지시는
 * 어겨질 수 있고 스키마는 어겨질 수 없다. 절대 원칙 3을 금지에 쓴 경우다.
 * ════════════════════════════════════════════════════════════════ */

/* ── AI는 이름·주소를 **다시 쓰지 않는다** ──────────────────────────
 * 실측으로 정해진 구조다. 처음에는 `숙박`·`상점` 행에 이름·주소를 그대로
 * 출력하게 했더니 **카페 13곳에서 `max_tokens`로 실패했다**(2026-08-12, 62초).
 * 값을 옮기는 것은 규약 R3의 mechanical 영역이고, AI에게 시키면 출력이 커지는
 * 것으로 끝나지 않는다 — 옮기는 과정에서 이름이 바뀌거나 행이 사라진다.
 *
 * 그래서 AI는 **후보 번호**만 고른다. 실제 값 치환은 `draft-assemble`이 한다.
 * `buildBrochure`·`buildPage`가 값 필드를 기계로 치환하는 것과 같은 이유다.
 * 이름·주소가 AI를 거치지 않으므로 **바뀔 수 없다.**
 * ──────────────────────────────────────────────────────────────── */

const 초안_숙박 = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      /** `장소후보` 배열의 인덱스 (0부터) */
      후보: { type: Type.INTEGER },
      객실타입: { type: Type.STRING },
      숙박일정: { type: Type.STRING },
    },
    required: ['후보', '객실타입', '숙박일정'],
  },
}

/**
 * 상점은 **번호만** 받는다.
 *
 * `구분`을 받지 않는 이유: `추천` 하나뿐이므로 기계가 넣으면 된다. 열거형으로
 * 강제하는 것보다 아예 받지 않는 것이 확실하다 — 없는 제휴 관계를 만드는 일이고
 * (§6.1), `제휴`로 올리는 경로는 사람이 폼에서 고르는 것뿐이다.
 *
 * `상점정보`를 받지 않는 이유: 메모에 가게 설명이 없으면 AI가 쓸 근거도 없다.
 * 「감성 카페」 같은 문장은 창작이다. 미입력 표기(§6.1)가 빈칸을 처리한다.
 */
const 초안_상점 = { type: Type.ARRAY, items: { type: Type.INTEGER } }

/**
 * 일차별 배분 — **AI가 하는 유일한 판단**이 이 배열이다.
 *
 * `일정원문`(문장)을 받지 않는 이유는 실측이다. 번호와 산문을 **함께** 요구하면
 * 추론이 발산한다 — `low`·`medium` 양쪽에서 8000 토큰을 전부 추론에 쓰고 출력이
 * 0으로 잘렸다(2026-08-12 · 55.8초 / 60.4초 · `reasoning_tokens: 8000`).
 *
 * 「어느 장소를 몇째 날에 두는가」는 판단이고 「그것을 문장으로 적는 일」은 조립이다.
 * 둘을 한 호출에 섞지 않는다. 문장은 `draft-assemble`이 만든다.
 */
const 초안_일정 = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      /** 1부터 */
      day: { type: Type.INTEGER },
      /** 그 날 가는 장소들의 후보 번호. 순서가 동선 순서다 */
      후보: { type: Type.ARRAY, items: { type: Type.INTEGER } },
    },
    required: ['day', '후보'],
  },
}

export const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    행사명: { type: Type.STRING },
    여행지: { type: Type.STRING },
    여행기간_시작: { type: Type.STRING },
    여행기간_종료: { type: Type.STRING },
    여행스타일: { type: Type.STRING },
    식사정보: { type: Type.STRING },
    일정: 초안_일정,
    숙박: 초안_숙박,
    상점: 초안_상점,
    항공편: {
      type: Type.OBJECT,
      properties: {
        공항: { type: Type.STRING },
        항공사: { type: Type.STRING },
        편명: { type: Type.STRING },
        출발시간: { type: Type.STRING },
        도착시간: { type: Type.STRING },
      },
      required: ['공항', '항공사', '편명', '출발시간', '도착시간'],
    },
  },
  required: [
    '행사명', '여행지', '여행기간_시작', '여행기간_종료',
    '여행스타일', '식사정보', '일정', '숙박', '상점', '항공편',
  ],
}

/**
 * `PLAN_SCHEMA`의 짝. **가격이 없고, 숙박·상점은 후보 번호다** — 위 주석의 근거를 읽는다.
 *
 * `여행스타일`을 `ShopKind`처럼 좁히지 않는 이유: 6종 밖의 값이 오면 테마가
 * `default`로 떨어지고(§9.4) 그것으로 충분하다. 여기서 좁히면 스키마 위반이
 * 되어 §11.6 재시도 경로를 쓰게 되는데, 테마 하나 때문에 AI를 다시 부르는 것은
 * 25초 예산을 쓸 이유가 되지 못한다.
 */
export interface PlanResult {
  행사명: string
  여행지: string
  여행기간_시작: string
  여행기간_종료: string
  여행스타일: string
  식사정보: string
  /** 일차별 장소 배분. `일정원문` 문장은 `draft-assemble`이 이것으로 조립한다 */
  일정: { day: number; 후보: number[] }[]
  /** 후보 번호 + AI가 쓸 수 있는 두 값. 이름·주소는 기계가 채운다 */
  숙박: { 후보: number; 객실타입: string; 숙박일정: string }[]
  /** 후보 번호만. 순서가 화면의 행 순서다 */
  상점: number[]
  항공편: { 공항: string; 항공사: string; 편명: string; 출발시간: string; 도착시간: string }
}

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
          핵심표현: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['day', '원문근거', '내용', '핵심표현'],
      },
    },
  },
  required: ['판정', '일정'],
}

export interface DecomposeResult {
  판정: 'pass' | 'day_overflow' | 'no_day_marker'
  일정: { day: string; 원문근거: string; 내용: string; 핵심표현: string[] }[]
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

