/**
 * ⚠️ 자동 생성 파일 — 직접 편집하지 마라.
 *
 *   생성: npm run build:harness  (scripts/build-harness.mts)
 *   출처: .claude/harness/manifest.json · .claude/skills/<스킬>/SKILL.md
 *
 * (경로에 별표+슬래시를 쓰지 않는다 — 블록 주석을 조기에 닫아 파일이 문법 오류가 된다)
 *
 * 프롬프트를 바꾸려면 해당 SKILL.md의 `## 프롬프트` 펜스를 고치고 다시 굽는다.
 * 이 파일을 고쳐도 다음 빌드에서 덮어써진다 (규약 R4·R5).
 *
 * 줄바꿈은 LF로 정규화돼 있다 — 프롬프트 바이트가 플랫폼에 따라 흔들리면
 * DeepSeek 컨텍스트 캐시 적중이 깨진다.
 */

export type SkillKind = 'ai' | 'mechanical' | 'spec'

export interface SkillSpec {
  readonly kind: SkillKind
  readonly ai: number
  readonly effort?: 'generate' | 'validate'
  readonly schema?: string
  readonly impl?: string
  readonly implemented_by?: string
  readonly asserts?: readonly string[]
  readonly does?: string
}

export interface RouteSpec {
  readonly agent: string | null
  readonly step: string
  readonly extra_steps?: readonly string[]
  readonly counter: string | null
  readonly retry_from: number | null
  readonly ai_budget: number
  readonly entry?: { readonly from: string; readonly to: string; readonly reset: string }
  readonly materials?: readonly string[]
  readonly driven_by?: string
  readonly skills: readonly { readonly name: string; readonly args?: Readonly<Record<string, unknown>> }[]
}

/** 매니페스트 버전 — spec 판본과 맞춘다 */
export const HARNESS_VERSION = "2.6.0"

/** 동결된 시스템 프롬프트. 요청 간 바이트 동일하다 */
export const PROMPTS = {
  "content-structuring": "너는 여행 상품 페이지의 서술을 쓴다.\n\n소개서는 압축, 페이지는 확장이다. 이것은 설계된 차이이며 분량이 늘어나는 것 자체는 정상이다.\n\n허용:\n- 문장을 나누거나 연결어를 넣어 늘리기\n- 이미 등장한 요소를 다른 표현으로 재언급\n- 값을 감싸는 서술의 어순 조정\n\n금지:\n- 새 장소·활동·이동·시설을 추가하는 것. 원문근거에 등장하는 요소만 쓴다\n- 소요 시간·거리·인원 등 출처 없는 숫자를 만드는 것\n- 사실정보 값 자체를 재표기·요약·삭제하는 것\n- 고유명사의 표기를 바꾸는 것. 약칭·영문 변환 금지\n- 가격을 계산·합계·환산하는 것\n- 마케팅 문구·과장 표현\n- HTML·CSS·클래스명을 출력하는 것\n\n형식:\n- 존댓말. 종결어미는 ~습니다/~입니다로 통일한다.\n- **일차별 서술은 200자를 넘기지 않는다.**\n- 신청 안내문구는 2문장 이내로 담백하게 쓴다. 총액을 계산해 적지 않는다.\n\n「기획 메모」가 주어지면 **어조를 잡는 참고 자료로만** 쓴다.\n그 내용을 출력에 인용하거나 사실로 옮겨 적지 않는다 — 고객에게 표시되지 않는\n내부 메모이며, 거기 적힌 나이·인원·인물·가격은 **사실정보가 아니다.**\n메모를 읽고 「누가 읽을 글인가」만 감을 잡은 뒤, 문장은 확정 데이터만으로 쓴다.",
  "fact-check": "너는 생성물의 사실정보가 사용자 원본 입력과 일치하는지 판정한다.\n\n기준값은 항상 **form_input**이다. 생성물이 기준값과 다르면 실패다.\n\n허용 차이 (실패가 아니다):\n- 앞뒤 공백, 내부 연속 공백 축약\n- HTML 이스케이프\n- 정규화 3종: 천 단위 콤마 제거(120,000원 → 120000원), 날짜 형식 통일(2026.03.14 → 2026-03-14)\n- **결합 1종: 여행기간_시작과 여행기간_종료를 «{시작} ~ {종료}»로 합친 것.**\n  form_input에는 여행기간이라는 필드가 없고 시작·종료 2개로 나뉘어 있다. 이는 정상이며 실패가 아니다.\n- **채움 1종: form_input이 빈 문자열(«») 인 선택 항목이 «추후 추가 예정»으로 채워진 것.**\n  채움은 확정 데이터표에서만 일어나므로 form_input 쪽에는 빈 값이 남아 있는 것이 정상이다.\n  기준값이 비어 있고 발견값이 «추후 추가 예정»이면 **통과다.**\n  그 역 — form_input에 실제 값이 있는데 생성물이 «추후 추가 예정»이면 실패다.\n- **분해 1종: «행사정보.일정»은 «행사정보.일정원문»을 일차 단위로 분해한 결과다.**\n  form_input에 «행사정보.일정» 키가 **없는 것이 정상**이며, source 경로가 form_input에 없다는\n  이유만으로 실패 판정하지 않는다. 이 영역에서 볼 것은 일차 수와, 일차별 장소·활동·식사가\n  일정원문에 등장하는가뿐이다. 원문근거 대조는 이 검증의 몫이 아니다.\n- 값을 둘러싼 서술 문장의 분량·어순·문장 수 차이\n\n실패로 판정하는 차이:\n- 값의 어순 변경 (롯데호텔 제주 → 롯데 제주 호텔)\n- 약칭·영문 변환, 날짜 재표기, 요약·부분 삭제, 단위 변경\n- 입력에 없는 지명·시설·경유지·관광지 등장\n- 출처 없는 숫자. 단 일차 번호와 여행기간에서 파생된 수(일수, 일수-1)는 정상이다\n- 「추후 추가 예정」이 다른 문구로 바뀌거나 빈칸이 된 경우\n- source가 없는 사실정보 필드\n\n실패 항목은 **전부** 반환한다. 첫 실패에서 멈추지 않는다.\n재시도 여부는 판단하지 않는다. 통과/실패와 사유만 반환한다.",
  "intro-content-fill": "너는 여행 상품 소개서의 개요 문장을 쓴다.\n\n「핵심일정」은 일차별 서술에 **이미 등장한** 장소·활동만 사용해 2~3문장으로 요약한다.\n\n절대 규칙:\n- 일정에 없는 장소·활동·이동·시설을 추가하지 않는다.\n- 출처 없는 숫자를 만들지 않는다. 소요 시간·거리·인원을 추정하지 않는다.\n- 가격을 계산·합계·환산하지 않는다.\n- 고유명사의 표기를 바꾸지 않는다. 약칭·영문 변환을 하지 않는다.\n- 마케팅 문구·과장 표현을 쓰지 않는다.\n- 존댓말로 쓴다. 종결어미는 ~습니다/~입니다로 통일한다.\n- 중괄호 토큰이나 파이프 기호를 출력에 남기지 않는다.\n\n「기획 메모」가 주어지면 **어조를 잡는 참고 자료로만** 쓴다.\n그 내용을 출력에 인용하거나 사실로 옮겨 적지 않는다 — 고객에게 표시되지 않는\n내부 메모이며, 거기 적힌 나이·인원·인물·가격은 **사실정보가 아니다.**\n메모를 읽고 「누가 읽을 글인가」만 감을 잡은 뒤, 문장은 확정 데이터만으로 쓴다.",
  "itinerary-decomposition": "너는 여행 일정 원문을 일차 단위로 분해한다.\n\n절대 규칙:\n- 원문에 없는 일차·장소·활동·이동·시간을 만들지 않는다.\n- 「원문근거」는 일정원문에서 **그대로 잘라낸 부분 문자열**이어야 한다. 요약·재작성·의역·어순 변경을 하지 않는다.\n- 「내용」은 그 일차의 원문근거에 등장하는 요소만 사용해 쓴다. 새 장소나 활동을 덧붙이지 않는다.\n- 「내용」은 존댓말 서술문으로 쓴다. 종결어미는 ~습니다/~입니다로 통일하고, 명사형 종결을 쓰지 않는다.\n- 출처 없는 숫자를 만들지 않는다. 소요 시간·거리·인원·요금을 추정하지 않는다.\n- 일차 구분 표기는 다음 6종만 인식한다: n일 / n일차 / n일 차 / 첫째 날 / Day n / DAY n\n\n「핵심표현」 신고 (§6.3 판정 3단계):\n- 각 일차의 「내용」에 쓴 **장소·시설·활동·고유명사**를 「핵심표현」 배열에 그대로 담는다.\n- 예: 내용이 「김해공항에서 출발해 올레 7코스를 걷습니다」이면 [\"김해공항\", \"올레 7코스\"].\n- 조사·어미·일반 어휘는 담지 않는다. 「걷습니다」·「출발」·「일정」은 핵심표현이 아니다.\n- **서버가 이 목록을 원문근거와 확정 데이터에 대조한다.** 근거 없는 표현을 담으면\n  0차 검증 실패로 돌아온다. 빠뜨리지도, 없는 것을 담지도 않는다.\n- 「추후 추가 예정」인 일차는 빈 배열로 둔다.\n\n판정:\n- 원문의 일차 수가 여행기간 일수보다 **많으면** 판정을 day_overflow로 하고 일정을 비운다.\n- 일차 구분을 하나도 찾을 수 없으면 판정을 no_day_marker로 하고 일정을 비운다. 임의로 배분하지 않는다.\n- 원문의 일차 수가 여행기간보다 **적으면** 부족한 일차를 원문근거 빈 문자열, 내용 \"추후 추가 예정\"으로 채우고 판정은 pass로 한다.",
} as const

/** 감사용 — SKILL.md를 고치면 이 값이 바뀐다 (문서가 load-bearing임의 증거) */
export const PROMPT_HASHES = {
  "content-structuring": "e6ef73587d06",
  "fact-check": "3d276355de06",
  "intro-content-fill": "e72dce05939b",
  "itinerary-decomposition": "1b9a0793e09a",
} as const

/**
 * user 메시지의 **지시문**. 데이터 조립은 TS가 하고 지시 문장은 여기서 온다.
 *
 * 변형키가 있는 이유: `fact-check`는 대상(brochure/page)에 따라 지시가 다르다.
 *
 * 시스템 프롬프트와 달리 이것은 **캐시 프리픽스가 아니다** — DeepSeek 컨텍스트
 * 캐시는 최장 공통 접두를 잡는데 system이 앞에 오므로, user 쪽 변경은 system
 * 프리픽스 적중을 깨지 않는다.
 */
export const USER_PROMPTS = {
  "content-structuring": {
    "default": "각 일차의 확장 서술과 신청 섹션의 제목·안내문구를 만들어라.",
  },
  "fact-check": {
    "brochure": "각 섹션의 source가 가리키는 경로를 form_input에 적용해 값을 대조하라.\nsource가 \"generated\"인 필드는 값 대조 대신 \"입력에 없는 요소가 섞였는가\"만 본다.",
    "page": "각 섹션의 source가 가리키는 경로를 form_input에 적용해 값을 대조하라.\n추가로 확인할 것:\n- image_slot·image_slots 값이 위 목록의 슬롯과 같은가 (빈 문자열은 미업로드로 정상)\n- hero.headline이 행사명 그대로이고 40자 이내인가\n- apply 내부의 가격요약·행사정보요약이 price·hero와 일치하는가\n- 테마 적용으로 섹션 구성·문구·사실정보가 바뀌지 않았는가",
  },
  "intro-content-fill": {
    "default": "아래 일차별 서술을 근거로 「핵심일정」을 2~3문장으로 요약하라.",
  },
  "itinerary-decomposition": {
    "default": "참고 (다른 확정 값 — 여기 있는 표현은 내용에 써도 된다):",
  },
} as const

export const SKILLS = {
  "input-guard": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "form-validation#validateFormInput",
    "does": "필수 폼 그룹 6개 관문 재검사. 우회 호출 대비"
  },
  "optional-field-fill": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/normalize#fillOptional",
    "does": "선택 4항목 미입력을 '추후 추가 예정'으로 채운다"
  },
  "data-normalization": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/normalize#normalizeFields",
    "asserts": [
      "변경이력_존재"
    ],
    "does": "정규화 3종(날짜·금액 콤마·공백) + 여행기간 2필드 결합 1종"
  },
  "itinerary-decomposition": {
    "kind": "ai",
    "ai": 1,
    "effort": "generate",
    "schema": "DECOMPOSE_SCHEMA",
    "does": "일정 원문을 일차 단위로 분해하고 원문근거를 남긴다"
  },
  "axis0-verification": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/axis0#verifyAxis0",
    "does": "0차 기계 검증 4종 — 정규화·일수·원문근거 포함·명사구 근거"
  },
  "intro-content-fill": {
    "kind": "ai",
    "ai": 1,
    "effort": "generate",
    "schema": "OVERVIEW_SCHEMA",
    "does": "소개서 overview.핵심일정 2~3문장을 쓴다"
  },
  "intro-template-writer": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/brochure#buildBrochure",
    "does": "소개서 8섹션 뼈대를 조립하고 각 필드에 source 경로를 배치한다"
  },
  "tonal-manner-apply": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/brochure#assertFactsUnchanged",
    "does": "보호값 검증 — 소개서의 사실정보가 confirmed_data와 바이트 동일한지 확인 (변경 0건)"
  },
  "brochure-contract-check": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/brochure#checkBrochure",
    "does": "섹션 8개·순서·source 누락 0건·미치환 토큰 0건·길이 계약"
  },
  "memo-leak-check": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/memo-leak#findMemoLeaks",
    "does": "기획메모에만 있는 숫자가 서술 필드에 노출됐는지 검사한다. 소개서·페이지 양쪽 체인에 들어간다"
  },
  "fact-check": {
    "kind": "ai",
    "ai": 1,
    "effort": "validate",
    "schema": "VALIDATION_SCHEMA",
    "does": "form_input을 기준값으로 소개서(1차) 또는 페이지(2차)의 사실정보를 대조한다"
  },
  "theme-design-token-match": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/theme#resolveTheme",
    "does": "여행스타일 → 테마 키 + 디자인 토큰 3종"
  },
  "content-structuring": {
    "kind": "ai",
    "ai": 1,
    "effort": "generate",
    "schema": "EXPAND_SCHEMA",
    "does": "소개서의 압축 서술을 페이지의 확장 서술로 늘리고 apply 안내 문구를 쓴다"
  },
  "web-content-structure-gen": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/page#buildPage",
    "does": "페이지 9섹션을 조립하고 source 맵을 승계한다"
  },
  "page-contract-check": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/page#checkPage",
    "does": "9섹션·순서·이미지 슬롯·길이 계약 4종(생성 시점)"
  },
  "slug-issue": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/slug#proposeSlug",
    "does": "행사명에서 slug를 발급한다. 충돌 시 접미사"
  },
  "edit-contract-check": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "edit-contract#validateEdit",
    "does": "편집 저장 계약 — 기본 9섹션 불변부·삽입 블록 3종·이미지 참조·길이 계약 6종"
  },
  "edit-history-diff": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "edit-contract#diffSections",
    "does": "저장 전후를 비교해 변경된 섹션만 edit_history 기록으로 만든다 (action 4종)"
  },
  "slug-format-check": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/slug#isValidSlug",
    "does": "사람이 입력한 slug의 허용 문자·길이 판정. 중복은 DB UNIQUE가 본다"
  },
  "consistency-check": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/consistency#checkConsistency",
    "does": "소개서와 페이지를 source 경로를 조인 키로 대조한다. apply 섹션 제외"
  },
  "product-orchestrator": {
    "kind": "spec",
    "ai": 0,
    "implemented_by": "lib/orchestrator.ts#runStep",
    "does": "재시도 카운터·상태 전이·응답 코드 결정. 하네스 바깥(R7)"
  },
  "execution-log-collection": {
    "kind": "spec",
    "ai": 0,
    "implemented_by": "lib/logging.ts",
    "does": "execution_logs append. 하네스 바깥(R7)"
  },
  "abnormality-detection": {
    "kind": "spec",
    "ai": 0,
    "implemented_by": "lib/logging.ts",
    "does": "이상 5종 감지 → abnormality_flags. 하네스 바깥(R7)"
  },
  "draft-registration": {
    "kind": "spec",
    "ai": 0,
    "implemented_by": "lib/orchestrator.ts#runStep",
    "does": "3차 통과 시 draft 전이. 하네스 바깥(R7)"
  }
} as const satisfies Readonly<Record<string, SkillSpec>>

/**
 * ⚠️ 주석 대신 `satisfies`를 쓴다.
 *
 * `: Readonly<Record<string, RouteSpec>>`로 적으면 키가 `string`으로 넓어져
 * `RouteKey`가 사실상 `string`이 된다. 그러면 라우트 이름을 잘못 적어도
 * 컴파일이 통과한다 — 배선 오타가 런타임까지 살아남는 경로다.
 */
export const ROUTES = {
  "products": {
    "agent": "intake-agent",
    "step": "pipeline_started",
    "counter": null,
    "retry_from": null,
    "ai_budget": 0,
    "driven_by": "route",
    "skills": [
      {
        "name": "input-guard"
      }
    ]
  },
  "form-input": {
    "agent": "intake-agent",
    "step": "form_input_resubmitted",
    "counter": null,
    "retry_from": null,
    "ai_budget": 0,
    "driven_by": "route",
    "skills": [
      {
        "name": "input-guard"
      }
    ]
  },
  "content": {
    "agent": null,
    "step": "content_edited",
    "counter": null,
    "retry_from": null,
    "ai_budget": 0,
    "driven_by": "route",
    "skills": [
      {
        "name": "edit-contract-check"
      },
      {
        "name": "edit-history-diff"
      }
    ]
  },
  "slug": {
    "agent": null,
    "step": "slug_changed",
    "counter": null,
    "retry_from": null,
    "ai_budget": 0,
    "driven_by": "route",
    "skills": [
      {
        "name": "slug-format-check"
      }
    ]
  },
  "decompose": {
    "agent": "intake-agent",
    "step": "normalization_validated",
    "extra_steps": [
      "itinerary_decomposed"
    ],
    "counter": "normalization",
    "retry_from": 2,
    "ai_budget": 1,
    "skills": [
      {
        "name": "optional-field-fill"
      },
      {
        "name": "data-normalization"
      },
      {
        "name": "itinerary-decomposition"
      },
      {
        "name": "axis0-verification"
      }
    ]
  },
  "brochure": {
    "agent": "content-writer-agent",
    "step": "brochure_generated",
    "counter": "brochure",
    "retry_from": 3,
    "ai_budget": 1,
    "skills": [
      {
        "name": "intro-content-fill",
        "args": {
          "label": "intro-overview"
        }
      },
      {
        "name": "intro-template-writer"
      },
      {
        "name": "tonal-manner-apply"
      },
      {
        "name": "brochure-contract-check"
      },
      {
        "name": "memo-leak-check",
        "args": {
          "target": "brochure"
        }
      }
    ]
  },
  "validate-brochure": {
    "agent": "validator-agent",
    "step": "validation_1_completed",
    "counter": "brochure",
    "retry_from": 3,
    "ai_budget": 1,
    "skills": [
      {
        "name": "fact-check",
        "args": {
          "target": "brochure",
          "axis": "axis_1",
          "label": "fact-check-1"
        }
      }
    ]
  },
  "page": {
    "agent": "web-builder-agent",
    "step": "page_generated",
    "counter": "page",
    "retry_from": 5,
    "ai_budget": 1,
    "entry": {
      "from": "brochure_ready",
      "to": "generating",
      "reset": "product-create"
    },
    "materials": [
      "image_slots",
      "used_slugs"
    ],
    "skills": [
      {
        "name": "theme-design-token-match"
      },
      {
        "name": "content-structuring"
      },
      {
        "name": "web-content-structure-gen"
      },
      {
        "name": "page-contract-check"
      },
      {
        "name": "memo-leak-check",
        "args": {
          "target": "page"
        }
      },
      {
        "name": "slug-issue"
      }
    ]
  },
  "validate-page": {
    "agent": "validator-agent",
    "step": "validation_2_completed",
    "counter": "page",
    "retry_from": 5,
    "ai_budget": 1,
    "materials": [
      "image_slots"
    ],
    "skills": [
      {
        "name": "fact-check",
        "args": {
          "target": "page",
          "axis": "axis_2",
          "label": "fact-check-2"
        }
      }
    ]
  },
  "validate-consistency": {
    "agent": "validator-agent",
    "step": "validation_3_completed",
    "counter": "consistency",
    "retry_from": 5,
    "ai_budget": 0,
    "skills": [
      {
        "name": "consistency-check"
      }
    ]
  }
} as const satisfies Readonly<Record<string, RouteSpec>>

export const AGENTS = {
  "intake-agent": {
    "routes": [
      "products",
      "form-input",
      "decompose"
    ]
  },
  "content-writer-agent": {
    "routes": [
      "brochure"
    ]
  },
  "validator-agent": {
    "routes": [
      "validate-brochure",
      "validate-page",
      "validate-consistency"
    ]
  },
  "web-builder-agent": {
    "routes": [
      "page"
    ]
  },
  "log-monitor-agent": {
    "routes": []
  }
} as const satisfies Readonly<Record<string, { readonly routes: readonly string[] }>>

export type RouteKey = keyof typeof ROUTES
export type AiSkillName = keyof typeof PROMPTS
