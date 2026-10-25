-- Scope Ledger core schema.
-- All writes go through the routines at the bottom of this file. Signed-in visitors
-- (anonymous Supabase users use the `authenticated` role) get SELECT only, filtered
-- by RLS. Review-link routines are executable by `service_role` only.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Shape validators (used by CHECK constraints)
-- ---------------------------------------------------------------------------

create or replace function private.is_valid_baseline(items jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  e jsonb;
  ids text[] := '{}';
begin
  if items is null or jsonb_typeof(items) <> 'array' then return false; end if;
  if jsonb_array_length(items) < 1 or jsonb_array_length(items) > 10 then return false; end if;
  for e in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(e) k where k not in ('id', 'text')) then return false; end if;
    if jsonb_typeof(e->'id') is distinct from 'string' or jsonb_typeof(e->'text') is distinct from 'string' then return false; end if;
    if (e->>'id') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$' then return false; end if;
    if char_length(btrim(e->>'text')) < 1 or char_length(e->>'text') > 500 then return false; end if;
    if (e->>'id') = any (ids) then return false; end if;
    ids := ids || (e->>'id');
  end loop;
  return true;
end;
$$;

create or replace function private.is_valid_approved_items(items jsonb, baseline jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  e jsonb;
  ref jsonb;
  baseline_ids text[];
  item_ids text[] := '{}';
begin
  if items is null or jsonb_typeof(items) <> 'array' then return false; end if;
  if jsonb_array_length(items) < 1 or jsonb_array_length(items) > 10 then return false; end if;
  select coalesce(array_agg(b->>'id'), '{}') into baseline_ids from jsonb_array_elements(baseline) b;
  for e in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if exists (
      select 1 from jsonb_object_keys(e) k
      where k not in ('id', 'description', 'baselineItemIds', 'origin', 'sourceQuote', 'classification')
    ) then return false; end if;
    if jsonb_typeof(e->'id') is distinct from 'string' or char_length(e->>'id') not between 1 and 40 then return false; end if;
    if (e->>'id') = any (item_ids) then return false; end if;
    item_ids := item_ids || (e->>'id');
    if jsonb_typeof(e->'description') is distinct from 'string'
       or char_length(btrim(e->>'description')) < 1 or char_length(e->>'description') > 500 then return false; end if;
    if (e->>'origin') is null or (e->>'origin') not in ('ai_suggested', 'manually_entered') then return false; end if;
    if jsonb_typeof(e->'baselineItemIds') is distinct from 'array' or jsonb_array_length(e->'baselineItemIds') > 10 then return false; end if;
    for ref in select value from jsonb_array_elements(e->'baselineItemIds') loop
      if jsonb_typeof(ref) <> 'string' or not ((ref #>> '{}') = any (baseline_ids)) then return false; end if;
    end loop;
    if e ? 'sourceQuote' and jsonb_typeof(e->'sourceQuote') not in ('string', 'null') then return false; end if;
    if char_length(coalesce(e->>'sourceQuote', '')) > 5000 then return false; end if;
    if e ? 'classification' and jsonb_typeof(e->'classification') <> 'null'
       and (e->>'classification') not in ('potential_addition', 'clarification', 'unclear') then return false; end if;
    -- Manually entered items never carry model evidence.
    if (e->>'origin') = 'manually_entered' and (e->>'sourceQuote') is not null then return false; end if;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) >= 1 and char_length(name) <= 100),
  client_name text not null check (char_length(btrim(client_name)) >= 1 and char_length(client_name) <= 100),
  baseline_items jsonb not null check (private.is_valid_baseline(baseline_items)),
  original_fee_pence integer not null check (original_fee_pence between 0 and 100000000),
  rate_pence integer not null check (rate_pence between 1 and 100000),
  due_on date not null,
  current_version_id uuid,
  -- Marks the idempotently seeded fictional fixture (one per visitor).
  seed_key text check (seed_key in ('northlight')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, seed_key)
);

create table public.change_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null,
  publish_key uuid not null,
  version_number integer not null check (version_number > 0),
  baseline_snapshot jsonb not null check (
    jsonb_typeof(baseline_snapshot) = 'object'
    and baseline_snapshot->>'currency' = 'GBP'
    and jsonb_typeof(baseline_snapshot->'originalFeePence') = 'number'
    and jsonb_typeof(baseline_snapshot->'ratePence') = 'number'
    and jsonb_typeof(baseline_snapshot->'dueOn') = 'string'
    and private.is_valid_baseline(baseline_snapshot->'baselineItems')
  ),
  request_text text not null check (char_length(btrim(request_text)) >= 1 and char_length(request_text) <= 5000),
  approved_items jsonb not null,
  effort_minutes integer not null check (effort_minutes between 15 and 2400 and effort_minutes % 15 = 0),
  extra_fee_pence integer not null,
  revised_total_pence integer generated always as
    ((baseline_snapshot->>'originalFeePence')::integer + extra_fee_pence) stored,
  revised_due_on date not null,
  published_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.projects (id, user_id),
  unique (project_id, version_number),
  unique (project_id, publish_key),
  unique (id, project_id),
  -- The fee is a pure function of the snapshot rate and effort: half-up to the penny.
  check (extra_fee_pence = (((baseline_snapshot->>'ratePence')::bigint * effort_minutes + 30) / 60)),
  check (private.is_valid_approved_items(approved_items, baseline_snapshot->'baselineItems'))
);

alter table public.projects
  add constraint projects_current_version_fk
  foreign key (current_version_id, id) references public.change_versions (id, project_id);

create table public.review_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  change_version_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (change_version_id, project_id) references public.change_versions (id, project_id),
  check (expires_at > created_at)
);
-- At most one live link per project: rotation must revoke before issuing.
create unique index review_tokens_one_active_per_project
  on public.review_tokens (project_id) where revoked_at is null;

create table public.decision_events (
  id uuid primary key default gen_random_uuid(),
  change_version_id uuid not null unique references public.change_versions (id),
  review_token_id uuid not null references public.review_tokens (id),
  decision text not null check (decision in ('accepted', 'revision_requested')),
  declared_name text not null check (char_length(btrim(declared_name)) >= 1 and char_length(declared_name) <= 100),
  note text check (note is null or (char_length(btrim(note)) >= 1 and char_length(note) <= 1000)),
  decided_at timestamptz not null default now()
);

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null,
  source_request_hash text not null check (source_request_hash ~ '^[0-9a-f]{64}$'),
  validated_result jsonb,
  model_id text check (char_length(model_id) <= 100),
  token_usage jsonb,
  status text not null default 'pending' check (status in ('pending', 'success', 'failure')),
  failure_code text check (char_length(failure_code) <= 60),
  attempts smallint not null default 0 check (attempts between 0 and 2),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (project_id, user_id) references public.projects (id, user_id)
);

create index projects_user_idx on public.projects (user_id) where archived_at is null;
create index change_versions_project_idx on public.change_versions (project_id, version_number desc);
create index analysis_runs_user_time_idx on public.analysis_runs (user_id, created_at desc);
create index analysis_runs_project_idx on public.analysis_runs (project_id);
create index review_tokens_version_idx on public.review_tokens (change_version_id);
create index decision_events_token_idx on public.decision_events (review_token_id);

-- ---------------------------------------------------------------------------
-- Immutability guards (apply to every role, including service_role)
-- ---------------------------------------------------------------------------

create or replace function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
end;
$$;

create trigger change_versions_immutable before update or delete on public.change_versions
  for each row execute function private.reject_mutation();
create trigger change_versions_no_truncate before truncate on public.change_versions
  for each statement execute function private.reject_mutation();
create trigger decision_events_immutable before update or delete on public.decision_events
  for each row execute function private.reject_mutation();
create trigger decision_events_no_truncate before truncate on public.decision_events
  for each statement execute function private.reject_mutation();

create or replace function private.guard_project_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
  end if;
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.name is distinct from old.name
     or new.client_name is distinct from old.client_name
     or new.baseline_items is distinct from old.baseline_items
     or new.original_fee_pence is distinct from old.original_fee_pence
     or new.rate_pence is distinct from old.rate_pence
     or new.due_on is distinct from old.due_on
     or new.seed_key is distinct from old.seed_key
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'BASELINE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger projects_baseline_immutable before update or delete on public.projects
  for each row execute function private.guard_project_update();

create or replace function private.guard_review_token_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
  end if;
  -- The only permitted change is a one-way revocation.
  if old.revoked_at is not null
     or new.revoked_at is null
     or (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
  end if;
  return new;
end;
$$;

create trigger review_tokens_revoke_only before update or delete on public.review_tokens
  for each row execute function private.guard_review_token_update();

create or replace function private.guard_analysis_run_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status <> 'pending'
     or new.id is distinct from old.id or new.project_id is distinct from old.project_id
     or new.user_id is distinct from old.user_id
     or new.source_request_hash is distinct from old.source_request_hash
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
  end if;
  return new;
end;
$$;

create trigger analysis_runs_complete_once before update or delete on public.analysis_runs
  for each row execute function private.guard_analysis_run_update();

-- ---------------------------------------------------------------------------
-- Row-level security: owner read-only, deny by default
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.change_versions enable row level security;
alter table public.review_tokens enable row level security;
alter table public.decision_events enable row level security;
alter table public.analysis_runs enable row level security;

create policy projects_owner_select on public.projects
  for select to authenticated using (user_id = (select auth.uid()));

create policy change_versions_owner_select on public.change_versions
  for select to authenticated using (user_id = (select auth.uid()));

create policy review_tokens_owner_select on public.review_tokens
  for select to authenticated using (
    exists (select 1 from public.projects p where p.id = review_tokens.project_id and p.user_id = (select auth.uid()))
  );

create policy decision_events_owner_select on public.decision_events
  for select to authenticated using (
    exists (
      select 1 from public.change_versions v
      where v.id = decision_events.change_version_id and v.user_id = (select auth.uid())
    )
  );

create policy analysis_runs_owner_select on public.analysis_runs
  for select to authenticated using (user_id = (select auth.uid()));

-- Minimal grants. Supabase grants broad default privileges to anon/authenticated;
-- strip them and re-grant SELECT only.
revoke all on public.projects, public.change_versions, public.review_tokens,
  public.decision_events, public.analysis_runs from public, anon, authenticated;
grant select on public.projects, public.change_versions, public.decision_events,
  public.analysis_runs to authenticated;
-- The token hash is never readable by visitors, only link metadata.
grant select (id, project_id, change_version_id, expires_at, revoked_at, created_at)
  on public.review_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- Routines
-- ---------------------------------------------------------------------------

create or replace function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  return v_uid;
end;
$$;

-- Free allowance: one active project per visitor (proposed Solo plan would be 10).
create or replace function private.active_project_limit()
returns integer language sql immutable set search_path = '' as $$ select 1 $$;

create or replace function private.insert_project_within_limit(
  p_uid uuid, p_name text, p_client_name text, p_baseline_items jsonb,
  p_original_fee_pence integer, p_rate_pence integer, p_due_on date, p_seed_key text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select count(*) from public.projects where user_id = p_uid and archived_at is null)
       >= private.active_project_limit() then
    raise exception using errcode = 'P0001', message = 'FREE_LIMIT_REACHED';
  end if;
  insert into public.projects (user_id, name, client_name, baseline_items, original_fee_pence, rate_pence, due_on, seed_key)
  values (p_uid, btrim(p_name), btrim(p_client_name), p_baseline_items, p_original_fee_pence, p_rate_pence, p_due_on, p_seed_key)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_project(
  p_name text, p_client_name text, p_baseline_items jsonb,
  p_original_fee_pence integer, p_rate_pence integer, p_due_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  -- Serialise project creation per visitor so the allowance check cannot race.
  perform pg_advisory_xact_lock(hashtextextended('projects:' || v_uid::text, 0));
  return private.insert_project_within_limit(
    v_uid, p_name, p_client_name, p_baseline_items, p_original_fee_pence, p_rate_pence, p_due_on, null);
end;
$$;

create or replace function public.seed_demo_project()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('projects:' || v_uid::text, 0));
  select id into v_id from public.projects where user_id = v_uid and seed_key = 'northlight';
  if found then
    return v_id;
  end if;
  return private.insert_project_within_limit(
    v_uid,
    'Northlight website refresh',
    'Northlight Studio',
    '[{"id":"B1","text":"Design and implement a three page responsive website"},
      {"id":"B2","text":"Include one round of revisions"},
      {"id":"B3","text":"Deliver the agreed pages by 2026-11-09"}]'::jsonb,
    180000,
    9000,
    date '2026-11-09',
    'northlight');
end;
$$;

-- Atomic publish + review-link rotation. The fee is computed here from the locked
-- project row; callers cannot supply money values.
create or replace function public.publish_change_version(
  p_project_id uuid,
  p_publish_key uuid,
  p_expected_current_version_id uuid,
  p_request_text text,
  p_approved_items jsonb,
  p_effort_minutes integer,
  p_revised_due_on date,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_project public.projects%rowtype;
  v_version public.change_versions%rowtype;
  v_created boolean := false;
  v_token_expires timestamptz;
begin
  if p_project_id is null or p_publish_key is null then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select * into v_project from public.projects
    where id = p_project_id and user_id = v_uid
    for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if v_project.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'PROJECT_ARCHIVED';
  end if;

  select * into v_version from public.change_versions
    where project_id = p_project_id and publish_key = p_publish_key;

  if found then
    -- Idempotent retry: never a new number or changed content; only a fresh link,
    -- and only while this version is still the current proposal.
    if v_project.current_version_id is distinct from v_version.id then
      raise exception using errcode = 'P0001', message = 'STALE_VERSION';
    end if;
  else
    if p_expected_current_version_id is distinct from v_project.current_version_id then
      raise exception using errcode = 'P0001', message = 'STALE_VERSION';
    end if;
    if p_effort_minutes is null or p_effort_minutes < 15 or p_effort_minutes > 2400 or p_effort_minutes % 15 <> 0 then
      raise exception using errcode = '22023', message = 'INVALID_EFFORT';
    end if;
    if p_revised_due_on is null or p_revised_due_on < v_project.due_on then
      raise exception using errcode = '22023', message = 'INVALID_DUE_DATE';
    end if;
    if not private.is_valid_approved_items(p_approved_items, v_project.baseline_items) then
      raise exception using errcode = '22023', message = 'INVALID_APPROVED_ITEMS';
    end if;

    insert into public.change_versions (
      project_id, user_id, publish_key, version_number, baseline_snapshot, request_text,
      approved_items, effort_minutes, extra_fee_pence, revised_due_on
    )
    values (
      v_project.id,
      v_uid,
      p_publish_key,
      coalesce((select max(version_number) from public.change_versions where project_id = v_project.id), 0) + 1,
      jsonb_build_object(
        'projectName', v_project.name,
        'clientName', v_project.client_name,
        'baselineItems', v_project.baseline_items,
        'originalFeePence', v_project.original_fee_pence,
        'ratePence', v_project.rate_pence,
        'dueOn', to_char(v_project.due_on, 'YYYY-MM-DD'),
        'currency', 'GBP'
      ),
      p_request_text,
      p_approved_items,
      p_effort_minutes,
      ((v_project.rate_pence::bigint * p_effort_minutes + 30) / 60)::integer,
      p_revised_due_on
    )
    returning * into v_version;

    update public.projects set current_version_id = v_version.id where id = v_project.id;
    v_created := true;
  end if;

  update public.review_tokens set revoked_at = now()
    where project_id = v_project.id and revoked_at is null;
  v_token_expires := now() + interval '7 days';
  insert into public.review_tokens (project_id, change_version_id, token_hash, expires_at)
    values (v_project.id, v_version.id, p_token_hash, v_token_expires);

  return jsonb_build_object(
    'versionId', v_version.id,
    'versionNumber', v_version.version_number,
    'extraFeePence', v_version.extra_fee_pence,
    'revisedTotalPence', v_version.revised_total_pence,
    'created', v_created,
    'linkExpiresAt', v_token_expires
  );
end;
$$;

create or replace function public.begin_analysis_run(p_project_id uuid, p_request_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid;
begin
  if not exists (select 1 from public.projects where id = p_project_id and user_id = v_uid and archived_at is null) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  -- Shared limiter across stateless function instances: serialise per visitor.
  perform pg_advisory_xact_lock(hashtextextended('analysis:' || v_uid::text, 0));
  if (select count(*) from public.analysis_runs where user_id = v_uid and created_at > now() - interval '1 minute') >= 3 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED_MINUTE';
  end if;
  if (select count(*) from public.analysis_runs where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED_DAY';
  end if;
  insert into public.analysis_runs (project_id, user_id, source_request_hash)
    values (p_project_id, v_uid, p_request_hash)
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.complete_analysis_run(
  p_run_id uuid, p_status text, p_validated_result jsonb, p_model_id text,
  p_token_usage jsonb, p_failure_code text, p_attempts integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if p_status not in ('success', 'failure') then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;
  update public.analysis_runs
    set status = p_status,
        validated_result = case when p_status = 'success' then p_validated_result else null end,
        model_id = p_model_id,
        token_usage = p_token_usage,
        failure_code = p_failure_code,
        attempts = p_attempts,
        completed_at = now()
    where id = p_run_id and user_id = v_uid and status = 'pending';
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
end;
$$;

-- Bearer-token routines. Only server code holding the service-role key may call
-- these, after hashing the presented token. Every failure mode returns NULL / the
-- same UNAVAILABLE code so callers cannot distinguish revoked, expired, superseded
-- or unknown tokens.
create or replace function public.get_review_snapshot(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token public.review_tokens%rowtype;
  v_version public.change_versions%rowtype;
  v_project public.projects%rowtype;
  v_decision public.decision_events%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into v_token from public.review_tokens where token_hash = p_token_hash;
  if not found or v_token.revoked_at is not null or v_token.expires_at <= now() then return null; end if;
  select * into v_version from public.change_versions where id = v_token.change_version_id;
  select * into v_project from public.projects where id = v_version.project_id;
  if v_project.current_version_id is distinct from v_version.id or v_project.archived_at is not null then
    return null;
  end if;
  select * into v_decision from public.decision_events where change_version_id = v_version.id;

  return jsonb_build_object(
    'versionNumber', v_version.version_number,
    'publishedAt', v_version.published_at,
    'linkExpiresAt', v_token.expires_at,
    'projectName', v_version.baseline_snapshot->'projectName',
    'clientName', v_version.baseline_snapshot->'clientName',
    'baselineItems', v_version.baseline_snapshot->'baselineItems',
    'originalFeePence', v_version.baseline_snapshot->'originalFeePence',
    'ratePence', v_version.baseline_snapshot->'ratePence',
    'originalDueOn', v_version.baseline_snapshot->'dueOn',
    'approvedItems', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'description', i->'description',
        'baselineItemIds', i->'baselineItemIds')), '[]'::jsonb)
      from jsonb_array_elements(v_version.approved_items) i
    ),
    'effortMinutes', v_version.effort_minutes,
    'extraFeePence', v_version.extra_fee_pence,
    'revisedTotalPence', v_version.revised_total_pence,
    'revisedDueOn', to_char(v_version.revised_due_on, 'YYYY-MM-DD'),
    'decision', case when v_decision.id is null then null else jsonb_build_object(
      'decision', v_decision.decision,
      'declaredName', v_decision.declared_name,
      'note', v_decision.note,
      'decidedAt', v_decision.decided_at) end
  );
end;
$$;

create or replace function public.record_review_decision(
  p_token_hash text, p_decision text, p_declared_name text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.review_tokens%rowtype;
  v_version_id uuid;
  v_project public.projects%rowtype;
  v_existing public.decision_events%rowtype;
  v_name text := btrim(coalesce(p_declared_name, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_event public.decision_events%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'UNAVAILABLE';
  end if;
  if p_decision not in ('accepted', 'revision_requested')
     or char_length(v_name) < 1 or char_length(v_name) > 100
     or char_length(coalesce(v_note, '')) > 1000 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select * into v_token from public.review_tokens where token_hash = p_token_hash;
  if not found then
    raise exception using errcode = 'P0001', message = 'UNAVAILABLE';
  end if;
  v_version_id := v_token.change_version_id;

  -- Lock the project: serialises against concurrent decisions and publications.
  select * into v_project from public.projects where id = v_token.project_id for update;
  -- Re-read the token after the lock; a concurrent publish may have revoked it.
  select * into v_token from public.review_tokens where id = v_token.id;
  if v_token.revoked_at is not null or v_token.expires_at <= now()
     or v_project.current_version_id is distinct from v_version_id
     or v_project.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'UNAVAILABLE';
  end if;

  select * into v_existing from public.decision_events where change_version_id = v_version_id;
  if found then
    if v_existing.decision = p_decision and v_existing.declared_name = v_name
       and v_existing.note is not distinct from v_note then
      return jsonb_build_object('status', 'replayed', 'decision', v_existing.decision,
        'declaredName', v_existing.declared_name, 'note', v_existing.note, 'decidedAt', v_existing.decided_at);
    end if;
    raise exception using errcode = 'P0001', message = 'DECISION_CONFLICT';
  end if;

  insert into public.decision_events (change_version_id, review_token_id, decision, declared_name, note)
    values (v_version_id, v_token.id, p_decision, v_name, v_note)
    returning * into v_event;

  return jsonb_build_object('status', 'created', 'decision', v_event.decision,
    'declaredName', v_event.declared_name, 'note', v_event.note, 'decidedAt', v_event.decided_at);
end;
$$;

-- Function privileges: Postgres grants EXECUTE to PUBLIC and Supabase adds default
-- grants to anon/authenticated, so revoke explicitly and re-grant per audience.
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.create_project(text, text, jsonb, integer, integer, date) from public, anon, authenticated;
revoke all on function public.seed_demo_project() from public, anon, authenticated;
revoke all on function public.publish_change_version(uuid, uuid, uuid, text, jsonb, integer, date, text) from public, anon, authenticated;
revoke all on function public.begin_analysis_run(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_analysis_run(uuid, text, jsonb, text, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.get_review_snapshot(text) from public, anon, authenticated;
revoke all on function public.record_review_decision(text, text, text, text) from public, anon, authenticated;

grant execute on function public.create_project(text, text, jsonb, integer, integer, date) to authenticated;
grant execute on function public.seed_demo_project() to authenticated;
grant execute on function public.publish_change_version(uuid, uuid, uuid, text, jsonb, integer, date, text) to authenticated;
grant execute on function public.begin_analysis_run(uuid, text) to authenticated;
grant execute on function public.complete_analysis_run(uuid, text, jsonb, text, jsonb, text, integer) to authenticated;
grant execute on function public.get_review_snapshot(text) to service_role;
grant execute on function public.record_review_decision(text, text, text, text) to service_role;
