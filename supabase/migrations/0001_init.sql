-- zentrip 초기 스키마 — spec.md 2.4 §5(데이터 모델) · §16.3(RLS)
-- Supabase SQL Editor에 통째로 붙여넣어 1회 실행한다.
--
-- 설계 근거 중 spec에 없어 여기서 확정한 것은 파일 하단 「구현 결정」에 적는다.

-- ─────────────────────────────────────────────────────────────
-- updated_at 자동 갱신 (spec §5.1 "모든 쓰기 작업에서 updated_at을 갱신한다")
--
-- ⚠ 밀리초로 절단하는 이유: §16.1.1의 낙관적 잠금이
--   UPDATE ... WHERE id = ? AND updated_at = ? 로 동작하는데,
--   Postgres timestamptz는 마이크로초 정밀도이고 JS Date는 밀리초다.
--   절단하지 않으면 클라이언트가 읽어 되돌려준 값이 영원히 일치하지 않아
--   모든 쓰기가 409 stale이 된다.
-- ─────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := date_trunc('milliseconds', now());
  return new;
end $$;


-- ─────────────────────────────────────────────────────────────
-- §5.1 products
-- ─────────────────────────────────────────────────────────────
create table if not exists products (
  id                  uuid primary key default gen_random_uuid(),
  execution_id        text        not null unique,
  attempt_no          int         not null default 1 check (attempt_no >= 1),
  slug                text        unique,
  status              text        not null default 'generating'
                        check (status in ('generating','input_error','brochure_ready',
                                          'draft','reviewing','published','unpublished')),
  current_step        text        not null default 'pipeline_started',

  form_input          jsonb       not null,
  confirmed_data      jsonb,
  brochure_content    jsonb,
  page_content        jsonb,
  validation_snapshot jsonb,

  -- §11.6 카운터 4종. 2.2의 3종이 아니다 — normalization이 brochure와 예산을 공유하지 않는다.
  retry_counts        jsonb       not null
                        default '{"normalization":0,"brochure":0,"page":0,"consistency":0}'::jsonb,

  human_edited        boolean     not null default false,
  publish_override_at timestamptz,
  failure_reason      text,
  published_at        timestamptz,
  created_at          timestamptz not null default date_trunc('milliseconds', now()),
  updated_at          timestamptz not null default date_trunc('milliseconds', now())
);

-- retry_counts는 항상 4개 키를 갖는다 (누락 시 카운터 로직이 조용히 어긋난다)
alter table products drop constraint if exists products_retry_counts_shape;
alter table products add constraint products_retry_counts_shape check (
  retry_counts ?& array['normalization','brochure','page','consistency']
);

-- §12.1 slug 허용 문자: 영문 소문자·숫자·하이픈만
alter table products drop constraint if exists products_slug_format;
alter table products add constraint products_slug_format check (
  slug is null or slug ~ '^[a-z0-9-]+$'
);

create index if not exists products_status_idx      on products (status);
create index if not exists products_created_at_idx  on products (created_at desc);

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- §5.2 product_images — §12.4에 따라 상품 삭제 시 CASCADE
-- ─────────────────────────────────────────────────────────────
create table if not exists product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  -- §7.3 슬롯 4종. itinerary_day_{n}은 n이 가변이므로 정규식으로 검사한다.
  slot         text not null check (
                 slot in ('hero','accommodation','shop')
                 or slot ~ '^itinerary_day_[1-9][0-9]*$'
               ),
  storage_path text not null,
  alt          text not null,
  sort_order   int  not null default 0,
  width        int,
  height       int,
  bytes        int,
  created_at   timestamptz not null default date_trunc('milliseconds', now())
);

create index if not exists product_images_product_idx on product_images (product_id, slot, sort_order);


-- ─────────────────────────────────────────────────────────────
-- §5.3 applications — §12.4 "신청이 1건이라도 있으면 상품을 삭제할 수 없다"
--   → ON DELETE RESTRICT 로 DB 차원에서도 막는다(라우트의 사전 검사와 이중 방어)
-- ─────────────────────────────────────────────────────────────
create table if not exists applications (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references products(id) on delete restrict,
  name             text not null,
  email            text not null,
  phone            text not null,
  headcount        int  not null check (headcount between 1 and 20),
  consent_at       timestamptz not null,
  product_snapshot jsonb not null,
  email_status     text not null default 'pending'
                     check (email_status in ('pending','sent','failed')),
  email_error      text,
  created_at       timestamptz not null default date_trunc('milliseconds', now())
);

create index if not exists applications_product_idx    on applications (product_id);
create index if not exists applications_created_at_idx on applications (created_at desc);


-- ─────────────────────────────────────────────────────────────
-- §5.4 execution_logs — append 전용
--   §12.4: 상품이 삭제돼도 남긴다. product_id만 NULL로 (ON DELETE SET NULL)
--   verdict 저장값은 영어다. 화면에서만 통과/반려로 표시한다.
-- ─────────────────────────────────────────────────────────────
create table if not exists execution_logs (
  id           bigserial primary key,
  execution_id text not null,
  product_id   uuid references products(id) on delete set null,
  category     text not null check (category in ('pipeline','lifecycle','application')),
  step         text not null check (step in (
                 -- pipeline (§5.4)
                 'pipeline_started','itinerary_decomposed','normalization_validated',
                 'brochure_generated','validation_1_completed','page_generated',
                 'validation_2_completed','validation_3_completed','draft_registered',
                 'regenerate_requested','form_input_resubmitted',
                 -- lifecycle
                 'content_edited','slug_changed','published','unpublished',
                 'publish_override','product_deleted',
                 -- application
                 'application_received','email_sent','email_resent','application_deleted'
               )),
  attempt_no   int  not null default 1,
  retry_index  int  not null default 0,
  verdict      text not null default '-' check (verdict in ('pass','fail','-')),
  status       text not null,
  input        jsonb,
  output       jsonb,
  created_at   timestamptz not null default date_trunc('milliseconds', now())
);

create index if not exists execution_logs_exec_idx     on execution_logs (execution_id, id);
create index if not exists execution_logs_category_idx on execution_logs (execution_id, category, id);


-- ─────────────────────────────────────────────────────────────
-- §5.5 abnormality_flags
--   중복 기록 범위 = (execution_id, attempt_no, step, type) 조합당 1행.
--   attempt_no가 빠지면 [다시 생성] 후 같은 문제가 반복돼도 기록되지 않는다.
-- ─────────────────────────────────────────────────────────────
create table if not exists abnormality_flags (
  id           bigserial primary key,
  execution_id text not null,
  product_id   uuid references products(id) on delete set null,
  attempt_no   int  not null default 1,
  type         text not null check (type in (
                 'retry_accumulated','pipeline_aborted','validation_repeated_failure',
                 'processing_delayed','itinerary_partial'
               )),
  step         text not null,
  detail       text not null,
  detected_at  timestamptz not null default date_trunc('milliseconds', now()),
  constraint abnormality_flags_dedupe unique (execution_id, attempt_no, step, type)
);

create index if not exists abnormality_flags_exec_idx on abnormality_flags (execution_id, id);


-- ─────────────────────────────────────────────────────────────
-- §5.6 edit_history — §12.4에 따라 CASCADE
-- ─────────────────────────────────────────────────────────────
create table if not exists edit_history (
  id         bigserial primary key,
  product_id uuid not null references products(id) on delete cascade,
  action     text not null check (action in ('update','delete','insert','reorder')),
  section_id text not null,
  before     jsonb,
  after      jsonb,
  edited_at  timestamptz not null default date_trunc('milliseconds', now())
);

create index if not exists edit_history_product_idx on edit_history (product_id, id);


-- ─────────────────────────────────────────────────────────────
-- §16.3 RLS
--   service_role은 RLS를 우회하므로 아래 정책은 전부 anon 대상이다.
--   앱은 클라이언트에서 Supabase를 직접 호출하지 않으므로(§4) 이 정책은
--   심층 방어이며, 정책이 없으면 RLS 활성화만으로 anon은 전면 거부된다.
-- ─────────────────────────────────────────────────────────────
alter table products          enable row level security;
alter table product_images    enable row level security;
alter table applications      enable row level security;
alter table execution_logs    enable row level security;
alter table abnormality_flags enable row level security;
alter table edit_history      enable row level security;

-- products: 게시된 것만 조회
drop policy if exists products_anon_select_published on products;
create policy products_anon_select_published on products
  for select to anon using (status = 'published');

-- product_images: 게시된 상품의 것만 조회
drop policy if exists product_images_anon_select_published on product_images;
create policy product_images_anon_select_published on product_images
  for select to anon using (
    exists (select 1 from products p where p.id = product_id and p.status = 'published')
  );

-- applications: INSERT만. 조회·수정·삭제 없음
drop policy if exists applications_anon_insert on applications;
create policy applications_anon_insert on applications
  for insert to anon with check (true);

-- execution_logs · abnormality_flags · edit_history: 정책 없음 = anon 전면 거부


-- ─────────────────────────────────────────────────────────────
-- Storage — §7.3 · §16.3
--   버킷은 읽기 공개, 업로드는 service_role만.
--   ⚠ 알려진 한계(§16.2): 읽기 공개이므로 임시저장 상품의 이미지 파일은
--     정확한 URL을 아는 경우 접근 가능하다. 경로에 UUID를 써서 추측을 막는다.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
  for select to public using (bucket_id = 'product-images');
-- INSERT/UPDATE/DELETE 정책 없음 → service_role만 쓰기 가능


-- ─────────────────────────────────────────────────────────────
-- 구현 결정 (spec에 규정이 없어 여기서 확정한 것)
--
-- 1. updated_at을 밀리초로 절단한다.
--    §16.1.1의 낙관적 잠금이 JS Date(ms)와 왕복하므로 마이크로초를 남기면
--    비교가 영원히 실패한다. created_at·detected_at 등도 일관되게 맞춘다.
--
-- 2. applications.product_id는 ON DELETE RESTRICT.
--    §12.4가 "신청 1건 이상이면 삭제 불가"를 규정하므로 라우트에서 검사하되,
--    DB 제약으로도 막아 고아 신청이 생길 길을 없앤다.
--
-- 3. execution_logs·abnormality_flags의 product_id는 ON DELETE SET NULL.
--    §12.4 "삭제하지 않는다. product_id는 NULL로 설정한다"의 직역이다.
--
-- 4. retry_counts에 4개 키 존재를 CHECK로 강제한다.
--    키가 빠지면 카운터 증가가 조용히 실패해 재시도가 무한 반복될 수 있다.
--
-- 5. execution_logs.step을 CHECK로 열거한다(21종).
--    §5.4의 목록이 단일 출처이며, 오타로 만들어진 단계명이 로그 화면의
--    category 탭에서 조용히 누락되는 것을 막는다.
-- ─────────────────────────────────────────────────────────────
