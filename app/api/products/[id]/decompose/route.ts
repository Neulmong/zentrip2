import type { NextRequest } from 'next/server'
import { readUpdatedAt, runStep } from '@/lib/orchestrator'
import { ai, toLogOutput, ERROR_LABEL } from '@/lib/ai'
import { withAxis, passedAxis, failedAxis } from '@/lib/validation'
import { tripDays } from '@/lib/form-validation'
import { buildConfirmedData, PLACEHOLDER, type ConfirmedData } from '@/lib/pipeline/normalize'
import { checkDayCount, checkEvidence, checkNormalization, checkNouns } from '@/lib/pipeline/axis0'
import {
  DECOMPOSE_SCHEMA, DECOMPOSE_SYSTEM, type DecomposeResult,
} from '@/lib/pipeline/ai-contracts'
import type { ValidationItem } from '@/lib/types'

export const maxDuration = 60

/**
 * Step 02 — 정규화 · 일차 분해 · 0차 검증 (§8.2). **AI 1회.**
 *
 *   ① 선택 항목 채움 + 정규화 3종 + 결합 1종 (기계)
 *   ② 일정 원문 일차 분해 (AI 1회 — 이 요청의 유일한 호출)
 *   ③ 0차 검증 (기계 중심 — 추가 AI 호출을 하지 않는다)
 *
 * 실패 갈래가 둘이다: **입력 문제**(일차 초과·구분 불가·0차 소진)는 422이고,
 * **생성 문제**(0차 실패 + 여력)는 409 retry_from:2다.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const clientUpdatedAt = await readUpdatedAt(req)

  return runStep(
    { route: 'decompose', step: 'normalization_validated', extraSteps: ['itinerary_decomposed'],
      productId: id, clientUpdatedAt },
    async (p) => {
      const fi = p.form_input
      const days = tripDays(fi.행사정보.여행기간_시작, fi.행사정보.여행기간_종료) ?? 0

      // ── ① 기계 처리 ─────────────────────────────────────────
      const { data: cd, changes } = buildConfirmedData(fi)

      // ── ② 일차 분해 (AI 1회) ────────────────────────────────
      const res = await ai().call<DecomposeResult>({
        system: DECOMPOSE_SYSTEM,
        user: `여행기간 일수: ${days}일\n\n일정원문:\n${cd.행사정보.일정원문}\n\n`
          + `참고 (다른 확정 값 — 여기 있는 표현은 내용에 써도 된다):\n`
          + JSON.stringify({ 식사: cd.식사, 숙박: cd.숙박, 상점: cd.상점 }, null, 2),
        schema: DECOMPOSE_SCHEMA,
        effort: 'generate',
        label: 'itinerary-decomposition',
      })

      if (!res.ok) {
        return {
          type: 'fail', counter: 'normalization', retryFrom: 2,
          items: [{
            검증영역: '생성', source경로: null, 기준값: '일차 분해 결과',
            발견값: res.errorType, 사유: ERROR_LABEL[res.errorType], 위치: 'confirmed_data.행사정보.일정',
          }],
          retryAfterMs: res.retryAfterMs,
          exhausted: {
            patch: { status: 'input_error', failure_reason: `일정 분해에 반복 실패했습니다. ${ERROR_LABEL[res.errorType]}` },
            body: { current_step: p.current_step, failure_reason: '일정 분해 실패' },
            detail: '0차 재시도 소진으로 input_error 확정',
          },
          logOutput: toLogOutput(res),
        }
      }

      // 분해 실패 — 입력 문제다. 카운터를 쓰지 않고 바로 422(§8.2 5항).
      if (res.data.판정 === 'day_overflow') {
        return {
          type: 'input_error',
          failure_reason: `일정에 적힌 일차 수가 여행기간(${days}일)보다 많습니다. `
            + '일정의 일수와 여행기간이 같아야 합니다. '
            + "입력 화면에서 '여행기간' 또는 '일정 > 일정 원문'을 맞춘 뒤 다시 제출해 주세요.",
          logOutput: toLogOutput(res),
        }
      }
      if (res.data.판정 === 'no_day_marker') {
        return {
          type: 'input_error',
          failure_reason: '일정에서 일차 구분을 찾을 수 없습니다. '
            + '어느 내용이 몇 일차인지 알 수 없으면 일정을 임의로 나눌 수 없습니다. '
            + "입력 화면에서 '일정 > 일정 원문'에 '1일:', '2일:'처럼 일차 구분을 넣어 다시 제출해 주세요.",
          logOutput: toLogOutput(res),
        }
      }

      const confirmed: ConfirmedData = {
        ...cd,
        행사정보: { ...cd.행사정보, 일정: res.data.일정 },
      }

      // ── ③ 0차 검증 (기계) ───────────────────────────────────
      const items: ValidationItem[] = [
        ...checkNormalization(fi, confirmed),
        ...checkDayCount(confirmed, days),
        ...checkEvidence(confirmed),
      ]

      // 명사구 후보 — 원문근거에도 다른 확정 값에도 없는 것은 창작이다(§6.3).
      // 조사·어미 변화는 extractNouns가 이미 벗겨냈고, 복합어 분해를 감안해
      // 2자 접두 일치까지 허용한다.
      const nouns = checkNouns(confirmed)
      const haystack = JSON.stringify(confirmed)
      for (const n of nouns) {
        if (n.근거존재 || haystack.includes(n.후보.slice(0, 2))) continue
        items.push({
          검증영역: '입력 외 고유명사', source경로: '행사정보.일정',
          기준값: '(원문근거 또는 확정 데이터표의 값)', 발견값: n.후보,
          사유: `${n.day}일차 서술의 «${n.후보}»가 입력 어디에도 없습니다.`,
          위치: `confirmed_data.행사정보.일정[${n.day}].내용`,
        })
      }

      const partialDays = confirmed.행사정보.일정
        .filter((d) => d.내용 === PLACEHOLDER).map((d) => d.day)

      if (items.length > 0) {
        return {
          type: 'fail', counter: 'normalization', retryFrom: 2, items,
          exhausted: {
            patch: {
              status: 'input_error',
              failure_reason: '정규화·일차 분해가 반복 실패했습니다. '
                + '입력에 처리할 수 없는 요소가 있는지 확인한 뒤 다시 제출해 주세요.',
              validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_0',
                failedAxis(items[0])),
            },
            body: { current_step: p.current_step, axes: { axis_0: 'fail' as const }, items },
            detail: '0차 재시도 소진으로 input_error 확정 (§15.2)',
          },
          logOutput: { ...toLogOutput(res), items, changes },
        }
      }

      return {
        type: 'ok',
        patch: {
          confirmed_data: confirmed,
          current_step: 'normalization_validated',
          validation_snapshot: withAxis(p.validation_snapshot, p.attempt_no, 'axis_0', passedAxis()),
        },
        body: { current_step: 'normalization_validated', axes: { axis_0: 'pass' } },
        logOutput: { ...toLogOutput(res), changes, 부분채움: partialDays },
      }
    },
  )
}
