-- Mood Orbit MVP v5
-- Supabase Dashboard > SQL Editor에서 실행하세요.
-- 브라우저에는 Publishable key 또는 anon key만 사용합니다.

-- ---------------------------------------------------------------------------
-- 1. Emotion event log
-- SET: 돔을 올려 감정을 기록함
-- CANCEL: 돔을 내려 해당 기록을 취소함
-- ---------------------------------------------------------------------------
create table if not exists public.emotion_logs (
  id bigint generated always as identity primary key,
  client_event_id uuid not null,
  participant_id text not null,
  device_id text not null,
  action text not null default 'SET',
  emotion_code text not null,
  emotion_name text not null,
  color_hex text not null,
  source text not null,
  nfc_uid text,
  client_timestamp timestamptz not null,
  raw_event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.emotion_logs
  add column if not exists action text not null default 'SET';

alter table public.emotion_logs
  drop constraint if exists emotion_logs_emotion_code_check;
alter table public.emotion_logs
  drop constraint if exists emotion_logs_emotion_code_allowed;
alter table public.emotion_logs
  add constraint emotion_logs_emotion_code_allowed check (
    emotion_code in (
      'JOY','SADNESS','ANGER','SURPRISE','PEACE','EXCITEMENT','IRRITATION','CUSTOM'
    )
  );

alter table public.emotion_logs
  drop constraint if exists emotion_logs_source_check;
alter table public.emotion_logs
  drop constraint if exists emotion_logs_source_allowed;
alter table public.emotion_logs
  add constraint emotion_logs_source_allowed check (
    source in ('NFC','WEB','WEB_DEMO','LEGACY')
  );

alter table public.emotion_logs
  drop constraint if exists emotion_logs_action_allowed;
alter table public.emotion_logs
  add constraint emotion_logs_action_allowed check (
    action in ('SET','CANCEL')
  );

alter table public.emotion_logs
  drop constraint if exists emotion_logs_color_hex_check;
alter table public.emotion_logs
  add constraint emotion_logs_color_hex_check check (
    color_hex ~ '^#[0-9A-Fa-f]{6}$'
  );

create unique index if not exists emotion_logs_client_event_id_uidx
  on public.emotion_logs (client_event_id);
create index if not exists emotion_logs_participant_created_idx
  on public.emotion_logs (participant_id, created_at desc);
create index if not exists emotion_logs_device_created_idx
  on public.emotion_logs (device_id, created_at desc);

alter table public.emotion_logs enable row level security;
grant insert on table public.emotion_logs to anon, authenticated;
grant usage, select on sequence public.emotion_logs_id_seq to anon, authenticated;

drop policy if exists "MVP clients can insert emotion logs" on public.emotion_logs;
create policy "MVP clients can insert emotion logs"
on public.emotion_logs
for insert
to anon, authenticated
with check (
  client_event_id is not null
  and char_length(participant_id) between 1 and 80
  and char_length(device_id) between 1 and 80
  and action in ('SET','CANCEL')
  and emotion_code in (
    'JOY','SADNESS','ANGER','SURPRISE','PEACE','EXCITEMENT','IRRITATION','CUSTOM'
  )
  and source in ('NFC','WEB','WEB_DEMO','LEGACY')
);

-- ---------------------------------------------------------------------------
-- 2. Routine event log
-- done: 완료 / rest: 쉬어감 / clear: 선택 취소
-- ---------------------------------------------------------------------------
create table if not exists public.routine_logs (
  id bigint generated always as identity primary key,
  client_event_id uuid not null,
  participant_id text not null,
  device_id text not null,
  routine_id text not null,
  routine_name text not null,
  status text not null check (status in ('done','rest','clear')),
  source text not null default 'WEB' check (source in ('WEB','DEVICE')),
  client_timestamp timestamptz not null,
  raw_event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists routine_logs_client_event_id_uidx
  on public.routine_logs (client_event_id);
create index if not exists routine_logs_participant_created_idx
  on public.routine_logs (participant_id, created_at desc);

alter table public.routine_logs enable row level security;
grant insert on table public.routine_logs to anon, authenticated;
grant usage, select on sequence public.routine_logs_id_seq to anon, authenticated;

drop policy if exists "MVP clients can insert routine logs" on public.routine_logs;
create policy "MVP clients can insert routine logs"
on public.routine_logs
for insert
to anon, authenticated
with check (
  client_event_id is not null
  and char_length(participant_id) between 1 and 80
  and char_length(device_id) between 1 and 80
  and char_length(routine_id) between 1 and 120
  and char_length(routine_name) between 1 and 120
  and status in ('done','rest','clear')
  and source in ('WEB','DEVICE')
);

-- 익명 클라이언트에는 INSERT만 허용합니다.
-- 사용자별 조회가 필요한 운영 버전에서는 Supabase Auth와 SELECT 정책을 추가하세요.
