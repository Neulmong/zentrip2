# AI 기획자 전환 설계 (planner-pivot)

> **상태: 설계 확정 대기.** 2026-08-13. 이 문서가 확정되면 골격 착수(스킬 제거·신설·manifest 재배선·spec 절대원칙 재작성)의 근거가 된다.
> 권위는 여전히 `spec.md`가 갖는다 — 이 문서는 전환의 **설계 근거**이고, 규정은 spec 재작성으로 옮겨간다.

## 0. 무엇이 뒤집히나

| | 이전 (2.8까지) | 이후 (planner) |
|---|---|---|
| AI의 역할 | 값 치환·형식 통일. **주관/창작 금지** | 웹 검색으로 **직접 기획**. 숙소·상점·장소·일정·가격·타겟·주제를 AI가 정한다 |
| 사람 입력 | 상세 폼(일정·숙소·가격·타겟…) | **한 줄 자연어 소원** ("제주 감성 커플여행") |
| 정답 기준 | `form_input`(사람이 준 사실) | 없음. AI가 만든다 |
| 검증 | "입력과 일치하나" (4축) | **"AI 추천이 실제 존재하나"** (grounding 출처 대조) |
| 웹 검색 | 없음 | **Gemini Google Search 그라운딩** (`@google/genai` 내장) |

## 1. 핵심 원칙 — 사실 vs 주관 분리

전환의 심장. AI 산출물을 두 종류로 나눠 검증을 다르게 건다.

| 종류 | 항목 | 검증 |
|---|---|---|
| **사실 항목** | 숙소·연계상점·여행장소·주소·실제 영업/가격 정보 | `groundingMetadata`의 인용 출처에 근거해야 통과. 근거 없으면 실패(환각 방지) |
| **주관 항목** | 타겟층·여행주제·추천 동선·**예상**가격·분위기·문구 | 실존 검사 없음. 형식/타당성만. **여기서만 "AI 주관"을 푼다** |

- `source` 맵의 의미가 바뀐다: *"값 → 원문근거"* → *"사실 항목 값 → 인용 출처 URL"*.
- 데모의 **4축 검증 배지** → **"출처 검증 배지"**로 살린다(재시도·로그·pass/fail 구조 재활용).

## 2. 새 파이프라인 (라우트)

```
[한 줄 소원]
   │
   ▼
① wish        소원으로 상품 행 생성 (AI 0 · wish-guard)
   ▼
② plan        Google Search 그라운딩으로 전체 기획 생성 (AI 1)
              → 숙소[]·상점[]·장소[]·일정[]·가격·타겟·주제
                각 사실 항목에 grounding 출처 URL 부착
   ▼
③ verify      사실 항목이 grounding 출처에 근거하는지 대조 (실존성 검증)
   ▼
④ page        기획을 페이지로 조립 (값 치환원이 form_input → plan 으로 바뀜)
   ▼
⑤ validate-page   페이지 구조 계약 + 출처 커버리지
   ▼
[게시]
```

- 편집 라우트(`content`·`slug`)와 게시/신청/로그는 **그대로 유지**한다 — 전환의 영향 밖이다.
- 소개서(brochure) 단계는 통합 검토: `plan`이 이미 서술을 만드므로 별도 소개서 생성 라우트는 없앨 수 있다(추후 결정).

## 3. 스킬 처분표 (골격 착수의 실행 목록)

### 🔴 제거 — 전제("입력이 정답")가 사라져 의미 없음
| 스킬 | 이유 |
|---|---|
| `input-guard` | 필수 폼 6그룹 관문 → 소원 한 줄이라 대상 없음. `wish-guard`로 대체 |
| `data-normalization`·`optional-field-fill` | 정규화할 상세 폼이 없음 |
| `itinerary-decomposition` | 사람 일정을 분해+원문근거 → AI가 일정을 **창작**하므로 반대 |
| `axis0-verification` | 원문근거 포함·명사구 근거 검사 → 원문근거 개념 폐기 |
| `tonal-manner-apply` | confirmed_data와 바이트 동일 검사 → 정답 기준 없음 |
| `memo-leak-check` | 기획메모 숫자 유출 검사 → 기획메모 없음 |
| `freeform-parse`·`draft-assemble`·`draft-form-check` | 메모에서 후보 추출·번호 치환·누락 대조 → 정답 목록 개념 폐기 |

### 🟡 재활용 — 방향을 뒤집어 재사용
| 스킬 | 변경 |
|---|---|
| `fact-check` | "form_input과 일치" → **"grounding 출처에 근거"** (existence-verify). `source` 맵을 출처 URL 맵으로 |
| `consistency-check` | 소개서 vs 페이지 → 페이지 내부 사실 항목 정합(또는 폐기) |
| `trip-planning` | 추출 장소 배분 → **그라운딩 기반 전체 기획**의 씨앗(→ 신설 `grounded-plan`으로 확장) |

### 🟢 신설
| 스킬 | kind | 하는 일 |
|---|---|---|
| `wish-guard` | mechanical | 소원이 비어있지 않은지·길이 관문 |
| `grounded-plan` | **ai** | googleSearch 도구로 검색+기획. 사실 항목에 출처 URL 부착 |
| `existence-verify` | ai/mechanical | 사실 항목이 grounding 출처에 실재하는지 대조. 주관 항목은 형식만 |

### ⚪ 유지 — 전환 영향 밖
`slug-issue`·`slug-format-check`·`theme-design-token-match`·`block-vocabulary-gate`·`content-structuring`·`web-content-structure-gen`·`page-contract-check`·`edit-contract-check`·`edit-history-diff`·`draft-registration`·spec 스킬 4종(orchestrator·logging·abnormality). *단 `page`·`content-structuring` 계열은 값 치환원이 `confirmed_data` → `plan`으로 바뀌므로 impl 수정 필요.*

## 4. spec 절대원칙 재작성 (권위 이관)

| 원칙 | 이전 | 이후 |
|---|---|---|
| 3. JSON 스키마 강제 | responseSchema | 유지 + **googleSearch 도구 병행** |
| 4. 검증 기준값 = form_input | — | **폐기.** 기준값 없음. 검증은 grounding 출처 |
| 6. source 맵 필수 | 모든 사실 필드 | **사실 항목**만. 값→출처 URL. 주관 항목은 source 불필요 |
| 7. 입력에 없는 값 생성 금지 | 전면 금지 | **사실 항목은 grounding 범위 안에서만**, 주관 항목은 자유 창작 |
| 1. 1요청 1AI호출 | 유지 | 유지(그라운딩은 그 1회 **안**에서 일어남 — 지연 증가 실측 필요) |

하네스 규약 R3(mechanical 기본): `grounded-plan`·`existence-verify`가 ai인 근거를 각 SKILL.md에 적는다.

## 5. 열린 문제 (착수 중 실측/결정)

1. ~~**grounding 지연.**~~ **✅ 실측 완료 (2026-08-13 · `scripts/probe-grounding.mts`).**
   - flash-lite는 `googleSearch`를 **지원한다** — 5.4초(소규모 입력), 실제 출처 2건 인용, 실존 장소 반환. 지연은 55초 예산 안.
   - ⚠️ **`googleSearch` + `responseSchema`는 병용 불가.** 동시에 걸면 JSON은 나오지만 `groundingMetadata`가 **비어** 나온다(출처 0건 = 검색 사실상 꺼짐). 스키마 강제 JSON이 **출처 없이** 나오므로 실존 검증이 불가능하다 — 절대원칙 3(JSON 강제)과 그라운딩을 **한 호출에서 함께 만족시킬 수 없다.**
   - **따라서 「검색해서 기획」은 한 호출로 못 한다.** 두 갈래:
     - **A(권장·2호출).** ⓐ 그라운딩만(responseSchema 없음) → 자유 텍스트 + `groundingMetadata`의 출처 URL 확보. ⓑ 그라운딩 없이 responseSchema로 ⓐ의 텍스트를 **구조화만** 하고 ⓐ의 출처 URL을 `source`로 실어 나른다. 각 라우트 AI 1회(절대원칙 1 유지), 스키마 강제도 구조화 호출에서 유지.
     - **B(1호출).** 그라운딩만 걸고 responseSchema 없이 「JSON을 텍스트로 내라」 → `lib/ai/schema.ts` 서버 검증(방어층)으로만 강제. 절대원칙 3의 제공자 강제가 빠지는 약화를 문서화해야 한다.
2. **주관 항목 타당성 검사**를 어디까지 기계화할지(가격 범위·일수 일치 등).
3. **소개서 단계 존치 여부.**
4. **데모(2026-08-14) 리스크.** 이 전환은 현재 관통 경로를 깬다 — 데모 연기 또는 현재 경로 병존 여부.

## 6. 착수 순서 (R5·R6 규율)

1. 이 설계 확정
2. spec.md 절대원칙·§4·§8·§11 재작성 (권위 먼저)
3. `manifest.json` 재배선 (제거/신설/재활용 반영)
4. 신설 SKILL.md 작성 + 제거 스킬 삭제
5. `lib/ai/gemini.ts`·`ai-contracts.ts`에 googleSearch 도구 + grounding 스키마
6. impl 수정 (`pipeline/*` — 값 치환원 교체)
7. `npm run build:harness && test:harness && test:policy` 초록 유지 (테스트도 새 계약으로 재작성)

---

## 7. 좁은 변형 — place-enrichment (전면 pivot 대신, Option A · 2026-08-13 착수)

전면 pivot(§0~§6)은 입력 모델 전체를 「한 줄 소원」으로 바꾸고 현재 관통 경로를 깬다.
**사용자가 실제로 원한 것은 더 좁다:** 기획자가 이미 입력한 장소(숙소·상점·여행장소)에
**실제 웹 리뷰·정보를 출처와 함께 덧붙여** 페이지를 풍부하게 만드는 것. 입력 모델·검증
4축·관통 경로는 **그대로 두고**, page 생성 뒤에 **선택적 enrichment 단계**를 얹는다.

### 7.0 ✅ 완료 — AI 계층 그라운딩 (2026-08-13)

`lib/ai/contract.ts`·`gemini.ts`에 그라운딩을 **가산적으로** 넣었다(기존 호출 무영향):
- `AiRequest.grounding?: boolean` — true면 provider가 `tools:[{googleSearch:{}}]`를 걸고
  `responseSchema`를 **빼며**(병용 불가), 출력은 자유 텍스트, 인용 출처를 함께 반환.
- `AiResult.sources?: GroundingSource[]` · `GroundingSource {title, uri}`.
- 게이트 초록 유지(tsc·lint·harness 185/0·policy 316/0). **이 계층이 나머지 전부의 토대다.**

### 7.1 스테이지드 — **대부분 구현됨 (2026-08-13)**

| # | 단계 | 상태 |
|---|---|---|
| A | spec §8.8 확장 (웹 출처 유형) | ⬜ **남음** — `.claude/`(manifest·skill·agent)·이 문서가 규정을 담고 있으나 `spec.md` 본문 반영은 아직. 기능엔 영향 없음 |
| B | 새 라우트 2개 `enrich-search`→`enrich-structure` | ✅ **상태 기계 밖**(`driven_by:route`)으로 구현 — R7 영역을 안 건드렸다. `runStep`·재개표·409 경로 무변경. `lib/harness/enrichment.ts`가 체인을 돌린다 |
| C | 새 AI 스킬 2개 + SKILL.md + 스키마 + manifest | ✅ `grounded-place-search`(grounding)·`enrichment-structure`(schema). `GROUNDED_SEARCH_SCHEMA`·`ENRICHMENT_SCHEMA` |
| D | 실존 대조 (출처 없는 값 탈락) | ✅ `assembleEnrichment`(기계) — 출처번호가 실제 `sources`를 못 가리키거나 targets에 없는 이름이면 버린다. 단위 검사로 확인 |
| E | 렌더러 + 출처 배지 | ✅ `components/page/enrichment.tsx` — 장소 카드 + 인용 링크. `PageRenderer`가 apply 앞에 그린다. `page_content.enrichment`(sections 밖)라 `checkPage` 무영향 |
| F | 저장 위치 | ✅ `page_content.enrichment`(sibling 키) — **DB 마이그레이션 없음**. checkPage/편집 계약 무영향 |
| G | 테스트·실측 | 🟡 게이트 초록(tsc·lint·harness 201/0·policy 316/0·build). **live AI grounding + DB 쓰기 실측은 미실행**(키·서버 필요) |

**남은 것:** ① `spec.md` §8.8 본문에 웹 출처 유형 공식 반영(A) ② `npm run dev` + 실 키로
enrich 버튼 관통 실측(G). 나머지는 구현·검증 완료. B를 상태 기계 밖에 둔 덕에 관통 경로가 안 깨졌다.
