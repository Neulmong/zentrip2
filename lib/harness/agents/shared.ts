import { ERROR_LABEL } from '@/lib/ai'
import type { ValidationItem } from '@/lib/types'
import type { AiFailure } from '../context'

/**
 * 에이전트 공용 — **AI 실패 1건을 검증 항목으로 옮긴다.**
 *
 * §4.3의 실패 6종을 구분해 다루지 않는다. 전부 「생성 실패」이고 카운터를
 * 올려 409 retry로 간다. 원인 구분은 `execution_logs.output`에만 남는다.
 */
export function 생성실패(f: AiFailure, 기준값: string, 위치: string): ValidationItem {
  return {
    검증영역: '생성', source경로: null, 기준값,
    발견값: f.errorType, 사유: ERROR_LABEL[f.errorType], 위치,
  }
}

/** 계약 검사·유출 검사의 사유 여러 건을 한 항목으로 묶는다 */
export function 계약실패(errors: string[], 기준값: string, 위치: string): ValidationItem {
  return {
    검증영역: '생성', source경로: null, 기준값,
    발견값: errors[0], 사유: errors.join(' / '), 위치,
  }
}

export { ERROR_LABEL }
