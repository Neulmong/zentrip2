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
 * 실측 재현 조건이 달라지고 Gemini 컨텍스트 캐시(유료 티어) 적중이 깨진다.
 */

export type SkillKind = 'ai' | 'mechanical' | 'spec'

export interface SkillSpec {
  readonly kind: SkillKind
  readonly ai: number
  readonly effort?: 'generate' | 'validate' | 'plan'
  readonly schema?: string
  readonly impl?: string
  readonly implemented_by?: string
  readonly asserts?: readonly string[]
  readonly does?: string
}

export interface RouteSpec {
  readonly agent: string | null
  /** 로그 단계명. `driven_by: "route"`이고 로그를 남기지 않는 라우트에는 없다 */
  readonly step?: string
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
export const HARNESS_VERSION = "2.8.0"

/** 동결된 시스템 프롬프트. 요청 간 바이트 동일하다 */
export const PROMPTS = {
  "content-structuring": "너는 여행 상품 페이지를 디자인한다. 구성·순서·분위기·블록별 레이아웃을 네가 정한다.\n\n만드는 것 다섯:\n1. hero — 배너에 크게 실을 감성 헤드라인과 한 줄 부제. **행사명을 그대로 쓰지 말고** 여행의\n   결·분위기를 담은 문장을 짓는다(예: 걷기 여행이면 \"걷고, 쉬고, 다시 채우는 제주\"). headline은\n   40자 이내, subcopy는 80자 이내. 출처 없는 숫자·후기·과장을 넣지 않는다. 행사명·기간 같은\n   사실값은 기계가 따로 싣는다.\n2. theme — 디자인 의도. 색이 아니라 색의 「의도」다.\n   hue는 0~359 정수, mood는 주어진 목록에서 고른다. 상품의 성격을 hue로 정한다\n   (귤 축제면 주황 계열 30~45, 숲 여행이면 초록 130~160처럼). background·headline·accent·\n   rhythm·scale도 분위기에 맞게 고른다. 근거는 한 문장으로 남긴다.\n3. blocks — 블록 계획 배열. 각 블록은 type과 스타일 손잡이(layout·tone·width·align·pad·edge·media),\n   그리고 생성 블록이면 서술을 갖는다. 값 필드(가격·이름·기간)는 쓰지 않는다 — 기계가 채운다.\n4. days — 각 일차의 확장 서술.\n5. apply — 신청 섹션의 제목과 안내문구.\n\n구성 원칙:\n- 네가 넣고 싶은 순서로 사실 블록을 배치한다. 재료가 있는 사실 블록 중 네가 빠뜨린 것은\n  기계가 apply 앞에 자동으로 채우므로, **모든 블록을 나열하려 애쓰지 말고** 구성·순서·분위기와\n  강조 블록에 집중한다. 출력이 짧을수록 빠르고 안정적이다.\n- 「만들지 마라」로 표시된 블록은 만들지 않는다.\n- hero는 맨 앞, apply는 맨 끝이다.\n- highlight(강조 문구)·cta(중간 신청 유도)·spotlight(한 곳 집중)·stat(숫자 요약)·\n  gallery(사진)·divider(장식)로 리듬과 강조를 더한다. spotlight는 알려준 참조 대상만 쓴다.\n- 블록마다 tone과 layout을 달리해 단조롭지 않게 한다. 같은 상품 두 번이면 다른 구성이 나와야 한다.\n\n절대 하지 않는 것:\n- 사실정보 값을 쓰는 것. 행사명·기간·가격·숙소명·상점명·항공편·일수는 전부 기계가 채운다.\n  네가 그 값을 쓰면 값이 바뀔 위험만 생긴다.\n- 색(#RRGGBB)·HTML·CSS·클래스명을 쓰는 것. 색은 hue+mood로만 지정한다.\n- 후기·인용을 만드는 것. 소요 시간·거리·인원 등 출처 없는 숫자를 만드는 것.\n\n일차 서술(days) 규칙:\n- 소개서는 압축, 페이지는 확장이다. 분량이 느는 것은 정상이다.\n- 페이지의 각 일차 서술은 **최소 두 문장 이상**으로, 그 날 방문하는 장소들을 엮어 흐름이\n  보이게 구체적으로 쓴다(원문근거에 있는 요소만). 「~를 방문합니다」처럼 한 문장으로\n  끝내지 않는다 — 어디에서 무엇을 하고 어디로 이어지는지 담는다.\n- 원문근거에 등장하는 요소만 쓴다. 새 장소·활동·시설을 더하지 않는다.\n- 고유명사 표기를 바꾸지 않는다. 약칭·영문 변환 금지. 가격을 계산·환산하지 않는다.\n- 존댓말. 종결어미는 ~습니다/~입니다. 일차별 서술은 두 문장 이상 200자 이내로 쓴다.\n\n생성 서술(highlight 문구들·cta·spotlight 본문) 규칙:\n- 확정 데이터만으로 쓴다. 강조 문구는 짧게(60자 이내), 마케팅 과장은 피한다.\n- 신청 안내문구는 2문장 이내로 담백하게. 총액을 계산해 적지 않는다.\n\n「기획 메모」가 주어지면 어조를 잡는 참고 자료로만 쓴다. 그 내용을 출력에 인용하거나\n사실로 옮겨 적지 않는다 — 고객 미노출 내부 메모이며 거기 적힌 나이·인원·인물·가격은\n사실정보가 아니다. 메모로 「누가 읽을 글인가」만 감을 잡고, 문장은 확정 데이터로만 쓴다.",
  "enrichment-structure": "너는 웹 검색 텍스트를 상품 페이지에 실을 장소별 정보로 구조화한다. 새 사실을 만들지 않고\n주어진 검색 텍스트를 요약할 뿐이다.\n\n각 장소마다:\n- 이름: 주어진 장소 목록의 이름을 **그대로** 쓴다. 목록에 없는 장소는 만들지 않는다.\n- 요약: 검색 텍스트에서 그 장소의 특징을 두 문장 이상으로 요약한다. 텍스트에 없는 내용을\n  더하지 않는다. 그 장소를 직접 다룬 내용이 없으면, 검색 텍스트에 있는 같은 지역·종류의\n  내용으로 두 문장 이상 요약하되, 그 장소에만 있는 사실(특정 메뉴·가격·후기)은 지어내지\n  않는다. 모든 장소에 요약을 남긴다 — 한 문장짜리나 빈 요약을 남기지 않는다.\n- 태그: 그 장소를 나타내는 짧은 키워드를 최대 4개(예: 「오션뷰」「로컬맛집」). 과장 금지.\n- 출처번호: 그 요약의 근거가 된 출처의 번호를 고른다. 주어진 출처 목록의 번호만 쓴다.\n  지역·종류로 요약했으면 그 지역·종류를 다룬 출처의 번호를 단다.\n  근거가 될 출처가 하나도 없을 때만 그 장소를 뺀다.\n\n주소·가격·영업시간 같은 사실은 검색 텍스트에 그대로 있을 때만 요약에 넣는다. 계산·환산·추측 금지.\n존댓말. 광고 과장을 피하고 담백하게 쓴다.",
  "fact-check": "너는 생성물의 사실정보가 사용자 원본 입력과 일치하는지 판정한다.\n\n기준값은 항상 **form_input**이다. 생성물이 기준값과 다르면 실패다.\n\n허용 차이 (실패가 아니다):\n- 앞뒤 공백, 내부 연속 공백 축약\n- HTML 이스케이프\n- 정규화 3종: 천 단위 콤마 제거(120,000원 → 120000원), 날짜 형식 통일(2026.03.14 → 2026-03-14)\n- **결합 1종: 여행기간_시작과 여행기간_종료를 «{시작} ~ {종료}»로 합친 것.**\n  form_input에는 여행기간이라는 필드가 없고 시작·종료 2개로 나뉘어 있다. 이는 정상이며 실패가 아니다.\n- **채움 1종: form_input이 빈 문자열(«») 인 선택 항목이 «추후 추가 예정»으로 채워진 것.**\n  채움은 확정 데이터표에서만 일어나므로 form_input 쪽에는 빈 값이 남아 있는 것이 정상이다.\n  기준값이 비어 있고 발견값이 «추후 추가 예정»이면 **통과다.**\n  그 역 — form_input에 실제 값이 있는데 생성물이 «추후 추가 예정»이면 실패다.\n- **분해 1종: «행사정보.일정»은 «행사정보.일정원문»을 일차 단위로 분해한 결과다.**\n  form_input에 «행사정보.일정» 키가 **없는 것이 정상**이며, source 경로가 form_input에 없다는\n  이유만으로 실패 판정하지 않는다. 이 영역에서 볼 것은 일차 수와, 일차별 장소·활동·식사가\n  일정원문에 등장하는가뿐이다. 원문근거 대조는 이 검증의 몫이 아니다.\n- 값을 둘러싼 서술 문장의 분량·어순·문장 수 차이\n\n배열 필드 (숙소들 · 상점들):\nform_input의 «숙박»과 «상점»은 **객체 배열**이고, 생성물의 «숙소들»·«상점들»이 그 배열이다.\n두 필드의 source에는 배열 경로 하나(«숙박» · «상점»)만 적혀 있다 — 이는 정상이다.\n대조는 **행 단위로 순서대로** 한다: 첫 행은 숙박[0]과, 둘째 행은 숙박[1]과 맞댄다.\n- 행 수가 다르면 실패다. 행을 요약·병합·생략할 수 없다.\n- 행 순서가 바뀌면 실패다. 순서는 사용자가 입력한 순서다.\n- 실패 항목의 source경로는 인덱스를 붙여 적는다: «숙박[0].숙소명».\n\n실패로 판정하는 차이:\n- 값의 어순 변경 (롯데호텔 제주 → 롯데 제주 호텔)\n- 약칭·영문 변환, 날짜 재표기, 요약·부분 삭제, 단위 변경\n- 입력에 없는 지명·시설·경유지·관광지 등장\n- 출처 없는 숫자. 단 일차 번호와 여행기간에서 파생된 수(일수, 일수-1)는 정상이다\n- 「추후 추가 예정」이 다른 문구로 바뀌거나 빈칸이 된 경우\n- source가 없는 사실정보 필드\n\n실패 항목은 **전부** 반환한다. 첫 실패에서 멈추지 않는다.\n재시도 여부는 판단하지 않는다. 통과/실패와 사유만 반환한다.",
  "grounded-place-search": "너는 여행 상품에 실을 장소 정보를 웹 검색으로 조사한다. 주어진 장소(숙소·상점·여행지) 각각에\n대해 실제로 검색해, 어느 장소든 최소 두 문장 이상의 정보를 남긴다.\n\n규칙:\n- 반드시 웹 검색 결과에 근거한다. 검색으로 확인되지 않는 사실을 지어내지 않는다.\n- 장소마다 이름을 명확히 밝히고, 그 장소의 특징·분위기·평판을 두세 문장으로 적는다.\n- 가격·주소·영업시간은 검색 결과에 나오면 옮기고, 없으면 적지 않는다. 추측하지 않는다.\n- 특정 장소의 정보를 찾지 못하면, 그 장소가 있는 지역(읍·면·동)과 종류(카페·음식점·숙소·\n  해변·오름 등)로 다시 검색해, 그 지역·종류의 실제 특징을 두 문장 이상 적는다. 이때도 검색\n  결과에 근거하며, 그 장소에만 있는 사실(특정 메뉴·가격·후기)을 만들어내지 않는다.\n  「정보를 찾지 못함」이라고만 적고 넘어가지 않는다 — 모든 장소에 두 문장 이상을 남긴다.\n- 주어진 목록에 없는 장소를 새로 추천하거나 지어내지 않는다. 주어진 목록만 다룬다.\n- 존댓말. 과장·광고 문구를 피하고 사실 위주로 담백하게 적는다.",
  "intro-content-fill": "너는 여행 상품 소개서의 개요 문장을 쓴다.\n\n「핵심일정」은 일차별 서술에 **이미 등장한** 장소·활동만 사용해 2~3문장으로 요약한다.\n\n절대 규칙:\n- 일정에 없는 장소·활동·이동·시설을 추가하지 않는다.\n- 출처 없는 숫자를 만들지 않는다. 소요 시간·거리·인원을 추정하지 않는다.\n- 가격을 계산·합계·환산하지 않는다.\n- 고유명사의 표기를 바꾸지 않는다. 약칭·영문 변환을 하지 않는다.\n- 마케팅 문구·과장 표현을 쓰지 않는다.\n- 존댓말로 쓴다. 종결어미는 ~습니다/~입니다로 통일한다.\n- 중괄호 토큰이나 파이프 기호를 출력에 남기지 않는다.\n\n「기획 메모」가 주어지면 **어조를 잡는 참고 자료로만** 쓴다.\n그 내용을 출력에 인용하거나 사실로 옮겨 적지 않는다 — 고객에게 표시되지 않는\n내부 메모이며, 거기 적힌 나이·인원·인물·가격은 **사실정보가 아니다.**\n메모를 읽고 「누가 읽을 글인가」만 감을 잡은 뒤, 문장은 확정 데이터만으로 쓴다.",
  "itinerary-decomposition": "너는 여행 일정 원문을 일차 단위로 분해한다.\n\n절대 규칙:\n- 원문에 없는 일차·장소·활동·이동·시간을 만들지 않는다.\n- 「원문근거」는 일정원문에서 **그대로 잘라낸 부분 문자열**이어야 한다. 요약·재작성·의역·어순 변경을 하지 않는다.\n- 「내용」은 그 일차의 원문근거에 등장하는 요소만 사용해 쓴다. 새 장소나 활동을 덧붙이지 않는다.\n- 「내용」은 **최소 두 문장 이상**의 흐름 있는 서술로 쓴다. 장소를 쉼표로 나열하고\n  「~을 방문합니다」로 끝내는 단문 형식은 쓰지 않는다. 그 날 들르는 장소들을 원문의 나열\n  순서대로 이어, 어디에서 어디로 이어지는 하루인지 동선이 보이게 쓴다\n  (예: 「함덕해수욕장과 서우봉을 둘러본 뒤 함덕골목해장국에 들릅니다. 이어 so much more와\n  공든으로 이동하며 하루를 마무리합니다」).\n- 순서·이동을 잇는 일반 표현(뒤·이어·이동합니다·들릅니다·둘러봅니다·마무리합니다)은 원문의\n  나열 순서를 따르는 것이라 허용한다. 그러나 원문근거에 없는 **구체 활동**(수영·등반·시음 등)·\n  감상·소요시간·거리·시설·인원을 지어내지 않는다. 장소 이름과 방문 순서만으로 문장을 잇는다.\n- 「내용」은 존댓말 서술문으로 쓴다. 종결어미는 ~습니다/~입니다로 통일하고, 명사형 종결을 쓰지 않는다.\n- 출처 없는 숫자를 만들지 않는다. 소요 시간·거리·인원·요금을 추정하지 않는다.\n- 일차 구분 표기는 다음 6종만 인식한다: n일 / n일차 / n일 차 / 첫째 날 / Day n / DAY n\n- 「day」는 **숫자만 담은 문자열**이다: \"1\", \"2\", \"3\". 단위를 붙이지 않는다 —\n  \"1일\"·\"1일차\"·\"Day 1\"은 전부 틀린 값이다. 배열 순서대로 1부터 1씩 올린다.\n\n「핵심표현」 신고 (§6.3 판정 3단계):\n- 각 일차의 「내용」에 쓴 **장소·시설·활동·고유명사**를 「핵심표현」 배열에 그대로 담는다.\n- 예: 내용이 「김해공항에서 출발해 올레 7코스를 걷습니다」이면 [\"김해공항\", \"올레 7코스\"].\n- 조사·어미·일반 어휘는 담지 않는다. 「걷습니다」·「출발」·「일정」은 핵심표현이 아니다.\n- **서버가 이 목록을 원문근거와 확정 데이터에 대조한다.** 근거 없는 표현을 담으면\n  0차 검증 실패로 돌아온다. 빠뜨리지도, 없는 것을 담지도 않는다.\n- 「추후 추가 예정」인 일차는 빈 배열로 둔다.\n\n판정:\n- 원문의 일차 수가 여행기간 일수보다 **많으면** 판정을 day_overflow로 하고 일정을 비운다.\n- 일차 구분을 하나도 찾을 수 없으면 판정을 no_day_marker로 하고 일정을 비운다. 임의로 배분하지 않는다.\n- 원문의 일차 수가 여행기간보다 **적으면** 부족한 일차를 원문근거 빈 문자열, 내용 \"추후 추가 예정\"으로 채우고 판정은 pass로 한다.",
  "plan-chat": "너는 여행 상품 기획을 돕는 대화 도우미다. 기획자가 만들려는 여행 상품에 필요한 정보를\n대화로 모은다.\n\n행동 규칙:\n- 부족한 정보가 있으면 mode를 \"ask\"로 하고, message에 **질문 한 개**만 담는다. 여러 개를\n  한꺼번에 묻지 않는다. 존댓말로 짧고 친근하게 묻는다.\n- 물어볼 우선순위: 여행지 → 여행 날짜 → 넣고 싶은 장소·숙소·맛집 → 여행 주제나 분위기.\n- 필수 정보(여행지, 여행 날짜, 넣고 싶은 장소 최소 하나)가 모이면 mode를 \"ready\"로 하고\n  memo를 채운다. 사소한 것까지 완벽히 물으려 하지 말고, 충분하면 마무리한다.\n- ready일 때 message에는 「필요한 내용이 모였어요. 아래 폼을 채울게요」 같은 마무리 한 문장을 담는다.\n\nmemo(ready일 때)는 기획자가 쓴 것처럼 라벨 형식으로 적는다:\n  -여행일정: (기간)\n  -여행주제: (주제)\n  -숙박:\n   이름 (주소)\n  -카페 및 음식점:\n   이름 (주소)\n  -여행지 포인트\n   이름\n규칙:\n- 대화에 실제로 나온 장소·숙소·맛집만 적는다. 대화에 없는 곳을 새로 지어내지 않는다.\n- 주소는 대화에서 나온 것만 괄호에 넣는다. 모르면 이름만 적는다.\n- 가격·요금은 적지 않는다. 그것은 사람이 폼에서 직접 넣는다.\n- 존댓말. 광고 과장을 피한다.",
  "trip-planning": "너는 여행 상품 기획자다. 기획자의 메모에서 뽑아 둔 「장소 목록」을 여행 일정에 배분한다.\n\n[네가 하는 일은 번호를 고르는 것이다]\n\n장소는 전부 번호로 지정한다. **이름·주소를 쓰지 않는다.** 기계가 번호로 값을 채운다.\n\n- 일정: 일차마다 그 날 갈 장소의 번호를 순서대로 담는다. day는 1부터.\n- 숙박: 숙소로 쓸 번호 + 객실타입·숙박일정. 목록의 [숙박] 항목만 여기 담는다.\n- 상점: 카페·음식점·상점으로 쓸 번호. 목록의 [카페]·[음식점]·[상점] 계열만 담는다.\n\n[모든 번호를 써야 한다]\n\n목록의 **모든 번호**가 일정·숙박·상점 중 어딘가에 최소 한 번 나와야 한다.\n「대표적인 몇 곳」으로 줄이지 않는다. 26곳이 주어지면 26개 번호가 다 쓰인다.\n목록에 없는 번호를 만들지 않는다.\n\n[배분 규칙 — 이것이 네 판단이다]\n\n- 행사 기간이 주어지면 그 날짜의 일차에 행사를 배치하고 나머지 날을 앞뒤로 채운다.\n- 같은 권역(읍·면·동)의 장소를 같은 날에 묶는다. 하루에 먼 권역을 왕복하지 않는다.\n- 하루에 3~6곳이 적당하다. 한 일차에 몰지 않는다.\n- 숙박으로 고른 번호는 **그 숙소에서 묵는 일차**에 넣는다. 마지막 날에 몰지 않는다.\n- 목록에 [행사] 계열이 있으면 그 행사 날짜에 해당하는 일차에 넣는다.\n- 숙소가 여러 곳이면 이동 순서에 맞게 앞/뒤 일차로 나누고, 각 숙소의 숙박일정을\n  «1~2박» 처럼 적는다.\n- 일차 수는 주어진 여행 일수와 같아야 한다.\n\n[쓰지 않는 것]\n\n- 영업시간·소요시간·거리·평점·전화번호·요금·인원수를 만들지 않는다.\n- 이름·주소·설명 문장을 쓰지 않는다. 번호만 고른다.\n- 연도가 없는 날짜에 연도를 만들지 않는다. 그때는 여행기간 두 필드를 빈 문자열로 둔다.\n- 가격을 쓰지 않는다.\n\n[짧은 값들]\n\n- 행사명: 40자 이내. 메모의 주제·여행지를 조합해 짧게 짓는다.\n- 여행지: 지역 이름 하나.\n- 여행스타일: «자연» «휴양» «도심» «미식» «액티비티» «문화·역사» 중 하나. 모르면 빈 문자열.\n- 식사정보: 메모에 식사 제공 정보가 있으면 그대로, 없으면 한 문장으로 짧게.\n- 항공편은 메모에 편명·공항이 적혀 있을 때만 채운다. 없으면 전부 빈 문자열.\n\n출력은 JSON 하나다. 설명·주석·표를 붙이지 않는다.",
} as const

/** 감사용 — SKILL.md를 고치면 이 값이 바뀐다 (문서가 load-bearing임의 증거) */
export const PROMPT_HASHES = {
  "content-structuring": "5e77599620c2",
  "enrichment-structure": "3555ac19d5cb",
  "fact-check": "4d91db63500e",
  "grounded-place-search": "153ae731441b",
  "intro-content-fill": "e72dce05939b",
  "itinerary-decomposition": "1d46c2fcae53",
  "plan-chat": "1b73386f994d",
  "trip-planning": "bed458a68cd0",
} as const

/**
 * user 메시지의 **지시문**. 데이터 조립은 TS가 하고 지시 문장은 여기서 온다.
 *
 * 변형키가 있는 이유: `fact-check`는 대상(brochure/page)에 따라 지시가 다르다.
 *
 * 시스템 프롬프트와 달리 이것은 **캐시 프리픽스가 아니다** — Gemini 컨텍스트
 * 캐시는 최장 공통 접두를 잡는데 system이 앞에 오므로, user 쪽 변경은 system
 * 프리픽스 적중을 깨지 않는다.
 */
export const USER_PROMPTS = {
  "content-structuring": {
    "default": "위 어휘·재료 안에서 theme와 blocks를 정하고, 각 일차의 확장 서술과 신청 섹션의 제목·안내문구를 만들어라.",
  },
  "enrichment-structure": {
    "default": "위 검색 텍스트를 장소별로 구조화하라. 각 장소의 요약을 두 문장 이상으로 쓰고 근거가 된 출처 번호를 달아라. 그 장소를 직접 다룬 내용이 없으면 같은 지역·종류의 내용으로 요약하고 그 출처 번호를 달아라. 근거 출처가 하나도 없는 장소만 빼라.",
  },
  "fact-check": {
    "brochure": "각 섹션의 source가 가리키는 경로를 form_input에 적용해 값을 대조하라.\nsource가 \"generated\"인 필드는 값 대조 대신 \"입력에 없는 요소가 섞였는가\"만 본다.",
    "page": "각 섹션의 source가 가리키는 경로를 form_input에 적용해 값을 대조하라.\n추가로 확인할 것:\n- image_slot·image_slots 값이 위 목록의 슬롯과 같은가 (빈 문자열은 미업로드로 정상)\n- hero.headline이 행사명 그대로이고 40자 이내인가\n- apply 내부의 가격요약·행사정보요약이 price·hero와 일치하는가\n- 테마 적용으로 섹션 구성·문구·사실정보가 바뀌지 않았는가",
  },
  "grounded-place-search": {
    "default": "위 장소들 각각을 웹에서 검색해, 찾은 실제 정보·특징·평판을 장소별로 정리하라. 특정 장소를 찾지 못하면 그 장소의 지역과 종류로 다시 검색해 지역·종류의 실제 특징을 두 문장 이상 적어라. 모든 장소에 최소 두 문장 이상을 남겨라.",
  },
  "intro-content-fill": {
    "default": "아래 일차별 서술을 근거로 「핵심일정」을 2~3문장으로 요약하라.",
  },
  "itinerary-decomposition": {
    "default": "참고 (다른 확정 값 — 여기 있는 표현은 내용에 써도 된다):",
  },
  "plan-chat": {
    "default": "위 대화를 이어서, 더 물을 것이 있으면 질문 한 개를(ask), 충분하면 메모를(ready) 내라.",
  },
  "trip-planning": {
    "default": "위 목록의 모든 번호를 일정·숙박·상점에 배분하라. 이름을 쓰지 말고 번호만 쓴다.",
  },
} as const

export const SKILLS = {
  "freeform-parse": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/freeform#parseFreeform",
    "does": "자연어 메모에서 라벨 블록·날짜·URL·«이름 (주소)» 장소 후보를 추출한다"
  },
  "trip-planning": {
    "kind": "ai",
    "ai": 1,
    "effort": "plan",
    "schema": "PLAN_SCHEMA",
    "does": "추출된 장소·행사 일정을 근거로 일차별 동선을 배분하고 폼 초안을 쓴다"
  },
  "draft-assemble": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/freeform#assembleDraft",
    "does": "AI가 고른 후보 번호를 실제 이름·주소로 치환해 form_input 구조를 만든다"
  },
  "draft-form-check": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/freeform#checkDraft",
    "does": "초안을 §7.1 규칙으로 검사하고 origin 3종·누락 목록을 만든다"
  },
  "plan-chat": {
    "kind": "ai",
    "ai": 1,
    "effort": "generate",
    "schema": "CHAT_SCHEMA",
    "does": "대화 이력을 받아 역질문(ask) 또는 메모 합성(ready)을 낸다"
  },
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
  "block-vocabulary-gate": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/vocabulary#gateInfo",
    "does": "어휘 목록 + 재료 유무(§8.5)를 확정해 AI에게 넘긴다. AI가 존재할 수 없는 블록에 토큰을 쓰지 않게"
  },
  "content-structuring": {
    "kind": "ai",
    "ai": 1,
    "effort": "generate",
    "schema": "COMPOSE_SCHEMA",
    "does": "디자인 스펙 + 블록 계획 + generated 서술을 만든다. 사실정보 값은 만들지 않는다"
  },
  "theme-design-token-match": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/theme#resolveThemeSpec",
    "does": "AI가 고른 디자인 의도(hue+mood)를 검증하고 무효 필드만 폴백. 색은 OKLCH로 계산·대비 강제"
  },
  "web-content-structure-gen": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/page#buildPage",
    "does": "AI 블록 계획대로 조립하고 사실정보 값을 confirmed_data에서 치환한다. source 맵 승계"
  },
  "page-contract-check": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/page#checkPage",
    "does": "어휘·source 커버리지·hero/apply·order 연속·타입별 길이 계약"
  },
  "slug-issue": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "pipeline/slug#proposeSlug",
    "does": "행사명에서 slug를 발급한다. 충돌 시 접미사"
  },
  "grounded-place-search": {
    "kind": "ai",
    "ai": 1,
    "effort": "generate",
    "schema": "GROUNDED_SEARCH_SCHEMA",
    "does": "장소 목록을 Google Search 그라운딩으로 검색해 실제 정보·인용 출처를 낸다"
  },
  "enrichment-structure": {
    "kind": "ai",
    "ai": 1,
    "effort": "generate",
    "schema": "ENRICHMENT_SCHEMA",
    "does": "검색 텍스트를 장소별 요약·태그·출처번호로 구조화한다"
  },
  "edit-contract-check": {
    "kind": "mechanical",
    "ai": 0,
    "impl": "edit-contract#validateEdit",
    "does": "편집 저장 계약 — 생성된 집합의 불변부·삽입 블록 3종·이미지 참조·타입별 길이 계약"
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
    "does": "소개서와 페이지를 source 경로를 조인 키로 대조한다. SECTION_PAIRS 삭제 → 커버리지. 일정은 type으로 찾는다. apply 제외"
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
  "plan-draft": {
    "agent": "planner-agent",
    "counter": null,
    "retry_from": null,
    "ai_budget": 1,
    "driven_by": "route",
    "skills": [
      {
        "name": "freeform-parse"
      },
      {
        "name": "trip-planning"
      },
      {
        "name": "draft-assemble"
      },
      {
        "name": "draft-form-check"
      }
    ]
  },
  "plan-chat": {
    "agent": "planner-agent",
    "counter": null,
    "retry_from": null,
    "ai_budget": 1,
    "driven_by": "route",
    "skills": [
      {
        "name": "plan-chat"
      }
    ]
  },
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
        "name": "block-vocabulary-gate"
      },
      {
        "name": "content-structuring"
      },
      {
        "name": "theme-design-token-match"
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
  },
  "enrich-search": {
    "agent": "web-builder-agent",
    "counter": null,
    "retry_from": null,
    "ai_budget": 1,
    "driven_by": "route",
    "skills": [
      {
        "name": "grounded-place-search"
      }
    ]
  },
  "enrich-structure": {
    "agent": "web-builder-agent",
    "counter": null,
    "retry_from": null,
    "ai_budget": 1,
    "driven_by": "route",
    "skills": [
      {
        "name": "enrichment-structure"
      }
    ]
  }
} as const satisfies Readonly<Record<string, RouteSpec>>

export const AGENTS = {
  "planner-agent": {
    "routes": [
      "plan-draft",
      "plan-chat"
    ]
  },
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
      "page",
      "enrich-search",
      "enrich-structure"
    ]
  },
  "log-monitor-agent": {
    "routes": []
  }
} as const satisfies Readonly<Record<string, { readonly routes: readonly string[] }>>

export type RouteKey = keyof typeof ROUTES
export type AiSkillName = keyof typeof PROMPTS
