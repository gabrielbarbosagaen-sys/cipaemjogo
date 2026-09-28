import {
  configured, rpc, now, subscribe, $, $$, esc, showScreen, toast, fmt, medal, initials, avatarColor,
  LETTERS, shape, optionOrder, badgeInfo, ALL_BADGES, celebrate, trophy, store, notConfiguredHtml, keepAwake
} from './common.js';

const KEY = 'cipa_player';
let me = store.get(KEY);          // { player_id, token, session_id, pin, name }
let state = null;                 // último live_state
let screenKey = '';
let unsub = null, pollTimer = null, tickTimer = null;
let refreshing = false, refreshAgain = false;
const localAnswers = {};          // modo ao vivo: idx -> alternativa enviada
const timeUpRefreshed = {};
let joinInfo = null;

// modo "no seu ritmo"
let selfPhase = 'idle';           // idle | question | feedback | done
let selfQ = null;
let selfBusy = false;
let lastFinalLoad = 0;

const auth = () => ({ p_player: me.player_id, p_token: me.token });
const game = () => $('#game');

// =====================================================================
//  ENTRADA
// =====================================================================
function init() {
  if (!configured) { $('#main').innerHTML = notConfiguredHtml(); return; }
  const pin = new URLSearchParams(location.search).get('pin') || '';
  if (me?.player_id) resume();
  else showJoin(pin);

  $('#pin').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    $('#join-msg').textContent = '';
    if (e.target.value.length === 6) lookupPin();
  });
  $('#form-pin').addEventListener('submit', e => { e.preventDefault(); lookupPin(); });
  $('#form-join').addEventListener('submit', e => { e.preventDefault(); join(); });
  $('#btn-back').addEventListener('click', () => {
    $('#form-join').classList.add('hidden');
    $('#form-pin').classList.remove('hidden');
    $('#pin').value = '';
    $('#pin').focus();
  });
  $('#btn-leave').addEventListener('click', () => {
    if (confirm('Deseja sair do jogo? Sua pontuação fica registrada, mas você precisará entrar de novo com outro nome.')) leave();
  });
  $('#btn-retry').addEventListener('click', () => location.reload());
}

function showJoin(pin = '', msg = '') {
  stopGame();
  $('#btn-leave').classList.add('hidden');
  showScreen('s-join');
  $('#form-join').classList.add('hidden');
  $('#form-pin').classList.remove('hidden');
  $('#pin').value = pin;
  $('#join-msg').textContent = msg;
  if (pin.length === 6) lookupPin();
}

async function lookupPin() {
  const pin = $('#pin').value.trim();
  if (pin.length !== 6) { $('#join-msg').textContent = 'O PIN tem 6 números.'; return; }
  $('#btn-pin').disabled = true;
  try {
    joinInfo = await rpc('get_join_info', { p_pin: pin });
    if (['finished', 'closed'].includes(joinInfo.status)) {
      $('#join-msg').textContent = 'Esta sala já foi encerrada.';
      return;
    }
    $('#join-session-name').textContent = joinInfo.name;
    $('#join-mode').textContent = joinInfo.mode === 'live' ? 'Ao vivo' : 'No seu ritmo';
    const stores = joinInfo.stores || [];
    $('#store-field').innerHTML = stores.length
      ? `<label for="store">Sua loja / setor</label>
         <select id="store" required><option value="">Selecione…</option>${stores.map(s => `<option>${esc(s)}</option>`).join('')}</select>`
      : `<label for="store">Sua loja / setor</label>
         <input id="store" type="text" maxlength="40" placeholder="Ex.: Loja Centro, Açougue, CD" required>`;
    const last = store.get('cipa_last_identity');
    if (last) {
      $('#name').value = last.name || '';
      if (last.store && (!stores.length || stores.includes(last.store))) $('#store').value = last.store;
    }
    $('#form-pin').classList.add('hidden');
    $('#form-join').classList.remove('hidden');
    $('#join-msg').textContent = '';
    if (!$('#name').value) $('#name').focus();
  } catch (e) {
    $('#join-msg').textContent = e.message;
  } finally {
    $('#btn-pin').disabled = false;
  }
}

async function join() {
  const name = $('#name').value.trim();
  const storeName = $('#store').value.trim();
  if (name.length < 2) { $('#join-msg').textContent = 'Informe seu nome.'; return; }
  if (!storeName) { $('#join-msg').textContent = 'Informe sua loja ou setor.'; return; }
  $('#btn-join').disabled = true;
  try {
    const r = await rpc('join_session', { p_pin: joinInfo.pin, p_name: name, p_store: storeName });
    me = { ...r, name };
    store.set(KEY, me);
    store.set('cipa_last_identity', { name, store: storeName });
    history.replaceState(null, '', location.pathname);
    await startGame();
  } catch (e) {
    $('#join-msg').textContent = e.message;
  } finally {
    $('#btn-join').disabled = false;
  }
}

async function resume() {
  try {
    await startGame();
  } catch (e) {
    if (e.code === 'P0002') {
      const pin = me?.pin || '';
      clearMe();
      showJoin(pin, 'Sua participação anterior não foi encontrada. Entre novamente.');
    } else {
      $('#error-msg').textContent = e.message;
      showScreen('s-error');
    }
  }
}

function clearMe() { store.del(KEY); me = null; state = null; screenKey = ''; selfPhase = 'idle'; selfQ = null; }
function leave() { const pin = me?.pin || ''; clearMe(); showJoin(pin); }
function kicked() { clearMe(); showJoin('', 'Você foi removido da sala pelo organizador.'); }

function stopGame() {
  unsub?.(); unsub = null;
  clearInterval(pollTimer); clearInterval(tickTimer);
}

async function startGame() {
  stopGame();
  keepAwake();
  $('#btn-leave').classList.remove('hidden');
  showScreen('s-game');
  game().innerHTML = '<div class="waiting-ring"></div>';
  await refresh(true);
  // o celular só escuta mudanças da sala; a contagem de participantes vem pela atualização periódica
  unsub = subscribe(me.session_id, onRemote, { players: false });
  pollTimer = setInterval(onRemote, 4000);
  tickTimer = setInterval(tick, 100);
}

function onRemote() {
  if (!me) return;
  if (state?.session.mode === 'self' && (selfPhase === 'question' || selfPhase === 'feedback')) return;
  refresh().catch(() => {});
}

async function refresh(throwErrors = false) {
  if (!me) return;
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    const st = await rpc('live_state', { p_session: me.session_id, ...auth() });
    if (!me) return;
    state = st;
    if (st.me?.kicked) { kicked(); return; }
    render();
  } catch (e) {
    if (e.code === 'P0002') { kicked(); return; }
    if (throwErrors) throw e;
  } finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; refresh().catch(() => {}); }
  }
}

function setScreen(key, build, update) {
  if (screenKey !== key) { screenKey = key; build(); }
  update?.();
}

function render() {
  if (!state) return;
  if (state.session.mode === 'self') renderSelf();
  else renderLive();
}

// =====================================================================
//  MODO AO VIVO
// =====================================================================
function renderLive() {
  const s = state.session;
  const q = state.question;
  switch (s.status) {
    case 'lobby':
      return setScreen('lobby', buildLobby, updateLobby);
    case 'question': {
      const start = Date.parse(s.question_started_at);
      const end = start + q.time_limit * 1000;
      if (s.paused_at) return setScreen('paused' + q.idx, buildPaused);
      if (now() < start) return setScreen('cd' + q.idx, buildCountdown, updateCountdown);
      if (state.me?.answered_current || localAnswers[q.idx] !== undefined) return setScreen('sent' + q.idx, buildSent, updateSent);
      if (now() >= end) return setScreen('timeup' + q.idx, buildTimeUp, updateSent);
      return setScreen('q' + q.idx, buildLiveQuestion);
    }
    case 'reveal':
      return setScreen('r' + q.idx, buildReveal);
    case 'ranking':
      return setScreen('k' + q.idx, buildRanking);
    case 'finished':
      return setScreen('final', () => loadFinal('finished'));
  }
}

function tick() {
  if (!state || !me) return;
  const s = state.session;
  if (s.mode === 'live' && s.status === 'question' && !s.paused_at) {
    const q = state.question;
    const start = Date.parse(s.question_started_at);
    const end = start + q.time_limit * 1000;
    if (screenKey.startsWith('cd')) {
      if (now() >= start) render(); else updateCountdown();
    } else if (screenKey === 'q' + q.idx) {
      if (now() >= end) render();
      else updateTimer(end - now(), q.time_limit);
    }
    if (now() >= end + 300 && !timeUpRefreshed[q.idx]) {
      timeUpRefreshed[q.idx] = true;
      setTimeout(() => refresh().catch(() => {}), 200 + Math.random() * 900);
    }
  }
  if (s.mode === 'self' && selfPhase === 'question' && selfQ && !selfQ.sent) {
    const end = selfQ.start + selfQ.question.time_limit * 1000;
    const left = end - now();
    updateTimer(left, selfQ.question.time_limit);
    if (left <= 0) selfSubmit(null);
  }
}

function updateTimer(leftMs, limit) {
  const bar = $('#timer-bar'), num = $('#timer-num');
  if (!bar) return;
  const frac = Math.max(0, Math.min(1, leftMs / (limit * 1000)));
  bar.firstElementChild.style.transform = `scaleX(${frac})`;
  bar.classList.toggle('low', leftMs < 5000);
  num.textContent = Math.max(0, Math.ceil(leftMs / 1000));
}

function header(pos, total, category, extra = '') {
  return `<div class="qhead">
    <span class="qcount">Pergunta <b>${pos}</b> de ${total}</span>
    <span class="row" style="gap:6px">${category ? `<span class="chip yellow">${esc(category)}</span>` : ''}${extra}</span>
  </div>`;
}

function scoringTips() {
  return `<div class="card" style="margin-top:16px">
    <h3>Dicas para pontuar</h3>
    <ul class="small muted" style="margin:0;padding-left:18px">
      <li>Responda rápido: até <b style="color:var(--text)">1.000 pontos</b> por acerto.</li>
      <li>Acertos seguidos rendem <b style="color:var(--text)">bônus de até +500</b>.</li>
      <li>Leia com atenção: errar zera a sequência.</li>
    </ul>
  </div>`;
}

function buildLobby() {
  const live = state.session.mode === 'live';
  game().innerHTML = `
    <div class="card hazard center">
      <div class="avatar xl" style="background:${avatarColor(state.me.name)}">${esc(initials(state.me.name))}</div>
      <h2>Você está dentro, ${esc(state.me.name.split(' ')[0])}!</h2>
      <p class="muted">${esc(state.me.store)} · Sala <b style="color:var(--text)">${esc(state.session.name)}</b></p>
      <div class="waiting-ring"></div>
      <p><b>Aguardando o organizador ${live ? 'iniciar o jogo' : 'abrir a sala'}…</b></p>
      <p class="muted small">${live ? 'As perguntas aparecem no telão e aqui no seu celular.' : 'Quando a sala abrir, as perguntas aparecem aqui automaticamente.'}</p>
      <span class="chip green"><span class="dot pulse"></span><span id="lobby-count"></span></span>
    </div>
    ${scoringTips()}`;
}
function updateLobby() {
  const n = state.players;
  const el = $('#lobby-count');
  if (el) el.textContent = `${n} participante${n === 1 ? '' : 's'} na sala`;
}

function buildCountdown() {
  const q = state.question;
  game().innerHTML = `
    <div class="countdown">
      <p class="qcount">Pergunta <b>${q.idx + 1}</b> de ${state.total_questions}</p>
      <span class="chip yellow">${esc(q.category)}</span>
      <div class="num" id="cd-num"></div>
      <p class="muted">Prepare-se!</p>
    </div>`;
}
function updateCountdown() {
  const el = $('#cd-num');
  if (!el) return;
  const n = Math.max(1, Math.ceil((Date.parse(state.session.question_started_at) - now()) / 1000));
  if (el.textContent !== String(n)) {
    el.textContent = n;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }
}

function buildPaused() {
  game().innerHTML = `
    <div class="card center">
      <div style="font-size:3rem">⏸️</div>
      <h2>Jogo pausado</h2>
      <p class="muted">O organizador pausou a pergunta. O tempo continua de onde parou.</p>
    </div>`;
}

function optionsHtml(q, order, { disabled = false } = {}) {
  return `<div class="options">${order.map((orig, pos) => `
    <button class="opt c${pos % 6}" data-i="${orig}" type="button" ${disabled ? 'disabled' : ''}>
      ${shape(pos)}<span class="letter">${LETTERS[pos]}</span><span>${esc(q.options[orig])}</span>
    </button>`).join('')}</div>`;
}

function buildLiveQuestion() {
  const s = state.session, q = state.question;
  const order = optionOrder(q.options.length, me.player_id + ':' + q.idx, s.shuffle_options);
  game().innerHTML = `
    ${header(q.idx + 1, state.total_questions, q.category)}
    <div class="row" style="gap:10px;flex-wrap:nowrap">
      <div class="timerbar grow" id="timer-bar"><i></i></div>
      <span class="timer-num" id="timer-num"></span>
    </div>
    <p class="qtext">${esc(q.text)}</p>
    ${optionsHtml(q, order)}
    <p class="center small muted" style="margin-top:14px">Pontuação atual: <b style="color:var(--text)">${fmt(state.me.score)}</b>${state.me.streak >= 2 ? ` · 🔥 ${state.me.streak} seguidas` : ''}</p>`;
  const start = Date.parse(s.question_started_at);
  updateTimer(start + q.time_limit * 1000 - now(), q.time_limit);
  $$('.opt', game()).forEach(btn => btn.addEventListener('click', () => sendLive(q.idx, Number(btn.dataset.i), btn)));
}

async function sendLive(idx, choice, btn) {
  if (localAnswers[idx] !== undefined) return;
  localAnswers[idx] = choice;
  $$('.opt', game()).forEach(b => { b.disabled = true; if (b !== btn) b.classList.add('dim'); });
  btn.classList.add('chosen');
  try {
    await rpc('live_answer', { ...auth(), p_index: idx, p_choice: choice });
    if (navigator.vibrate) navigator.vibrate(40);
    render();
    setTimeout(() => refresh().catch(() => {}), 350);
  } catch (e) {
    toast(e.message, 'error');
    if (/acabou|pausado|registrada/.test(e.message)) { refresh().catch(() => {}); return; }
    delete localAnswers[idx];
    screenKey = '';
    render();
  }
}

function buildSent() {
  const q = state.question;
  const chosen = localAnswers[q.idx];
  game().innerHTML = `
    ${header(q.idx + 1, state.total_questions, q.category)}
    <div class="card center">
      <div style="font-size:3rem">🤞</div>
      <h2>Resposta enviada!</h2>
      ${chosen !== undefined ? `<p class="muted">Você respondeu: <b style="color:var(--text)">${esc(q.options[chosen])}</b></p>` : ''}
      <div class="waiting-ring"></div>
      <p class="muted" id="sent-count"></p>
    </div>`;
}
function buildTimeUp() {
  const q = state.question;
  game().innerHTML = `
    ${header(q.idx + 1, state.total_questions, q.category)}
    <div class="card center">
      <div style="font-size:3rem">⏱️</div>
      <h2>Tempo esgotado!</h2>
      <p class="muted">Aguarde a resposta certa aparecer.</p>
      <div class="waiting-ring"></div>
      <p class="muted" id="sent-count"></p>
    </div>`;
}
function updateSent() {
  const el = $('#sent-count');
  if (el) el.textContent = `${state.question.answered} de ${state.players} já responderam`;
}

function resultBox({ last, streak }) {
  if (!last) {
    return `<div class="result neutral pop"><div class="big-icon">👋</div><h2>Você entrou agora</h2>
      <p class="sub">Sua pontuação começa a contar na próxima pergunta.</p></div>`;
  }
  if (last.chosen === null) {
    return `<div class="result late pop"><div class="big-icon">⏱️</div><h2>Tempo esgotado</h2>
      <div class="pts">+0</div><p class="sub">Na próxima, responda antes do tempo acabar!</p></div>`;
  }
  if (last.is_correct) {
    return `<div class="result ok pop"><div class="big-icon">✅</div><h2>Correto!</h2>
      <div class="pts">+${fmt(last.points)}</div>
      <p class="sub">${last.bonus ? `Inclui +${fmt(last.bonus)} de bônus de sequência` : `Respondeu em ${(last.elapsed_ms / 1000).toFixed(1)} s`}</p>
      ${streak >= 2 ? `<p class="sub" style="margin-top:6px">🔥 ${streak} acertos seguidos!</p>` : ''}</div>`;
  }
  return `<div class="result bad pop"><div class="big-icon">❌</div><h2>Não foi dessa vez</h2>
    <div class="pts">+0</div><p class="sub">Confira abaixo a resposta certa.</p></div>`;
}

function correctLine(q, correctIndex, order) {
  const pos = order.indexOf(correctIndex);
  return `<div class="answer-line">${shape(pos)}<span><span class="small muted">Resposta certa</span><br>${esc(q.options[correctIndex])}</span></div>`;
}

function explainBox(text) {
  return text ? `<div class="explain"><b>Você sabia?</b>${esc(text)}</div>` : '';
}

function buildReveal() {
  const s = state.session, q = state.question, m = state.me;
  const order = optionOrder(q.options.length, me.player_id + ':' + q.idx, s.shuffle_options);
  game().innerHTML = `
    ${header(q.idx + 1, state.total_questions, q.category)}
    ${resultBox(m)}
    ${correctLine(q, q.correct_index, order)}
    ${explainBox(q.explanation)}
    <div class="stats">
      <div class="stat"><b>${fmt(m.score)}</b><span>Pontos</span></div>
      <div class="stat"><b>${m.pos ? m.pos + 'º' : '–'}</b><span>Posição</span></div>
      <div class="stat"><b>${m.correct}/${m.answered}</b><span>Acertos</span></div>
    </div>
    <p class="center muted small">Aguarde a próxima pergunta…</p>`;
  if (m.last?.is_correct) celebrate(0.35);
  if (navigator.vibrate) navigator.vibrate(m.last?.is_correct ? [60, 40, 60] : 200);
}

function boardHtml(list, myId, { gain = false } = {}) {
  return `<ol class="board">${list.map((p, i) => `
    <li class="${p.id === myId ? 'me' : ''}" style="animation-delay:${i * 60}ms">
      <span class="pos">${medal(p.pos) || p.pos}</span>
      <span class="who"><b>${esc(p.name)}</b><small>${esc(p.store)}</small></span>
      ${gain && p.last_points ? `<span class="gain">+${fmt(p.last_points)}</span>` : ''}
      <span class="score">${fmt(p.score)}</span>
    </li>`).join('')}</ol>`;
}

function buildRanking() {
  const m = state.me;
  const mine = state.leaderboard.find(p => p.id === m.id);
  let move = '';
  if (mine && mine.prev_pos !== mine.pos) {
    move = mine.prev_pos > mine.pos
      ? `<span class="move-up">▲ subiu ${mine.prev_pos - mine.pos} posição${mine.prev_pos - mine.pos > 1 ? 'ões' : ''}</span>`
      : `<span class="move-down">▼ caiu ${mine.pos - mine.prev_pos}</span>`;
  }
  game().innerHTML = `
    <div class="card hazard center">
      <p class="muted" style="margin:0">Sua posição</p>
      <div class="display" style="font-size:4.5rem;color:var(--yellow)">${m.pos}º</div>
      <p style="margin:0"><b>${fmt(m.score)} pontos</b> ${move ? '· ' + move : ''}</p>
    </div>
    <div class="card">
      <h3>Top 5</h3>
      ${boardHtml(state.leaderboard.slice(0, 5), m.id, { gain: true })}
    </div>
    <p class="center muted small">Aguarde a próxima pergunta…</p>`;
}

// =====================================================================
//  MODO NO SEU RITMO
// =====================================================================
function renderSelf() {
  const s = state.session;
  if (s.status === 'lobby') { selfPhase = 'idle'; return setScreen('lobby', buildLobby, updateLobby); }
  if (selfPhase === 'idle') { selfNext(); return; }
  if (selfPhase === 'done' && Date.now() - lastFinalLoad > 5000) loadFinal(s.status === 'open' ? 'self-open' : 'finished');
}

async function selfNext() {
  if (selfBusy || !me) return;
  selfBusy = true;
  try {
    const r = await rpc('self_current', auth());
    if (r.state === 'waiting') {
      selfPhase = 'idle';
      setScreen('lobby', buildLobby, updateLobby);
    } else if (r.state === 'question') {
      selfPhase = 'question';
      selfQ = { ...r, start: Date.parse(r.started_at), sent: false };
      screenKey = 'self-q' + r.question.idx;
      buildSelfQuestion();
    } else {
      selfPhase = 'done';
      await loadFinal(r.state === 'closed' ? 'closed' : (r.session_status === 'open' ? 'self-open' : 'finished'));
    }
  } catch (e) {
    if (e.code === 'P0002') { kicked(); return; }
    toast(e.message, 'error');
    selfPhase = 'idle';
  } finally {
    selfBusy = false;
  }
}

function buildSelfQuestion() {
  const q = selfQ.question;
  const order = optionOrder(q.options.length, me.player_id + ':' + q.idx, state.session.shuffle_options);
  game().innerHTML = `
    ${header(selfQ.position + 1, selfQ.total, q.category)}
    <div class="row" style="gap:10px;flex-wrap:nowrap">
      <div class="timerbar grow" id="timer-bar"><i></i></div>
      <span class="timer-num" id="timer-num"></span>
    </div>
    <p class="qtext">${esc(q.text)}</p>
    ${optionsHtml(q, order)}
    <p class="center small muted" style="margin-top:14px">Pontuação: <b style="color:var(--text)">${fmt(selfQ.score)}</b>${selfQ.streak >= 2 ? ` · 🔥 ${selfQ.streak} seguidas` : ''}</p>`;
  updateTimer(selfQ.start + q.time_limit * 1000 - now(), q.time_limit);
  $$('.opt', game()).forEach(btn => btn.addEventListener('click', () => selfSubmit(Number(btn.dataset.i), btn)));
}

async function selfSubmit(choice, btn) {
  if (!selfQ || selfQ.sent) return;
  selfQ.sent = true;
  $$('.opt', game()).forEach(b => { b.disabled = true; if (b !== btn) b.classList.add('dim'); });
  btn?.classList.add('chosen');
  try {
    const r = await rpc('self_answer', { ...auth(), p_index: selfQ.question.idx, p_choice: choice });
    selfPhase = 'feedback';
    buildSelfFeedback(r);
  } catch (e) {
    if (e.code === 'P0002') { kicked(); return; }
    toast(e.message, 'error');
    selfPhase = 'idle';
    selfNext();
  }
}

function buildSelfFeedback(r) {
  const q = selfQ.question;
  const order = optionOrder(q.options.length, me.player_id + ':' + q.idx, state.session.shuffle_options);
  const last = { chosen: r.timeout ? null : r.chosen, is_correct: r.is_correct, points: r.points, bonus: r.bonus, elapsed_ms: r.elapsed_ms };
  game().innerHTML = `
    ${header(selfQ.position + 1, selfQ.total, q.category)}
    ${resultBox({ last, streak: r.streak })}
    ${correctLine(q, r.correct_index, order)}
    ${explainBox(r.explanation)}
    <div class="stats">
      <div class="stat"><b>${fmt(r.score)}</b><span>Pontos</span></div>
      <div class="stat"><b>${r.streak}</b><span>Sequência</span></div>
      <div class="stat"><b>${r.position}/${r.total}</b><span>Respondidas</span></div>
    </div>
    <button class="btn btn-primary btn-lg btn-block" id="btn-next" type="button">${r.done ? 'Ver meu resultado 🏆' : 'Próxima pergunta →'}</button>`;
  if (r.is_correct) celebrate(0.35);
  if (navigator.vibrate) navigator.vibrate(r.is_correct ? [60, 40, 60] : 200);
  $('#btn-next').addEventListener('click', () => { selfPhase = 'idle'; selfNext(); });
  $('#btn-next').focus();
}

// =====================================================================
//  RESULTADO FINAL
// =====================================================================
async function loadFinal(kind) {
  lastFinalLoad = Date.now();
  screenKey = 'final';
  let res;
  try {
    res = await rpc('session_results', { p_session: me.session_id });
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  if (!me) return;
  const mine = res.ranking.find(p => p.id === me.player_id);
  if (!mine) { kicked(); return; }
  const firstRender = !$('#final-root');
  const top3 = res.ranking.slice(0, 3);
  const earned = mine.badges || [];
  const catBadges = earned.filter(b => b.startsWith('cat:'));
  const allCodes = [...ALL_BADGES.filter(b => b !== 'presenca'), ...catBadges, 'presenca'];
  const title = {
    finished: 'Fim de jogo!',
    'self-open': 'Você concluiu o quiz!',
    closed: 'A sala foi encerrada'
  }[kind];
  const note = {
    finished: '',
    'self-open': '<p class="muted small center">Ranking parcial: o pódio final sai quando o organizador encerrar a sala.</p>',
    closed: mine.answered < res.total_questions ? '<p class="muted small center">A sala foi encerrada antes de você terminar todas as perguntas.</p>' : ''
  }[kind];
  const myStore = res.stores.find(s => s.store === mine.store);

  game().innerHTML = `
    <div id="final-root">
      <div class="center"><h1>${title}</h1>${note}</div>
      ${top3.length ? `<div class="podium">${[1, 0, 2].map(i => top3[i] ? `
        <div class="place p${i + 1}" data-order="${i}">
          ${trophy(['gold', 'silver', 'bronze'][i])}
          <div class="name">${esc(top3[i].name)}</div>
          <div class="store">${esc(top3[i].store)}</div>
          <div class="pts">${fmt(top3[i].score)}</div>
          <div class="block">${i + 1}º</div>
        </div>` : '<div></div>').join('')}</div>` : ''}

      <div class="card hazard center">
        <p class="muted" style="margin:0">Sua colocação</p>
        <div class="display" style="font-size:4rem;color:var(--yellow)">${medal(mine.pos)} ${mine.pos}º</div>
        <p style="margin:0">de ${res.ranking.length} participantes</p>
        <div class="stats">
          <div class="stat"><b>${fmt(mine.score)}</b><span>Pontos</span></div>
          <div class="stat"><b>${mine.correct}/${res.total_questions}</b><span>Acertos</span></div>
          <div class="stat"><b>${mine.best_streak}</b><span>Maior sequência</span></div>
        </div>
      </div>

      <div class="card">
        <h3>Suas conquistas <span class="muted small">(${earned.length})</span></h3>
        <div class="badges">${allCodes.map(code => {
          const b = badgeInfo(code);
          const has = earned.includes(code);
          return `<div class="badge ${has ? 'earned' : 'locked'}"><span class="ic">${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`;
        }).join('')}</div>
      </div>

      ${res.stores.length ? `<div class="card">
        <h3>Ranking das lojas</h3>
        <p class="muted small">Média de pontos por participante.${myStore ? ` Sua loja está em <b style="color:var(--text)">${myStore.pos}º</b>.` : ''}</p>
        <ol class="board">${res.stores.slice(0, 5).map(s => `
          <li class="${s.store === mine.store ? 'me' : ''}">
            <span class="pos">${medal(s.pos) || s.pos}</span>
            <span class="who"><b>${esc(s.store)}</b><small>${s.players} participante${s.players > 1 ? 's' : ''} · ${s.correct_pct ?? 0}% de acertos</small></span>
            <span class="score">${fmt(s.avg_score)}</span>
          </li>`).join('')}</ol>
      </div>` : ''}

      <p class="footer-note">Obrigado por participar! Segurança e respeito se constroem todos os dias. 💛</p>
      <button class="btn btn-ghost btn-block" id="btn-exit" type="button">Sair do jogo</button>
    </div>`;

  $('#btn-exit').addEventListener('click', leave);
  const places = $$('.podium .place', game());
  if (firstRender) {
    places.sort((a, b) => b.dataset.order - a.dataset.order)
      .forEach((el, i) => setTimeout(() => el.classList.add('in'), 250 + i * 450));
    if (mine.pos <= 3) setTimeout(() => celebrate(1.2), 1400);
  } else {
    places.forEach(el => el.classList.add('in'));
  }
}

init();
