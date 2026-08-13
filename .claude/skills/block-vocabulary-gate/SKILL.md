---
name: block-vocabulary-gate
description: 페이지 구성 전에 어휘 목록과 재료 유무를 확정해 AI에게 넘긴다. 재료가 없는 블록(항공 미이용·0행)을 「만들지 마라」로 표시하고 spotlight가 참조할 수 있는 숙박·상점 인덱스를 목록으로 만든다. 값을 생성하지 않는다.
---

## 단일 기능

`confirmed_data`를 보고 **AI가 쓸 수 있는 블록 어휘와 그 재료 유무**를 확정한다.
`content-structuring`(AI)이 이 요약을 받아 **존재할 수 없는 블록에 토큰을 쓰지 않는다**
(명령서 ⑥). 값을 만들지 않고 판단도 하지 않는다 — `confirmed_data` 조회다.

## 배선

`manifest.json`이 유일한 출처다. 요약: `web-builder-agent` · `page` 체인 **1번(맨 처음 · AI 앞)** ·
**AI 0회** · `impl: pipeline/vocabulary#gateInfo`.

어휘·타입별 layout·타입별 재료 대응은 `lib/pipeline/vocabulary.ts`가 단일 출처다.
이 스킬은 그 표를 `confirmed_data`에 대고 「available / unavailable / spotlightRefs」로 요약한다.

- 실행 시점: 페이지 생성 1회당 1회
- 실행하지 않는 경우: 소개서 생성(라우트 ③) · 편집기(§10.2)

## 입력

| 항목 | 형식 | 설명 |
|---|---|---|
| `confirmed_data` | object | 재료 유무의 근거 |

## 출력 (`GateInfo`)

| 항목 | 형식 | 설명 |
|---|---|---|
| `available` | array of string | AI가 쓸 수 있는 블록 type |
| `unavailable` | array of string | 재료가 없어 만들면 안 되는 type (§8.5) |
| `spotlightRefs` | array of string | spotlight가 참조 가능한 대상 (`숙박[0]` 등) |

## 재료 유무 규칙 (§8.5)

| 블록 | 재료 없음 판정 |
|---|---|
| `flight` | 항공 5필드가 모두 `해당 없음` |
| `meal` | `식사.식사정보`가 `해당 없음` |
| `accommodation` | `숙박` 0행 |
| `shop` | `상점` 0행 |

`추후 추가 예정`은 **재료 있음**이다 — 페이지에 남아 기획자가 빈칸을 알아차려야 한다(§8.5).

## 금지 사항

- AI를 호출하지 않는다.
- `confirmed_data`를 수정하지 않는다.
- 「항공편이 비었으니 없는 여행일 것」이라고 **단정하지 않는다.** 값이 `해당 없음`일 때만
  재료 없음으로 본다 — 자동 추론은 §16.1 위반이다(§8.5).

## 하네스 계약

`asserts` 없음. 반환값(`GateInfo`)은 자료 버스(`c.gate`)에 실려 `content-structuring`이 읽는다.
