-- Replace Supabase Auth identities with server-issued visitor cookies.
-- The browser holds a random 32-byte secret; only its SHA-256 is stored here.
-- Every owner operation is a SECURITY DEFINER routine that takes the resolved
-- visitor ID and checks ownership itself. All routines are executable by
-- service_role only, so the database is unreachable with the publishable key.

create table public.visitors (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.visitors enable row level security;
revoke all on public.visitors from public, anon, authenticated;

alter table public.projects drop constraint projects_user_id_fkey;
alter table public.projects
  add constraint projects_user_id_fkey foreign key (user_id) references public.visitors (id);

-- No direct table access for API roles any more: RLS stays enabled with no
-- policies and no grants (deny by default).
drop policy projects_owner_select on public.projects;
drop policy change_versions_owner_select on public.change_versions;
drop policy review_tokens_owner_select on public.review_tokens;
drop policy decision_events_owner_select on public.decision_events;
drop policy analysis_runs_owner_select on public.analysis_runs;
revoke select (id, project_id, change_version_id, expires_at, revoked_at, created_at)
  on public.review_tokens from authenticated;
revoke all on public.projects, public.change_versions, public.review_tokens,
  public.decision_events, public.analysis_runs from public, anon, authenticated;

drop function public.create_project(text, text, jsonb, integer, integer, date);
drop function public.seed_demo_project();
drop function public.publish_change_version(uuid, uuid, uuid, text, jsonb, integer, date, text);
drop function public.begin_analysis_run(uuid, text);
drop function public.complete_analysis_run(uuid, text, jsonb, text, jsonb, text, integer);
drop function private.require_uid();

create or replace function private.require_visitor(p_visitor_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_visitor_id is null or not exists (select 1 from public.visitors where id = p_visitor_id) then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  return p_visitor_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Visitor identity
-- ---------------------------------------------------------------------------

create or replace function public.resolve_visitor(p_secret_hash text, p_create boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select id into v_id from public.visitors where secret_hash = p_secret_hash;
  if found or not coalesce(p_create, false) then
    return v_id;
  end if;
  insert into public.visitors (secret_hash) values (p_secret_hash)
    on conflict (secret_hash) do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from public.visitors where secret_hash = p_secret_hash;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner reads (always filtered by the visitor; never return owner or hash columns)
-- ---------------------------------------------------------------------------

create or replace function public.owner_list_projects(p_visitor_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(p) - 'user_id' order by p.created_at desc), '[]'::jsonb)
  from public.projects p where p.user_id = p_visitor_id
$$;

create or replace function public.owner_get_project(p_visitor_id uuid, p_project_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) - 'user_id' from public.projects p
  where p.id = p_project_id and p.user_id = p_visitor_id
$$;

create or replace function public.owner_list_versions(p_visitor_id uuid, p_project_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(v) - 'user_id' order by v.version_number desc), '[]'::jsonb)
  from public.change_versions v where v.project_id = p_project_id and v.user_id = p_visitor_id
$$;

create or replace function public.owner_get_version(p_visitor_id uuid, p_version_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(v) - 'user_id' from public.change_versions v
  where v.id = p_version_id and v.user_id = p_visitor_id
$$;

create or replace function public.owner_list_decisions(p_visitor_id uuid, p_project_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(d) - 'id' - 'review_token_id'), '[]'::jsonb)
  from public.decision_events d
  join public.change_versions v on v.id = d.change_version_id
  where v.project_id = p_project_id and v.user_id = p_visitor_id
$$;

create or replace function public.owner_get_active_link(p_visitor_id uuid, p_project_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('change_version_id', t.change_version_id, 'expires_at', t.expires_at, 'created_at', t.created_at)
  from public.review_tokens t
  join public.projects p on p.id = t.project_id
  where t.project_id = p_project_id and p.user_id = p_visitor_id and t.revoked_at is null
$$;

-- ---------------------------------------------------------------------------
-- Owner writes (same transactional logic as before, keyed by visitor)
-- ---------------------------------------------------------------------------

create or replace function public.create_project(
  p_visitor_id uuid, p_name text, p_client_name text, p_baseline_items jsonb,
  p_original_fee_pence integer, p_rate_pence integer, p_due_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_visitor(p_visitor_id);
begin
  perform pg_advisory_xact_lock(hashtextextended('projects:' || v_uid::text, 0));
  return private.insert_project_within_limit(
    v_uid, p_name, p_client_name, p_baseline_items, p_original_fee_pence, p_rate_pence, p_due_on, null);
end;
$$;

create or replace function public.seed_demo_project(p_visitor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_visitor(p_visitor_id);
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

create or replace function public.publish_change_version(
  p_visitor_id uuid,
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
  v_uid uuid := private.require_visitor(p_visitor_id);
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

create or replace function public.begin_analysis_run(p_visitor_id uuid, p_project_id uuid, p_request_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_visitor(p_visitor_id);
  v_id uuid;
begin
  if not exists (select 1 from public.projects where id = p_project_id and user_id = v_uid and archived_at is null) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
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
  p_visitor_id uuid, p_run_id uuid, p_status text, p_validated_result jsonb, p_model_id text,
  p_token_usage jsonb, p_failure_code text, p_attempts integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_visitor(p_visitor_id);
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

-- ---------------------------------------------------------------------------
-- Privileges: server (service_role) only
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.resolve_visitor(text, boolean) from public, anon, authenticated;
revoke all on function public.owner_list_projects(uuid) from public, anon, authenticated;
revoke all on function public.owner_get_project(uuid, uuid) from public, anon, authenticated;
revoke all on function public.owner_list_versions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.owner_get_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.owner_list_decisions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.owner_get_active_link(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_project(uuid, text, text, jsonb, integer, integer, date) from public, anon, authenticated;
revoke all on function public.seed_demo_project(uuid) from public, anon, authenticated;
revoke all on function public.publish_change_version(uuid, uuid, uuid, uuid, text, jsonb, integer, date, text) from public, anon, authenticated;
revoke all on function public.begin_analysis_run(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_analysis_run(uuid, uuid, text, jsonb, text, jsonb, text, integer) from public, anon, authenticated;

grant execute on function public.resolve_visitor(text, boolean) to service_role;
grant execute on function public.owner_list_projects(uuid) to service_role;
grant execute on function public.owner_get_project(uuid, uuid) to service_role;
grant execute on function public.owner_list_versions(uuid, uuid) to service_role;
grant execute on function public.owner_get_version(uuid, uuid) to service_role;
grant execute on function public.owner_list_decisions(uuid, uuid) to service_role;
grant execute on function public.owner_get_active_link(uuid, uuid) to service_role;
grant execute on function public.create_project(uuid, text, text, jsonb, integer, integer, date) to service_role;
grant execute on function public.seed_demo_project(uuid) to service_role;
grant execute on function public.publish_change_version(uuid, uuid, uuid, uuid, text, jsonb, integer, date, text) to service_role;
grant execute on function public.begin_analysis_run(uuid, uuid, text) to service_role;
grant execute on function public.complete_analysis_run(uuid, uuid, text, jsonb, text, jsonb, text, integer) to service_role;
