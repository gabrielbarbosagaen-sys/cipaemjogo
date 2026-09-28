-- =====================================================================
--  CIPA EM JOGO — Supermercados Rondon
--  Banco de dados do quiz gamificado (Supabase / PostgreSQL)
--
--  COMO USAR: copie TODO este arquivo, cole no "SQL Editor" do Supabase
--  e clique em "Run". Pode ser executado de novo sem perder dados.
--
--  Senha inicial do administrador: cipa2026
--  (troque no painel do administrador > Configurações)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  execute 'revoke all on schema private from anon, authenticated';
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------
--  TABELAS
-- ---------------------------------------------------------------------

create table if not exists public.app_settings (
  id          int primary key default 1 check (id = 1),
  admin_hash  text not null,
  stores      text[] not null default '{}'
);
insert into public.app_settings (id, admin_hash)
values (1, extensions.crypt('cipa2026', extensions.gen_salt('bf')))
on conflict (id) do nothing;

create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.questions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes(id) on delete cascade,
  position       int not null default 0,
  category       text not null default 'Geral',
  text           text not null,
  options        text[] not null,
  correct_index  int not null,
  time_limit     int not null default 30,
  explanation    text,
  created_at     timestamptz not null default now(),
  constraint questions_options_len check (array_length(options, 1) between 2 and 6),
  constraint questions_correct_ok check (correct_index >= 0 and correct_index < array_length(options, 1)),
  constraint questions_time_ok   check (time_limit between 5 and 300)
);
create index if not exists questions_quiz_idx on public.questions (quiz_id, position);

create table if not exists public.sessions (
  id                   uuid primary key default gen_random_uuid(),
  pin                  text not null,
  name                 text not null,
  quiz_id              uuid references public.quizzes(id) on delete set null,
  quiz_title           text,
  mode                 text not null check (mode in ('live', 'self')),
  status               text not null default 'lobby'
                       check (status in ('lobby', 'question', 'reveal', 'ranking', 'finished', 'open', 'closed')),
  shuffle_questions    boolean not null default false,
  shuffle_options      boolean not null default false,
  show_explanation     boolean not null default true,
  current_index        int not null default -1,
  question_started_at  timestamptz,
  paused_at            timestamptz,
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  finished_at          timestamptz
);
create unique index if not exists sessions_active_pin
  on public.sessions (pin) where status not in ('finished', 'closed');
-- cronômetro por pergunta (no modo "no seu ritmo" pode ser desligado)
alter table public.sessions add column if not exists timed boolean not null default true;

-- Cópia das perguntas no momento do jogo (o histórico não muda se as perguntas forem editadas depois)
create table if not exists public.session_questions (
  session_id     uuid not null references public.sessions(id) on delete cascade,
  idx            int not null,
  source_id      uuid,
  category       text not null,
  text           text not null,
  options        text[] not null,
  correct_index  int not null,
  time_limit     int not null,
  explanation    text,
  primary key (session_id, idx)
);

create table if not exists public.players (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid not null references public.sessions(id) on delete cascade,
  name                 text not null,
  store                text not null default '',
  score                int not null default 0,
  correct_count        int not null default 0,
  answered_count       int not null default 0,
  streak               int not null default 0,
  best_streak          int not null default 0,
  correct_time_ms      bigint not null default 0,
  last_answered_index  int not null default -1,
  q_order              int[],
  self_pos             int not null default 0,
  q_started_at         timestamptz,
  finished_at          timestamptz,
  joined_at            timestamptz not null default now()
);
create unique index if not exists players_unique_name
  on public.players (session_id, lower(name), lower(store));
create index if not exists players_session_idx on public.players (session_id);

create table if not exists public.player_tokens (
  player_id  uuid primary key references public.players(id) on delete cascade,
  token      uuid not null default gen_random_uuid()
);

create table if not exists public.answers (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  player_id   uuid not null references public.players(id) on delete cascade,
  q_index     int not null,
  chosen      int,
  is_correct  boolean not null,
  elapsed_ms  int not null,
  points      int not null default 0,
  bonus       int not null default 0,
  created_at  timestamptz not null default now(),
  unique (player_id, q_index)
);
create index if not exists answers_session_idx on public.answers (session_id, q_index);

-- ---------------------------------------------------------------------
--  SEGURANÇA: ninguém escreve direto nas tabelas; tudo passa pelas funções
-- ---------------------------------------------------------------------

alter table public.app_settings      enable row level security;
alter table public.quizzes           enable row level security;
alter table public.questions         enable row level security;
alter table public.sessions          enable row level security;
alter table public.session_questions enable row level security;
alter table public.players           enable row level security;
alter table public.player_tokens     enable row level security;
alter table public.answers           enable row level security;

do $$ begin
  execute 'revoke all on public.app_settings, public.quizzes, public.questions, public.session_questions,
           public.player_tokens, public.answers from anon, authenticated';
  execute 'revoke insert, update, delete, truncate on public.sessions, public.players from anon, authenticated';
  execute 'grant select on public.sessions, public.players to anon, authenticated';
exception when undefined_object then null;
end $$;

drop policy if exists "leitura publica" on public.sessions;
create policy "leitura publica" on public.sessions for select using (true);
drop policy if exists "leitura publica" on public.players;
create policy "leitura publica" on public.players for select using (true);

-- Tempo real (atualização instantânea das telas)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions') then
      alter publication supabase_realtime add table public.sessions;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players') then
      alter publication supabase_realtime add table public.players;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
--  FUNÇÕES INTERNAS (schema private — não acessíveis pela internet)
-- ---------------------------------------------------------------------

create or replace function private.assert_admin(p_pass text)
returns void language plpgsql set search_path = public, extensions as $$
begin
  if p_pass is null or not exists (
       select 1 from public.app_settings where id = 1 and admin_hash = extensions.crypt(p_pass, admin_hash)) then
    perform pg_sleep(0.6);
    raise exception 'Senha de administrador inválida.' using errcode = '28P01';
  end if;
end $$;

create or replace function private.assert_player(p_player uuid, p_token uuid)
returns public.players language plpgsql set search_path = public as $$
declare r public.players;
begin
  select p.* into r
    from public.players p join public.player_tokens t on t.player_id = p.id
   where p.id = p_player and t.token = p_token;
  if not found then
    raise exception 'Participante não encontrado. Entre novamente no jogo.' using errcode = 'P0002';
  end if;
  return r;
end $$;

create or replace function private.snapshot(p_session uuid)
returns void language plpgsql set search_path = public as $$
declare v_quiz uuid;
begin
  select quiz_id into v_quiz from public.sessions where id = p_session;
  delete from public.session_questions where session_id = p_session;
  insert into public.session_questions
         (session_id, idx, source_id, category, text, options, correct_index, time_limit, explanation)
  select p_session, (row_number() over (order by position, created_at))::int - 1,
         id, category, text, options, correct_index, time_limit, explanation
    from public.questions where quiz_id = v_quiz;
end $$;

-- Pontuação: até 1000 pontos por acerto, caindo até 500 conforme o tempo passa,
-- + 100 pontos por acerto seguido (a partir do 2º), no máximo +500.
-- Sem cronômetro (p_timed = false): 1000 pontos fixos por acerto + bônus; o tempo só desempata.
drop function if exists private.score_answer(public.players, int, int, int, public.session_questions);
create or replace function private.score_answer(
  p public.players, p_idx int, p_choice int, p_elapsed int, q public.session_questions, p_timed boolean default true)
returns public.answers language plpgsql set search_path = public as $$
declare
  v_limit_ms int := case when p_timed then q.time_limit * 1000 else 600000 end;
  v_correct boolean;
  v_streak int;
  v_base int := 0;
  v_bonus int := 0;
  a public.answers;
begin
  v_correct := p_choice is not null and p_choice = q.correct_index
               and (not p_timed or p_elapsed <= v_limit_ms + 1500);
  if v_correct then
    v_streak := p.streak + 1;
    v_base   := case when p_timed then round(1000 - 500.0 * least(p_elapsed, v_limit_ms) / v_limit_ms) else 1000 end;
    v_bonus  := least((v_streak - 1) * 100, 500);
  else
    v_streak := 0;
  end if;

  insert into public.answers (session_id, player_id, q_index, chosen, is_correct, elapsed_ms, points, bonus)
  values (p.session_id, p.id, p_idx, p_choice, v_correct, least(p_elapsed, v_limit_ms), v_base + v_bonus, v_bonus)
  on conflict (player_id, q_index) do nothing
  returning * into a;

  if a.id is null then
    raise exception 'Resposta já registrada para esta pergunta.';
  end if;

  update public.players set
    score               = score + v_base + v_bonus,
    correct_count       = correct_count + case when v_correct then 1 else 0 end,
    answered_count      = answered_count + 1,
    streak              = v_streak,
    best_streak         = greatest(best_streak, v_streak),
    correct_time_ms     = correct_time_ms + case when v_correct then least(p_elapsed, v_limit_ms) else 0 end,
    last_answered_index = p_idx
  where id = p.id;

  return a;
end $$;

-- Encerra a pergunta atual do modo ao vivo (quem não respondeu fica com 0)
create or replace function private.reveal(p_session uuid)
returns void language plpgsql set search_path = public as $$
declare s public.sessions; q public.session_questions; pl public.players;
begin
  select * into s from public.sessions where id = p_session for update;
  if not found or s.status <> 'question' then return; end if;
  select * into q from public.session_questions where session_id = s.id and idx = s.current_index;
  for pl in
    select p.* from public.players p
     where p.session_id = s.id
       and not exists (select 1 from public.answers a where a.player_id = p.id and a.q_index = s.current_index)
  loop
    perform private.score_answer(pl, s.current_index, null, q.time_limit * 1000, q);
  end loop;
  update public.sessions set status = 'reveal', paused_at = null where id = s.id;
end $$;

-- Revela automaticamente quando o tempo acaba ou todos já responderam
create or replace function private.tick(p_session uuid)
returns void language plpgsql set search_path = public as $$
declare s public.sessions; v_limit int; v_active int; v_answered int;
begin
  select * into s from public.sessions where id = p_session;
  if not found or s.mode <> 'live' or s.status <> 'question' or s.paused_at is not null then return; end if;
  select time_limit into v_limit from public.session_questions where session_id = s.id and idx = s.current_index;
  select count(*) into v_active from public.players where session_id = s.id;
  select count(*) into v_answered from public.answers where session_id = s.id and q_index = s.current_index;
  if clock_timestamp() > s.question_started_at + make_interval(secs => v_limit + 1)
     or (v_active > 0 and v_answered >= v_active and clock_timestamp() >= s.question_started_at) then
    perform private.reveal(s.id);
  end if;
end $$;

create or replace function private.ranking(p_session uuid)
returns table (
  player_id uuid, pos int, name text, store text, score int, correct_count int, answered_count int,
  best_streak int, correct_time_ms bigint, last_points int, prev_pos int, finished boolean, joined_at timestamptz)
language sql stable set search_path = public as $$
  select p.id,
         (row_number() over (order by p.score desc, p.correct_time_ms asc, p.joined_at asc))::int,
         p.name, p.store, p.score, p.correct_count, p.answered_count, p.best_streak, p.correct_time_ms,
         coalesce(a.points, 0),
         (row_number() over (order by p.score - coalesce(a.points, 0) desc,
                                      p.correct_time_ms - coalesce(case when a.is_correct then a.elapsed_ms end, 0) asc,
                                      p.joined_at asc))::int,
         p.finished_at is not null,
         p.joined_at
    from public.players p
    join public.sessions s on s.id = p.session_id
    left join public.answers a on a.player_id = p.id and a.q_index = s.current_index and s.mode = 'live'
   where p.session_id = p_session
$$;

create or replace function private.badges(p_player uuid)
returns text[] language plpgsql stable set search_path = public as $$
declare v text[] := '{}'; p public.players; v_total int; v_fast int; r record;
begin
  select * into p from public.players where id = p_player;
  if not found then return v; end if;
  select count(*) into v_total from public.session_questions where session_id = p.session_id;
  if v_total = 0 or p.answered_count = 0 then return v; end if;

  if p.correct_count = v_total then v := array_append(v, 'gabaritou');
  elsif p.correct_count >= ceil(v_total * 0.8) then v := array_append(v, 'precisao');
  end if;

  if p.best_streak >= 10 then v := array_append(v, 'imparavel');
  elsif p.best_streak >= 5 then v := array_append(v, 'em_chamas');
  end if;

  select count(*) into v_fast from public.answers where player_id = p.id and is_correct and elapsed_ms < 5000;
  if v_fast >= 5 then v := array_append(v, 'mao_rapida'); end if;

  if exists (
    select 1 from public.answers a
     where a.player_id = p.id and a.is_correct
       and a.elapsed_ms = (select min(b.elapsed_ms) from public.answers b
                            where b.session_id = a.session_id and b.q_index = a.q_index and b.is_correct)) then
    v := array_append(v, 'relampago');
  end if;

  for r in
    select sq.category, count(*) as total, count(a.id) filter (where a.is_correct) as ok
      from public.session_questions sq
      left join public.answers a on a.player_id = p.id and a.q_index = sq.idx
     where sq.session_id = p.session_id
     group by sq.category
  loop
    if r.total >= 3 and r.ok = r.total then v := array_append(v, 'cat:' || r.category); end if;
  end loop;

  if p.answered_count >= v_total then v := array_append(v, 'presenca'); end if;
  return v;
end $$;

create or replace function private.session_json(s public.sessions)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', s.id, 'pin', s.pin, 'name', s.name, 'mode', s.mode, 'status', s.status,
    'quiz_title', s.quiz_title, 'current_index', s.current_index,
    'question_started_at', s.question_started_at, 'paused_at', s.paused_at,
    'show_explanation', s.show_explanation, 'shuffle_options', s.shuffle_options, 'timed', s.timed,
    'shuffle_questions', s.shuffle_questions, 'created_at', s.created_at,
    'started_at', s.started_at, 'finished_at', s.finished_at)
$$;

create or replace function private.store_ranking(p_session uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'store', t.store, 'players', t.n, 'avg_score', t.avg_score,
           'total_score', t.total, 'correct_pct', t.pct, 'pos', t.pos) order by t.pos), '[]'::jsonb)
    from (
      select p.store, count(*)::int as n,
             round(avg(p.score))::int as avg_score,
             sum(p.score)::int as total,
             round(100.0 * sum(p.correct_count) / nullif(sum(p.answered_count), 0))::int as pct,
             (row_number() over (order by avg(p.score) desc, count(*) desc))::int as pos
        from public.players p
       where p.session_id = p_session and p.store <> ''
       group by p.store
    ) t
$$;

-- ---------------------------------------------------------------------
--  FUNÇÕES PÚBLICAS — PARTICIPANTE E TELÃO
-- ---------------------------------------------------------------------

create or replace function public.server_time()
returns timestamptz language sql volatile as $$ select clock_timestamp() $$;

create or replace function public.get_join_info(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; v_stores text[];
begin
  select * into s from public.sessions
   where pin = btrim(p_pin)
   order by (status in ('finished', 'closed')), created_at desc
   limit 1;
  if not found then
    raise exception 'PIN não encontrado. Confira o número com o organizador.' using errcode = 'P0002';
  end if;
  select stores into v_stores from public.app_settings where id = 1;
  return jsonb_build_object('id', s.id, 'name', s.name, 'mode', s.mode, 'status', s.status, 'pin', s.pin,
                            'stores', coalesce(to_jsonb(v_stores), '[]'::jsonb));
end $$;

create or replace function public.join_session(p_pin text, p_name text, p_store text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.sessions;
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_store text := btrim(regexp_replace(coalesce(p_store, ''), '\s+', ' ', 'g'));
  v_id uuid;
  v_token uuid;
begin
  if length(v_name) < 2 then raise exception 'Informe seu nome.'; end if;
  if length(v_store) < 1 then raise exception 'Informe sua loja ou setor.'; end if;
  v_name  := left(v_name, 40);
  v_store := left(v_store, 40);

  select * into s from public.sessions
   where pin = btrim(p_pin) and status not in ('finished', 'closed') limit 1;
  if not found then raise exception 'Sala não encontrada ou já encerrada.'; end if;

  begin
    insert into public.players (session_id, name, store) values (s.id, v_name, v_store) returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe um participante com esse nome nesta loja. Use também o sobrenome.';
  end;
  insert into public.player_tokens (player_id) values (v_id) returning token into v_token;

  return jsonb_build_object('player_id', v_id, 'token', v_token, 'session_id', s.id, 'pin', s.pin);
end $$;

-- Estado completo do jogo (usado pelo celular, pelo telão e pelo painel)
create or replace function public.live_state(p_session uuid, p_player uuid default null, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.sessions; q public.session_questions; me public.players; a public.answers;
  v_total int; v_players int; v_finished int; v_answered int;
  v_q jsonb; v_me jsonb; v_board jsonb; v_dist jsonb;
begin
  perform private.tick(p_session);
  select * into s from public.sessions where id = p_session;
  if not found then raise exception 'Sessão não encontrada.' using errcode = 'P0002'; end if;

  select count(*) into v_total from public.session_questions where session_id = s.id;
  select count(*), count(*) filter (where finished_at is not null)
    into v_players, v_finished from public.players where session_id = s.id;

  if s.mode = 'live' and s.current_index >= 0 and s.status in ('question', 'reveal', 'ranking') then
    select * into q from public.session_questions where session_id = s.id and idx = s.current_index;
    select count(*) into v_answered from public.answers
     where session_id = s.id and q_index = s.current_index and chosen is not null;
    v_q := jsonb_build_object('idx', q.idx, 'category', q.category, 'text', q.text,
                              'options', to_jsonb(q.options), 'time_limit', q.time_limit, 'answered', v_answered);
    if s.status in ('reveal', 'ranking') then
      select jsonb_agg((select count(*) from public.answers a2
                         where a2.session_id = s.id and a2.q_index = q.idx and a2.chosen = g.i) order by g.i)
        into v_dist
        from generate_series(0, array_length(q.options, 1) - 1) as g(i);
      v_q := v_q || jsonb_build_object('correct_index', q.correct_index, 'distribution', v_dist,
                                       'explanation', case when s.show_explanation then q.explanation end);
    end if;
  end if;

  if s.mode = 'self' or s.status <> 'question' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.player_id, 'pos', r.pos, 'name', r.name, 'store', r.store, 'score', r.score,
             'correct', r.correct_count, 'answered', r.answered_count, 'last_points', r.last_points,
             'prev_pos', r.prev_pos, 'finished', r.finished) order by r.pos), '[]'::jsonb)
      into v_board
      from (select * from private.ranking(s.id) order by pos limit 10) r;
  end if;

  if p_player is not null then
    select p.* into me from public.players p join public.player_tokens t on t.player_id = p.id
     where p.id = p_player and t.token = p_token and p.session_id = s.id;
    if not found then
      v_me := jsonb_build_object('kicked', true);
    else
      select * into a from public.answers where player_id = me.id and q_index = s.current_index;
      v_me := jsonb_build_object(
        'id', me.id, 'name', me.name, 'store', me.store, 'score', me.score, 'streak', me.streak,
        'correct', me.correct_count, 'answered', me.answered_count,
        'pos', (select r.pos from private.ranking(s.id) r where r.player_id = me.id),
        'answered_current', s.mode = 'live' and a.id is not null and a.chosen is not null);
      if s.mode = 'live' and s.status in ('reveal', 'ranking') then
        v_me := v_me || jsonb_build_object('last', case when a.id is null then null else jsonb_build_object(
                  'chosen', a.chosen, 'is_correct', a.is_correct, 'points', a.points,
                  'bonus', a.bonus, 'elapsed_ms', a.elapsed_ms) end);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'session', private.session_json(s), 'total_questions', v_total,
    'players', v_players, 'finished_players', v_finished,
    'question', v_q, 'leaderboard', v_board, 'me', v_me, 'server_now', clock_timestamp());
end $$;

create or replace function public.live_answer(p_player uuid, p_token uuid, p_index int, p_choice int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.players; s public.sessions; q public.session_questions; v_elapsed int;
begin
  me := private.assert_player(p_player, p_token);
  select * into s from public.sessions where id = me.session_id;
  if s.mode <> 'live' then raise exception 'Ação inválida para esta sala.'; end if;
  if s.status <> 'question' or s.current_index <> p_index then
    raise exception 'O tempo desta pergunta já acabou.';
  end if;
  if s.paused_at is not null then raise exception 'Jogo pausado. Aguarde o organizador.'; end if;
  if clock_timestamp() < s.question_started_at then raise exception 'A pergunta ainda não começou.'; end if;

  select * into q from public.session_questions where session_id = s.id and idx = p_index;
  if p_choice is null or p_choice < 0 or p_choice >= array_length(q.options, 1) then
    raise exception 'Alternativa inválida.';
  end if;

  v_elapsed := floor(extract(epoch from (clock_timestamp() - s.question_started_at)) * 1000)::int;
  if v_elapsed > q.time_limit * 1000 + 1500 then raise exception 'O tempo desta pergunta já acabou.'; end if;

  perform private.score_answer(me, p_index, p_choice, v_elapsed, q);
  return jsonb_build_object('ok', true);
end $$;

-- Modo "no seu ritmo": entrega a pergunta atual do participante
create or replace function public.self_current(p_player uuid, p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.players; s public.sessions; q public.session_questions; v_total int; v_order int[];
begin
  me := private.assert_player(p_player, p_token);
  select * into s from public.sessions where id = me.session_id;
  if s.mode <> 'self' then raise exception 'Ação inválida para esta sala.'; end if;
  if s.status = 'lobby' then return jsonb_build_object('state', 'waiting'); end if;
  select count(*) into v_total from public.session_questions where session_id = s.id;

  if me.q_order is null then
    if s.shuffle_questions then
      select array_agg(idx order by random()) into v_order from public.session_questions where session_id = s.id;
    else
      select array_agg(idx order by idx) into v_order from public.session_questions where session_id = s.id;
    end if;
    update public.players set q_order = coalesce(v_order, '{}') where id = me.id returning * into me;
  end if;

  loop
    if me.self_pos >= v_total then
      if me.finished_at is null then
        update public.players set finished_at = clock_timestamp() where id = me.id returning * into me;
      end if;
      return jsonb_build_object('state', 'done', 'session_status', s.status, 'total', v_total);
    end if;
    if s.status <> 'open' then
      return jsonb_build_object('state', 'closed', 'total', v_total);
    end if;

    select * into q from public.session_questions where session_id = s.id and idx = me.q_order[me.self_pos + 1];
    if me.q_started_at is null then
      update public.players set q_started_at = clock_timestamp() where id = me.id returning * into me;
    elsif s.timed and clock_timestamp() > me.q_started_at + make_interval(secs => (q.time_limit + 1.5)::float8) then
      -- tempo esgotado (ex.: fechou o navegador): conta como sem resposta e segue
      perform private.score_answer(me, q.idx, null, q.time_limit * 1000, q, true);
      update public.players set self_pos = self_pos + 1, q_started_at = null where id = me.id returning * into me;
      continue;
    end if;

    return jsonb_build_object(
      'state', 'question', 'position', me.self_pos, 'total', v_total,
      'score', me.score, 'streak', me.streak,
      'question', jsonb_build_object('idx', q.idx, 'category', q.category, 'text', q.text,
                                     'options', to_jsonb(q.options), 'time_limit', q.time_limit),
      'started_at', me.q_started_at, 'server_now', clock_timestamp());
  end loop;
end $$;

create or replace function public.self_answer(p_player uuid, p_token uuid, p_index int, p_choice int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.players; s public.sessions; q public.session_questions; a public.answers; v_total int; v_elapsed int;
begin
  me := private.assert_player(p_player, p_token);
  select * into s from public.sessions where id = me.session_id;
  if s.mode <> 'self' or s.status <> 'open' then
    raise exception 'Esta sala não está aberta para respostas.';
  end if;
  select count(*) into v_total from public.session_questions where session_id = s.id;
  if me.q_order is null or me.self_pos >= v_total or me.q_order[me.self_pos + 1] <> p_index or me.q_started_at is null then
    raise exception 'Pergunta fora de sequência. Recarregando…';
  end if;

  select * into q from public.session_questions where session_id = s.id and idx = p_index;
  if p_choice is not null and (p_choice < 0 or p_choice >= array_length(q.options, 1)) then
    raise exception 'Alternativa inválida.';
  end if;

  v_elapsed := floor(extract(epoch from (clock_timestamp() - me.q_started_at)) * 1000)::int;
  a := private.score_answer(me, p_index, p_choice, v_elapsed, q, s.timed);

  update public.players set
    self_pos     = self_pos + 1,
    q_started_at = null,
    finished_at  = case when self_pos + 1 >= v_total then clock_timestamp() else finished_at end
  where id = me.id returning * into me;

  return jsonb_build_object(
    'is_correct', a.is_correct, 'chosen', a.chosen,
    'timeout', a.chosen is null or (s.timed and v_elapsed > q.time_limit * 1000 + 1500),
    'correct_index', q.correct_index,
    'explanation', case when s.show_explanation then q.explanation end,
    'points', a.points, 'bonus', a.bonus, 'elapsed_ms', a.elapsed_ms,
    'score', me.score, 'streak', me.streak,
    'position', me.self_pos, 'total', v_total, 'done', me.self_pos >= v_total);
end $$;

-- Pódio, ranking completo, conquistas e ranking por loja
create or replace function public.session_results(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; v_total int; v_rank jsonb;
begin
  select * into s from public.sessions where id = p_session;
  if not found then raise exception 'Sessão não encontrada.' using errcode = 'P0002'; end if;
  select count(*) into v_total from public.session_questions where session_id = s.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.player_id, 'pos', r.pos, 'name', r.name, 'store', r.store, 'score', r.score,
           'correct', r.correct_count, 'answered', r.answered_count, 'best_streak', r.best_streak,
           'finished', r.finished, 'badges', to_jsonb(private.badges(r.player_id))) order by r.pos), '[]'::jsonb)
    into v_rank from private.ranking(s.id) r;

  return jsonb_build_object('session', private.session_json(s), 'total_questions', v_total,
                            'ranking', v_rank, 'stores', private.store_ranking(s.id));
end $$;

-- ---------------------------------------------------------------------
--  FUNÇÕES DO ADMINISTRADOR (todas exigem a senha)
-- ---------------------------------------------------------------------

create or replace function public.admin_login(p_pass text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_default boolean;
begin
  perform private.assert_admin(p_pass);
  select admin_hash = extensions.crypt('cipa2026', admin_hash) into v_default from public.app_settings where id = 1;
  return jsonb_build_object('ok', true, 'default_password', v_default);
end $$;

create or replace function public.admin_change_password(p_pass text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform private.assert_admin(p_pass);
  if p_new is null or length(p_new) < 6 then raise exception 'A nova senha precisa ter pelo menos 6 caracteres.'; end if;
  update public.app_settings set admin_hash = extensions.crypt(p_new, extensions.gen_salt('bf')) where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_get_settings(p_pass text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_admin(p_pass);
  return (select jsonb_build_object('stores', to_jsonb(stores)) from public.app_settings where id = 1);
end $$;

create or replace function public.admin_save_settings(p_pass text, p_stores text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  perform private.assert_admin(p_pass);
  select coalesce(array_agg(x order by ord), '{}') into v from (
    select distinct on (lower(btrim(x))) btrim(x) as x, ord
      from unnest(coalesce(p_stores, '{}')) with ordinality as u(x, ord)
     where btrim(x) <> ''
     order by lower(btrim(x)), ord) t;
  update public.app_settings set stores = v where id = 1;
  return jsonb_build_object('stores', to_jsonb(v));
end $$;

create or replace function public.admin_list_quizzes(p_pass text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_admin(p_pass);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', z.id, 'title', z.title, 'created_at', z.created_at,
            'questions', (select count(*) from public.questions q where q.quiz_id = z.id)) order by z.created_at), '[]'::jsonb)
            from public.quizzes z);
end $$;

create or replace function public.admin_save_quiz(p_pass text, p_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  perform private.assert_admin(p_pass);
  if coalesce(btrim(p_title), '') = '' then raise exception 'Informe o nome do questionário.'; end if;
  if v_id is null then
    insert into public.quizzes (title) values (btrim(p_title)) returning id into v_id;
  else
    update public.quizzes set title = btrim(p_title) where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.admin_delete_quiz(p_pass text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_admin(p_pass);
  delete from public.quizzes where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_duplicate_quiz(p_pass text, p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform private.assert_admin(p_pass);
  insert into public.quizzes (title) select title || ' (cópia)' from public.quizzes where id = p_id returning id into v_id;
  insert into public.questions (quiz_id, position, category, text, options, correct_index, time_limit, explanation)
  select v_id, position, category, text, options, correct_index, time_limit, explanation
    from public.questions where quiz_id = p_id;
  return v_id;
end $$;

create or replace function public.admin_get_questions(p_pass text, p_quiz uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_admin(p_pass);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', q.id, 'position', q.position, 'category', q.category, 'text', q.text,
            'options', to_jsonb(q.options), 'correct_index', q.correct_index,
            'time_limit', q.time_limit, 'explanation', q.explanation) order by q.position, q.created_at), '[]'::jsonb)
            from public.questions q where q.quiz_id = p_quiz);
end $$;

create or replace function public.admin_save_question(p_pass text, p_q jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_q->>'id', '')::uuid;
  v_quiz uuid := (p_q->>'quiz_id')::uuid;
  v_opts text[];
begin
  perform private.assert_admin(p_pass);
  select coalesce(array_agg(btrim(x) order by ord), '{}') into v_opts
    from jsonb_array_elements_text(coalesce(p_q->'options', '[]'::jsonb)) with ordinality as u(x, ord);
  if coalesce(btrim(p_q->>'text'), '') = '' then raise exception 'Escreva o enunciado da pergunta.'; end if;
  if array_length(v_opts, 1) is null or array_length(v_opts, 1) < 2 then raise exception 'Informe pelo menos 2 alternativas.'; end if;
  if exists (select 1 from unnest(v_opts) o where o = '') then raise exception 'Há alternativas em branco.'; end if;

  if v_id is null then
    insert into public.questions (quiz_id, position, category, text, options, correct_index, time_limit, explanation)
    values (v_quiz,
            coalesce((select max(position) + 1 from public.questions where quiz_id = v_quiz), 1),
            coalesce(nullif(btrim(p_q->>'category'), ''), 'Geral'),
            btrim(p_q->>'text'), v_opts, (p_q->>'correct_index')::int,
            coalesce((p_q->>'time_limit')::int, 30), nullif(btrim(p_q->>'explanation'), ''))
    returning id into v_id;
  else
    update public.questions set
      category      = coalesce(nullif(btrim(p_q->>'category'), ''), 'Geral'),
      text          = btrim(p_q->>'text'),
      options       = v_opts,
      correct_index = (p_q->>'correct_index')::int,
      time_limit    = coalesce((p_q->>'time_limit')::int, 30),
      explanation   = nullif(btrim(p_q->>'explanation'), '')
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.admin_delete_question(p_pass text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_admin(p_pass);
  delete from public.questions where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reorder_questions(p_pass text, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_admin(p_pass);
  update public.questions q set position = u.ord
    from unnest(p_ids) with ordinality as u(id, ord)
   where q.id = u.id;
  return jsonb_build_object('ok', true);
end $$;

drop function if exists public.admin_create_session(text, text, uuid, text, boolean, boolean, boolean);
create or replace function public.admin_create_session(
  p_pass text, p_name text, p_quiz uuid, p_mode text,
  p_shuffle_questions boolean, p_shuffle_options boolean, p_show_explanation boolean,
  p_timed boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pin text; v_id uuid; v_title text; v_count int;
begin
  perform private.assert_admin(p_pass);
  select title into v_title from public.quizzes where id = p_quiz;
  if not found then raise exception 'Escolha um questionário.'; end if;
  select count(*) into v_count from public.questions where quiz_id = p_quiz;
  if v_count = 0 then raise exception 'O questionário escolhido não tem perguntas.'; end if;
  if p_mode not in ('live', 'self') then raise exception 'Modo inválido.'; end if;

  loop
    v_pin := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when v_pin !~ '^0' and not exists (
      select 1 from public.sessions where pin = v_pin and status not in ('finished', 'closed'));
  end loop;

  insert into public.sessions (pin, name, quiz_id, quiz_title, mode, shuffle_questions, shuffle_options, show_explanation, timed)
  values (v_pin, coalesce(nullif(btrim(p_name), ''), 'Encontro CIPA'), p_quiz, v_title, p_mode,
          coalesce(p_shuffle_questions, false) and p_mode = 'self',
          coalesce(p_shuffle_options, false), coalesce(p_show_explanation, true),
          p_mode = 'live' or coalesce(p_timed, true))
  returning id into v_id;
  perform private.snapshot(v_id);
  return jsonb_build_object('id', v_id, 'pin', v_pin);
end $$;

create or replace function public.admin_list_sessions(p_pass text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_admin(p_pass);
  return (select coalesce(jsonb_agg(private.session_json(s) || jsonb_build_object(
            'players',   (select count(*) from public.players p where p.session_id = s.id),
            'questions', (select count(*) from public.session_questions sq where sq.session_id = s.id),
            'winner',    (select r.name from private.ranking(s.id) r where r.pos = 1 and r.score > 0))
            order by s.created_at desc), '[]'::jsonb)
            from public.sessions s);
end $$;

create or replace function public.admin_session_action(p_pass text, p_session uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; v_total int;
begin
  perform private.assert_admin(p_pass);
  select * into s from public.sessions where id = p_session for update;
  if not found then raise exception 'Sessão não encontrada.'; end if;
  select count(*) into v_total from public.session_questions where session_id = s.id;

  case p_action
    when 'start' then
      if s.mode <> 'live' or s.status <> 'lobby' then raise exception 'Esta sessão já foi iniciada.'; end if;
      perform private.snapshot(s.id);
      select count(*) into v_total from public.session_questions where session_id = s.id;
      if v_total = 0 then raise exception 'O questionário não tem perguntas.'; end if;
      update public.sessions set status = 'question', current_index = 0, paused_at = null,
             question_started_at = clock_timestamp() + interval '4 seconds', started_at = clock_timestamp()
       where id = s.id;

    when 'reveal' then
      if s.status = 'question' then perform private.reveal(s.id); end if;

    when 'ranking' then
      if s.status = 'reveal' then update public.sessions set status = 'ranking' where id = s.id; end if;

    when 'next' then
      if s.mode <> 'live' or s.status not in ('reveal', 'ranking') then
        raise exception 'Revele a resposta antes de avançar.';
      end if;
      if s.current_index + 1 >= v_total then
        update public.sessions set status = 'finished', finished_at = clock_timestamp() where id = s.id;
      else
        update public.sessions set status = 'question', current_index = current_index + 1, paused_at = null,
               question_started_at = clock_timestamp() + interval '4 seconds'
         where id = s.id;
      end if;

    when 'pause' then
      if s.status = 'question' and s.paused_at is null then
        update public.sessions set paused_at = clock_timestamp() where id = s.id;
      end if;

    when 'resume' then
      if s.paused_at is not null then
        update public.sessions set question_started_at = question_started_at + (clock_timestamp() - paused_at),
               paused_at = null where id = s.id;
      end if;

    when 'finish' then
      if s.mode = 'live' then
        if s.status = 'question' then perform private.reveal(s.id); end if;
        update public.sessions set status = 'finished', finished_at = clock_timestamp() where id = s.id;
      else
        update public.sessions set status = 'closed', finished_at = clock_timestamp() where id = s.id;
      end if;

    when 'open' then
      if s.mode <> 'self' then raise exception 'Ação inválida para o modo ao vivo.'; end if;
      if s.status = 'lobby' then
        perform private.snapshot(s.id);
        select count(*) into v_total from public.session_questions where session_id = s.id;
        if v_total = 0 then raise exception 'O questionário não tem perguntas.'; end if;
        update public.sessions set status = 'open', started_at = clock_timestamp() where id = s.id;
      elsif s.status = 'closed' then
        if exists (select 1 from public.sessions
                    where pin = s.pin and id <> s.id and status not in ('finished', 'closed')) then
          raise exception 'O PIN desta sala está em uso por outra sessão ativa.';
        end if;
        update public.sessions set status = 'open', finished_at = null where id = s.id;
      end if;

    else
      raise exception 'Ação desconhecida: %', p_action;
  end case;

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_remove_player(p_pass text, p_player uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_admin(p_pass);
  delete from public.players where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_delete_session(p_pass text, p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.assert_admin(p_pass);
  delete from public.sessions where id = p_session;
  return jsonb_build_object('ok', true);
end $$;

-- Relatório completo de uma sessão (p_full = inclui todas as respostas individuais)
create or replace function public.admin_session_report(p_pass text, p_session uuid, p_full boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; v_questions jsonb; v_players jsonb; v_answers jsonb;
begin
  perform private.assert_admin(p_pass);
  select * into s from public.sessions where id = p_session;
  if not found then raise exception 'Sessão não encontrada.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'idx', sq.idx, 'category', sq.category, 'text', sq.text, 'options', to_jsonb(sq.options),
           'correct_index', sq.correct_index, 'time_limit', sq.time_limit, 'explanation', sq.explanation,
           'answers',  (select count(*) from public.answers a where a.session_id = s.id and a.q_index = sq.idx),
           'correct',  (select count(*) from public.answers a where a.session_id = s.id and a.q_index = sq.idx and a.is_correct),
           'timeouts', (select count(*) from public.answers a where a.session_id = s.id and a.q_index = sq.idx and a.chosen is null),
           'avg_ms',   (select round(avg(a.elapsed_ms)) from public.answers a
                         where a.session_id = s.id and a.q_index = sq.idx and a.chosen is not null),
           'distribution', (select jsonb_agg((select count(*) from public.answers a
                                               where a.session_id = s.id and a.q_index = sq.idx and a.chosen = g.i) order by g.i)
                              from generate_series(0, array_length(sq.options, 1) - 1) as g(i))
         ) order by sq.idx), '[]'::jsonb)
    into v_questions
    from public.session_questions sq where sq.session_id = s.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.player_id, 'pos', r.pos, 'name', r.name, 'store', r.store, 'score', r.score,
           'correct', r.correct_count, 'answered', r.answered_count, 'best_streak', r.best_streak,
           'finished', r.finished, 'joined_at', r.joined_at,
           'avg_ms', (select round(avg(a.elapsed_ms)) from public.answers a where a.player_id = r.player_id and a.chosen is not null),
           'answered_current', exists (select 1 from public.answers a
                                        where a.player_id = r.player_id and a.q_index = s.current_index and a.chosen is not null),
           'badges', to_jsonb(private.badges(r.player_id))) order by r.pos), '[]'::jsonb)
    into v_players
    from private.ranking(s.id) r;

  if p_full then
    select coalesce(jsonb_agg(jsonb_build_object(
             'player_id', a.player_id, 'q', a.q_index, 'chosen', a.chosen, 'ok', a.is_correct,
             'ms', a.elapsed_ms, 'pts', a.points) order by a.player_id, a.q_index), '[]'::jsonb)
      into v_answers from public.answers a where a.session_id = s.id;
  end if;

  return jsonb_build_object('session', private.session_json(s), 'questions', v_questions,
                            'players', v_players, 'stores', private.store_ranking(s.id), 'answers', v_answers);
end $$;

grant usage on schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- ---------------------------------------------------------------------
--  PERGUNTAS INICIAIS (só são inseridas se ainda não existir nenhum questionário)
-- ---------------------------------------------------------------------
do $$
declare v_quiz uuid;
begin
  if exists (select 1 from public.quizzes) then return; end if;
  insert into public.quizzes (title) values ('Segurança e Prevenção ao Assédio') returning id into v_quiz;

  insert into public.questions (quiz_id, position, category, text, options, correct_index, time_limit, explanation) values
  (v_quiz, 1, 'Segurança do Trabalho', 'Qual é a principal finalidade do uso de EPI?',
   array['Melhorar a aparência', 'Proteger o trabalhador contra riscos', 'Aumentar a produtividade', 'Facilitar o trabalho'], 1, 30,
   'O EPI (Equipamento de Proteção Individual) existe para proteger a saúde e a integridade física do trabalhador contra os riscos da atividade (NR-6).'),

  (v_quiz, 2, 'Segurança do Trabalho', 'Quem deve utilizar o EPI corretamente?',
   array['Somente a liderança', 'Somente o SESMT', 'Todo trabalhador que necessitar do equipamento', 'Somente os funcionários novos'], 2, 30,
   'Todo trabalhador exposto ao risco deve usar o EPI adequado, independentemente do cargo ou do tempo de empresa.'),

  (v_quiz, 3, 'Segurança do Trabalho', 'Ao identificar uma condição insegura, o colaborador deve:',
   array['Ignorar', 'Continuar trabalhando', 'Comunicar a liderança/SESMT', 'Esperar alguém resolver'], 2, 30,
   'A condição insegura deve ser comunicada imediatamente à liderança ou ao SESMT para ser corrigida antes que cause um acidente.'),

  (v_quiz, 4, 'Segurança do Trabalho', 'É correto retirar uma proteção de uma máquina para facilitar o trabalho?',
   array['Sim', 'Somente quando estiver com pressa', 'Não', 'Somente com autorização de um colega'], 2, 30,
   'As proteções das máquinas nunca devem ser retiradas. Elas evitam cortes, esmagamentos e amputações (NR-12).'),

  (v_quiz, 5, 'Segurança do Trabalho', 'Em caso de acidente de trabalho, o correto é:',
   array['Esconder o acidente', 'Comunicar imediatamente a liderança', 'Continuar trabalhando sem avisar', 'Avisar somente no final do mês'], 1, 30,
   'Todo acidente deve ser comunicado na hora à liderança para garantir o atendimento, investigar as causas e emitir a CAT quando necessário.'),

  (v_quiz, 6, 'Segurança do Trabalho', 'O celular pode ser utilizado durante uma atividade que apresente risco?',
   array['Sim', 'Não, pois pode causar distração e acidentes', 'Somente rapidamente', 'Sempre que o funcionário quiser'], 1, 30,
   'O celular tira a atenção da tarefa. Em atividades com risco, uma distração de segundos pode causar um acidente.'),

  (v_quiz, 7, 'Segurança do Trabalho', 'Antes de utilizar um equipamento, é importante:',
   array['Verificar suas condições de segurança', 'Testá-lo de qualquer maneira', 'Retirar as proteções', 'Pedir para um colega fazer primeiro'], 0, 30,
   'Inspecionar o equipamento antes do uso ajuda a identificar defeitos, falta de proteção ou mau funcionamento.'),

  (v_quiz, 8, 'Segurança do Trabalho', 'O que significa trabalhar com segurança?',
   array['Fazer o trabalho o mais rápido possível', 'Evitar riscos e seguir os procedimentos de segurança', 'Trabalhar sem EPI', 'Fazer somente o que o líder estiver vendo'], 1, 30,
   'Trabalhar com segurança é seguir os procedimentos e evitar riscos o tempo todo, e não só quando alguém está olhando.'),

  (v_quiz, 9, 'Segurança do Trabalho', 'Uma saída de emergência deve permanecer:',
   array['Obstruída', 'Fechada com materiais na frente', 'Livre e desobstruída', 'Utilizada como depósito'], 2, 30,
   'As saídas de emergência precisam estar sempre livres para permitir a evacuação rápida de todos em caso de emergência.'),

  (v_quiz, 10, 'Segurança do Trabalho', 'O que fazer ao perceber um piso molhado?',
   array['Ignorar', 'Sinalizar e comunicar o responsável', 'Passar rapidamente', 'Esperar alguém cair'], 1, 30,
   'Piso molhado deve ser sinalizado e comunicado ao responsável para evitar escorregões e quedas, que estão entre os acidentes mais comuns.'),

  (v_quiz, 11, 'Prevenção ao Assédio', 'Assédio moral é:',
   array['Respeitar os colegas e manter uma comunicação profissional', 'Uma brincadeira entre amigos',
         'Comportamento que humilha, constrange ou desrespeita repetidamente alguém no trabalho', 'Uma cobrança normal de tarefa'], 2, 30,
   'O assédio moral é a exposição repetida de alguém a situações humilhantes, constrangedoras ou desrespeitosas no trabalho.'),

  (v_quiz, 12, 'Prevenção ao Assédio', 'Uma brincadeira deixa de ser adequada quando:',
   array['Todos riem', 'Causa constrangimento ou ofende alguém', 'É feita de forma descontraída', 'É feita entre colegas'], 1, 30,
   'A brincadeira deixa de ser aceitável quando constrange ou ofende alguém, mesmo que outras pessoas achem graça.'),

  (v_quiz, 13, 'Prevenção ao Assédio', 'Se um colega pedir para você parar uma brincadeira porque se sentiu ofendido, o correto é:',
   array['Continuar', 'Ignorar', 'Respeitar o pedido e parar', 'Fazer a brincadeira com outra pessoa'], 2, 30,
   'Se alguém pediu para parar, respeite. Quem define o limite é a pessoa que se sentiu ofendida.'),

  (v_quiz, 14, 'Prevenção ao Assédio', 'Quem pode sofrer assédio no ambiente de trabalho?',
   array['Somente mulheres', 'Somente homens', 'Qualquer pessoa', 'Somente funcionários novos'], 2, 30,
   'Qualquer pessoa pode sofrer assédio, independentemente de gênero, cargo, idade ou tempo de empresa.'),

  (v_quiz, 15, 'Prevenção ao Assédio', 'Ao presenciar uma situação de assédio, o colaborador deve:',
   array['Incentivar', 'Ignorar sempre', 'Procurar os canais responsáveis e comunicar a situação', 'Espalhar para os colegas'], 2, 30,
   'Quem presencia um assédio deve comunicar pelos canais responsáveis. O silêncio ajuda o problema a continuar.'),

  (v_quiz, 16, 'Prevenção ao Assédio', 'Uma denúncia de assédio deve ser tratada:',
   array['Como fofoca', 'Com seriedade e respeito à confidencialidade', 'Como brincadeira', 'Publicamente'], 1, 30,
   'Denúncias devem ser tratadas com seriedade e sigilo, protegendo quem denuncia e garantindo uma apuração justa.'),

  (v_quiz, 17, 'Prevenção ao Assédio', 'É correto humilhar um funcionário na frente dos colegas para chamar sua atenção?',
   array['Sim', 'Somente se ele tiver errado', 'Não', 'Somente quando houver pressa'], 2, 30,
   'Humilhar alguém em público nunca é uma forma aceitável de correção. O feedback deve ser dado com respeito e, de preferência, em particular.'),

  (v_quiz, 18, 'Prevenção ao Assédio', 'Cobrar uma atividade de forma respeitosa é:',
   array['Assédio moral', 'Uma prática normal de gestão', 'Assédio sexual', 'Proibido'], 1, 30,
   'Cobrar resultados com respeito faz parte da gestão. O assédio está na humilhação e no desrespeito, não na cobrança.'),

  (v_quiz, 19, 'Prevenção ao Assédio', 'O respeito no ambiente de trabalho é responsabilidade:',
   array['Somente da empresa', 'Somente da liderança', 'De todos os colaboradores', 'Somente do SESMT'], 2, 30,
   'O respeito é responsabilidade de todos. Cada colaborador contribui para um ambiente de trabalho saudável.'),

  (v_quiz, 20, 'Prevenção ao Assédio', 'Se você sofrer uma situação de assédio, o mais adequado é:',
   array['Guardar para si', 'Procurar um canal responsável e relatar a situação', 'Revidar com agressão', 'Conversar apenas com colegas e não comunicar a empresa'], 1, 30,
   'Quem sofre assédio deve procurar um canal responsável (liderança, RH, CIPA ou canal de denúncia) e relatar o que aconteceu.'),

  (v_quiz, 21, 'Prevenção ao Assédio', 'O objetivo das campanhas de prevenção ao assédio é:',
   array['Criar conflitos', 'Orientar, prevenir e promover um ambiente respeitoso', 'Punir todos os funcionários', 'Aumentar a cobrança'], 1, 30,
   'As campanhas existem para orientar, prevenir e promover um ambiente de trabalho respeitoso para todos.'),

  (v_quiz, 22, 'Prevenção ao Assédio', 'Segurança e respeito no trabalho são importantes porque:',
   array['Melhoram a convivência e ajudam a prevenir acidentes e situações de violência/assédio', 'Servem apenas para cumprir regras',
         'São responsabilidade somente do SESMT', 'Não interferem no ambiente de trabalho'], 0, 30,
   'Segurança e respeito melhoram a convivência e previnem acidentes e situações de violência ou assédio.'),

  (v_quiz, 23, 'Prevenção ao Assédio', 'Qual atitude contribui para um ambiente de trabalho seguro e respeitoso?',
   array['Respeitar as pessoas, seguir as normas e comunicar situações de risco ou assédio', 'Ignorar problemas',
         'Fazer brincadeiras ofensivas', 'Não utilizar EPI para trabalhar mais rápido'], 0, 30,
   'Respeitar as pessoas, seguir as normas e comunicar riscos ou assédio é a atitude que protege todos.');
end $$;
