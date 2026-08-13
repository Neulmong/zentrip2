# 하네스 스킬·에이전트 지도 — 무엇이 돌고 무엇이 안 도나

> **왜 이 문서가 있나.** `.claude/skills/`에는 32개 스킬이 있지만 그중 **4개는 체인에서
> 실행되지 않는다.** 이걸 모르면 "죽은 코드"로 오해해 지우게 되고, 그러면 `npm run
> test:harness`가 깨지거나(선언 누락) 런타임 문서가 사라진다. 이 문서는 **무엇이 실제로
> 돌고(28개), 무엇이 설명서 역할만 하는지(4개)** 를 한눈에 정리한다. 배선의 유일한 권위는
> 여전히 `.claude/harness/manifest.json`이다 — 이 문서는 그것을 사람이 읽게 풀어 둔 것이다.

## 비유

- **에이전트** = 라인 담당 반장, **스킬** = 개별 작업 공정, **체인** = 공정을 잇는 컨베이어.
- 라우트(서버 API) 1건이 반장 1명을 부르고, 반장이 자기 공정을 **선언된 순서대로** 돌린다.
- 라우트당 **AI 호출은 최대 1회**(절대원칙 1). 나머지 공정은 AI 없이 도는 기계 작업이다.

---

## ① 실제로 돌아가는 스킬 (28개) — 라우트별

| 라우트 | 담당 에이전트 | 스킬 체인 (순서) |
|---|---|---|
| `plan-draft` | planner-agent | freeform-parse · **trip-planning**(AI) · draft-assemble · draft-form-check |
| `plan-chat` | planner-agent | **plan-chat**(AI) |
| `products` · `form-input` | intake-agent | input-guard |
| `decompose` | intake-agent | optional-field-fill · data-normalization · **itinerary-decomposition**(AI) · axis0-verification |
| `brochure` | content-writer-agent | **intro-content-fill**(AI) · intro-template-writer · tonal-manner-apply · brochure-contract-check · memo-leak-check |
| `validate-brochure` | validator-agent | **fact-check**(AI) |
| `page` | web-builder-agent | block-vocabulary-gate · **content-structuring**(AI) · theme-design-token-match · web-content-structure-gen · page-contract-check · memo-leak-check · slug-issue |
| `validate-page` | validator-agent | **fact-check**(AI) |
| `validate-consistency` | validator-agent | consistency-check |
| `enrich-search` | web-builder-agent | **grounded-place-search**(AI · 웹 검색) |
| `enrich-structure` | web-builder-agent | **enrichment-structure**(AI) |
| `content` (편집 저장) | (없음) | edit-contract-check · edit-history-diff |
| `slug` (주소 변경) | (없음) | slug-format-check |

**(AI)** 표시가 AI를 부르는 공정이다 — 라우트마다 정확히 1개 이하다.

---

## ② 일부러 안 돌리는 스킬 (4개) — `kind: spec` = 설명서

이 4개는 **실제 동작이 일반 코드에 있고**, 스킬 문서는 그 동작을 *설명*만 한다.
체인에 넣으면 **로그가 두 번 쌓이거나 상태가 두 번 바뀌는 버그**가 나므로 뺐다(규약 R7).
**지우면 안 된다** — `test:harness`가 선언을 요구하고, 이 문서들이 런타임의 유일한 설명이다.

| 스킬 | 무엇을 설명하나 | 실제 동작은 어디에 |
|---|---|---|
| `product-orchestrator` | 작업 순서·재시도·응답코드 결정 | `lib/orchestrator.ts` (`runStep`) — 매 요청 실행 |
| `execution-log-collection` | 단계별 실행 기록 남기기 | `lib/logging.ts` — 매 단계 실행 |
| `abnormality-detection` | 이상 징후 5종 감지 | `lib/logging.ts` · `lib/policy.ts` |
| `draft-registration` | 검증 끝난 상품을 비공개(draft) 등록 | 상태 전이 (라우트/오케스트레이터) |

## ③ 에이전트 (6명)

- **체인을 도는 반장 5명**: planner · intake · content-writer · validator · web-builder.
- **기록원 1명 `log-monitor-agent`**: 컨베이어에 올리지 않는다. **매 공정이 끝날 때마다**
  따로 불려 실행 기록(`execution-log-collection`)과 이상 감지(`abnormality-detection`)를
  담당한다. `routes=[]`(직접 맡는 라우트 없음)인 이유가 이것이다.

---

## 확인 방법

```bash
npm run test:harness   # 위 배선이 규칙대로 연결됐는지 (선언·순서·예산·spec 분리)
npm run test:real      # 실제로 반장→공정이 끝까지 돌아 완성품이 나오는지 (엔드투엔드)
```

`test:harness`는 **spec 스킬이 체인에 섞이면 실패**한다(§ "kind:spec 스킬을 체인에서
실행하면 로그가 두 번 쌓인다"). 그러니 이 4개를 실수로 체인에 넣으면 검사가 잡아 준다.
