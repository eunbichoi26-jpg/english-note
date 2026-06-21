-- Supabase SQL Editor에서 이 코드를 그대로 붙여넣고 실행(Run)하세요.
-- 영작노트가 단어장/문장함/학습 진행상황을 저장할 테이블입니다.

create table if not exists kv_store (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- Row Level Security는 켜두되, 서버(service_role 키)는 항상 우회해서 접근하므로
-- 이 앱의 서버 API를 통한 접근에는 영향이 없습니다.
alter table kv_store enable row level security;
