import type { PageContent } from '@/lib/pipeline/page'

/**
 * 렌더링 검증용 고정 데이터 (§17.1).
 *
 * §17.1은 「9종 섹션 컴포넌트 + 삽입 블록 3종을 개발 단계에서 375/768/1280px에
 * 대해 1회 검증하고 결과를 문서화한다」를 요구한다. 실제 상품 데이터로는
 * 12종을 한 화면에 모을 수 없으므로(삽입 블록은 편집기를 거쳐야 생긴다)
 * **12종이 전부 등장하는 고정 데이터**를 둔다.
 *
 * 값은 최악 조건에 맞춰 골랐다 — 검증은 평균이 아니라 경계에서 깨진다.
 *   · `hero.headline` 40자 / `hero.subcopy` 80자 / 일차 서술 200자 (§17.1 상한값)
 *   · `추후 추가 예정` · `해당 없음` 표기 (§6.1)
 *   · 공백 없는 긴 URL·영문 (줄바꿈이 안 되면 가로 스크롤이 생긴다)
 *   · 항공 5열 표 (375px에서 자체 가로 스크롤이 되는지)
 *
 * 이 파일은 순수 데이터다. 프로덕션 코드가 import하지 않는다.
 */

/** 정확히 40자 — `hero.headline` 상한 (§17.1) */
const HEADLINE_40 = '제주 올레길 걷기와 오름 트레킹 사려니숲 4일 여정입니다'

/** 정확히 80자 — `hero.subcopy` 상한 */
const SUBCOPY_80 =
  '2026-03-14 ~ 2026-03-17 · 3박 4일 · 제주 서귀포 일원 · 성인 890,000원 · 소규모 진행'

/** 정확히 200자 — 일차별 서술 상한 */
const DAY_TEXT_200 =
  '김포공항에서 출발해 제주공항에 도착한 뒤 렌터카를 인수하고 서귀포 방면으로 이동합니다. '
  + '숙소에 짐을 맡긴 다음 올레 7코스의 외돌개 구간을 천천히 걸으며 해안 절경을 감상하고, '
  + '저녁에는 근처 항구에서 제철 회를 곁들인 식사를 하며 첫날 일정을 마무리합니다 다음날에'

export const FIXTURE_PAGE: PageContent = {
  schema_version: '1.0',
  theme: 'nature',
  sections: [
    {
      id: 'sec_hero', type: 'hero', order: 1, visible: true, locked: true,
      data: { headline: HEADLINE_40, subcopy: SUBCOPY_80, image_slot: '' },
      source: { headline: '행사정보.행사명', subcopy: '행사정보.여행기간' },
    },
    {
      id: 'sec_summary', type: 'summary', order: 2, visible: true, locked: false,
      data: {
        여행기간: '2026-03-14 ~ 2026-03-17 (3박 4일)',
        여행지: '제주특별자치도 서귀포시 일원',
        타겟층: '30~50대 도보 여행에 관심 있는 소규모 그룹',
        여행스타일: '자연',
      },
      source: {
        여행기간: '행사정보.여행기간', 여행지: '행사정보.여행지',
        타겟층: '행사정보.타겟층', 여행스타일: '행사정보.여행스타일',
      },
    },
    {
      id: 'sec_itinerary', type: 'itinerary', order: 3, visible: true, locked: false,
      data: {
        days: [
          { day: '1', text: DAY_TEXT_200, image_slot: '' },
          { day: '2', text: '사려니숲길을 걷고 오후에는 성산일출봉 일대를 둘러봅니다.', image_slot: '' },
          { day: '3', text: '한라산 어리목 코스를 오전에 오르고 오후는 자유 일정입니다.', image_slot: '' },
          { day: '4', text: '숙소 체크아웃 후 제주공항으로 이동해 귀가합니다.', image_slot: '' },
        ],
      },
      source: { days: '행사정보.일정' },
    },
    {
      id: 'sec_accommodation', type: 'accommodation', order: 4, visible: true, locked: false,
      data: {
        // 2행 — 숙소를 옮겨 다니는 일정이 렌더링에서 무너지지 않는지 본다(§7.4)
        숙소들: [
          {
            숙소명: '서귀포 오션뷰 리조트',
            객실타입: '디럭스 트윈',
            위치: '제주특별자치도 서귀포시 중문관광로 72번길 100-1',
            숙박일정: '1~2박',
          },
          {
            숙소명: '성산 한옥스테이 고요',
            // 미입력 표기가 카드 안에서도 그대로 남는지 확인한다(§6.1)
            객실타입: '추후 추가 예정',
            위치: '제주특별자치도 서귀포시 성산읍 고성리 123-4',
            숙박일정: '3박',
          },
        ],
        image_slots: [],
      },
      source: { 숙소들: '숙박' },
    },
    {
      id: 'sec_flight', type: 'flight', order: 5, visible: true, locked: false,
      data: {
        공항: '김포국제공항(GMP) → 제주국제공항(CJU)',
        항공사: '대한항공',
        편명: 'KE1231 / KE1246',
        출발시간: '2026-03-14 08:20',
        도착시간: '2026-03-17 19:40',
      },
      source: {
        공항: '항공편.공항', 항공사: '항공편.항공사', 편명: '항공편.편명',
        출발시간: '항공편.출발시간', 도착시간: '항공편.도착시간',
      },
    },
    {
      id: 'sec_meal', type: 'meal', order: 6, visible: true, locked: false,
      // 미입력 표기가 그대로 남는지 확인한다 (§6.1)
      data: { 식사정보: '추후 추가 예정' },
      source: { 식사정보: '식사.식사정보' },
    },
    {
      id: 'sec_price', type: 'price', order: 7, visible: true, locked: false,
      // 아동 미운영 표기 (§6.1) — `0`으로 바뀌지 않아야 한다
      data: {
        성인: '890,000원', 아동: '해당 없음',
        기타: '유류할증료 및 공항이용료 포함. 여행자보험 별도.\n예약 문의는 상품 페이지 하단 신청 폼을 이용해 주세요.',
      },
      source: { 성인: '가격.성인', 아동: '가격.아동', 기타: '가격.기타' },
    },
    {
      id: 'sec_shop', type: 'shop', order: 8, visible: true, locked: false,
      data: {
        상점들: [
          {
            상점명: '중문 감귤농장 직판장',
            구분: '제휴',
            위치: '제주특별자치도 서귀포시 중문동 1234',
            // 공백 없는 긴 문자열 — 줄바꿈 실패 시 가로 스크롤이 생긴다
            상점정보: '동행 고객 10% 할인. 상세: https://example.com/partners/jungmun-citrus-farm-direct-store',
          },
          {
            // 추천 상점 — 설명이 없는 행이 카드에서 어떻게 보이는지 확인한다(§7.2)
            상점명: '성산 바다뷰 카페',
            구분: '추천',
            위치: '제주특별자치도 서귀포시 성산읍 해맞이해안로 1',
            상점정보: '추후 추가 예정',
          },
        ],
        image_slots: [],
      },
      source: { 상점들: '상점' },
    },
    /* ── 삽입 블록 3종 (§10.2). hero와 apply 사이에만 놓인다 ── */
    {
      id: 'blk_free_1', type: 'free_text', order: 9, visible: true, locked: false,
      data: {
        제목: '준비물 안내',
        본문: '편한 트레킹화와 얇은 바람막이를 준비해 주세요. 3월 제주는 일교차가 큽니다.',
      },
      source: { 제목: 'generated', 본문: 'generated' },
    },
    {
      id: 'blk_notice_1', type: 'notice', order: 10, visible: true, locked: false,
      data: { 본문: '기상 악화 시 한라산 구간은 대체 일정으로 변경될 수 있습니다.' },
      source: { 본문: 'generated' },
    },
    {
      // 참조가 끊긴 image 블록 — 조용히 생략되는지 확인한다
      id: 'blk_image_1', type: 'image', order: 11, visible: true, locked: false,
      data: { image_id: 'missing-on-purpose', 캡션: '이 블록은 렌더링되지 않아야 한다' },
      source: {},
    },
    {
      // visible: false — 화면에서 빠지고 데이터는 남는다 (§10.2)
      id: 'blk_free_hidden', type: 'free_text', order: 12, visible: false, locked: false,
      data: { 제목: '숨긴 블록', 본문: '이 블록은 렌더링되지 않아야 한다.' },
      source: { 제목: 'generated', 본문: 'generated' },
    },
    {
      id: 'sec_apply', type: 'apply', order: 13, visible: true, locked: true,
      data: {
        제목: '여행 신청하기',
        안내문구: '아래 정보를 남겨 주시면 담당자가 순차적으로 안내드립니다.',
        가격요약: { 성인: '890,000원', 아동: '해당 없음' },
        행사정보요약: { 행사명: HEADLINE_40, 여행기간: '2026-03-14 ~ 2026-03-17' },
      },
      source: {
        제목: 'generated', 안내문구: 'generated',
        '가격요약.성인': '가격.성인', '가격요약.아동': '가격.아동',
        '행사정보요약.행사명': '행사정보.행사명', '행사정보요약.여행기간': '행사정보.여행기간',
      },
    },
  ],
}
