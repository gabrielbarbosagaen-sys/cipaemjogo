import {
  configured, rpc, now, subscribe, $, $$, esc, showScreen, toast, fmt, medal, initials, avatarColor,
  LETTERS, shape, badgeInfo, celebrate, trophy, store, ADMIN_KEY, playerUrl, notConfiguredHtml, keepAwake
} from './common.js';

const params = new URLSearchParams(location.search);
let sessionId = params.get('s');
let state = null;
let screenKey = '';
let refreshing = false, refreshAgain = false;
let adminPass = store.get(ADMIN_KEY);
const timeUpRefreshed = {};
let lastFinal = 0;
let playerList = [];

const tv = () => $('#tv');
const AUTO_SECS = { reveal: 10, ranking: 6 };
const autoRefreshed = {};
const fmtWhen = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// =====================================================================
function init() {
  if (!configured) { $('#tv-main').innerHTML = notConfiguredHtml(); return; }
  if (sessionId) start();
  else if (params.get('pin')) lookup(params.get('pin'));
  else showScreen('s-setup');

  $('#setup-pin').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
  $('#form-setup').addEventListener('submit', e => { e.preventDefault(); lookup($('#setup-pin').value); });
}

async function lookup(pin) {
  try {
    const info = await rpc('get_join_info', { p_pin: pin });
    sessionId = info.id;
    history.replaceState(null, '', '?s=' + sessionId);
    start();
  } catch (e) {
    showScreen('s-setup');
    $('#setup-msg').textContent = e.message;
  }
}

async function start() {
  showScreen('s-tv');
  document.body.insertAdjacentHTML('beforeend', '<div id="auto-chip" class="auto-chip" aria-live="polite"></div>');
  keepAwake();
  try {
    await refresh(true);
  } catch (e) {
    showScreen('s-setup');
    $('#setup-msg').textContent = e.message;
    return;
  }
  subscribe(sessionId, () => refresh().catch(() => {}));
  setInterval(() => refresh().catch(() => {}), 3000);
  setInterval(tick, 100);
  setupControls();
}

async function refresh(throwErrors = false) {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    state = await rpc('live_state', { p_session: sessionId });
    const s = state.session;
    if (s.status === 'lobby' || (s.mode === 'self' && s.status === 'open')) await loadPlayers();
    render();
    renderTop();
    renderControls();
  } catch (e) {
    if (throwErrors) throw e;
  } finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; refresh().catch(() => {}); }
  }
}

async function loadPlayers() {
  playerList = await rpc('lobby_players', { p_session: sessionId });
}

function setScreen(key, build, update) {
  if (screenKey !== key) { screenKey = key; build(); }
  update?.();
}

function joinTarget() {
  return playerUrl('').replace(/^https?:\/\//, '').replace(/index\.html$/, '').replace(/\/$/, '');
}

function renderTop() {
  const s = state.session;
  $('#tv-session').textContent = s.name;
  const showPin = s.status !== 'lobby';
  $('#tv-top-right').innerHTML = showPin && !['finished', 'closed'].includes(s.status)
    ? `<span class="tv-pin-mini muted">${esc(joinTarget())} · PIN <b>${s.pin}</b></span>
       <span class="chip green"><span class="dot"></span>${state.players} jogando</span>`
    : '';
}

// =====================================================================
function render() {
  const s = state.session;
  document.querySelector('.tv-paused')?.remove();
  if (s.mode === 'live') {
    const q = state.question;
    switch (s.status) {
      case 'lobby': return setScreen('lobby', buildLobby, updateLobby);
      case 'question': {
        if (s.paused_at) document.body.insertAdjacentHTML('beforeend', '<div class="tv-paused"><div>⏸ PAUSADO</div></div>');
        if (now() < Date.parse(s.question_started_at)) return setScreen('cd' + q.idx, buildCountdown, updateCountdown);
        return setScreen('q' + q.idx, buildQuestion, updateQuestion);
      }
      case 'reveal': return setScreen('r' + q.idx, buildReveal);
      case 'ranking': return setScreen('k' + q.idx, buildRanking);
      case 'finished': return setScreen('final', buildFinal);
    }
  } else {
    switch (s.status) {
      case 'lobby': return setScreen('lobby', buildLobby, updateLobby);
      case 'open': return setScreen('self', buildSelf, updateSelf);
      case 'closed': return setScreen('final', buildFinal);
    }
  }
}

function tick() {
  if (!state) return;
  const s = state.session;
  const chip = $('#auto-chip');
  if (s.mode === 'live' && s.auto_advance && AUTO_SECS[s.status] && s.phase_started_at) {
    const due = Date.parse(s.phase_started_at) + AUTO_SECS[s.status] * 1000;
    const left = Math.max(0, Math.ceil((due - now()) / 1000));
    if (chip) chip.textContent = s.status === 'reveal' ? `Ranking em ${left} s` : `Próxima pergunta em ${left} s`;
    const key = s.status + s.current_index;
    if (now() >= due + 200 && !autoRefreshed[key]) { autoRefreshed[key] = true; refresh().catch(() => {}); }
  } else if (chip) chip.textContent = '';
  if (s.mode !== 'live' || s.status !== 'question') return;
  const q = state.question;
  const start = Date.parse(s.question_started_at);
  if (screenKey.startsWith('cd')) {
    if (now() >= start) render(); else updateCountdown();
    return;
  }
  if (s.paused_at) return;
  const end = start + q.time_limit * 1000;
  updateRing(end - now(), q.time_limit);
  if (now() >= end + 200 && !timeUpRefreshed[q.idx]) {
    timeUpRefreshed[q.idx] = true;
    refresh().catch(() => {});
  }
}

// ---------- lobby ----------
function qrBlock(size = 300) {
  return `<div class="qr" id="qr" data-size="${size}"></div>`;
}
function drawQr() {
  const el = $('#qr');
  if (!el || el.dataset.done) return;
  if (typeof window.QRCode !== 'function') { setTimeout(drawQr, 300); return; }
  el.dataset.done = '1';
  new window.QRCode(el, {
    text: playerUrl(state.session.pin), width: Number(el.dataset.size), height: Number(el.dataset.size),
    colorDark: '#0d1016', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M
  });
}

function buildLobby() {
  const s = state.session;
  tv().innerHTML = `
    <div class="tv-lobby">
      <div class="card hazard tv-join">
        <h2 style="font-size:2.4rem">${esc(s.name)}</h2>
        <p class="step">1. Aponte a câmera do celular para o QR Code ou acesse</p>
        <div class="url">${esc(joinTarget())}</div>
        ${qrBlock(300)}
        <p class="step" style="margin-top:2vh">2. Digite o PIN</p>
        <div class="pin">${s.pin}</div>
      </div>
      <div>
        <div class="tv-players-head"><h2 style="font-size:2.4rem;margin:0">Participantes</h2><span class="tv-count" id="lobby-count">0</span></div>
        <div class="cloud" id="cloud"></div>
        <p class="muted" style="margin-top:2vh;font-size:1.3rem" id="lobby-hint">
          ${s.mode === 'live' ? 'Aguardando o início do jogo…'
            : s.opens_at ? `A sala abre em ${fmtWhen(s.opens_at)}${s.closes_at ? ` e aceita respostas até ${fmtWhen(s.closes_at)}` : ''}.`
            : 'A sala abre em instantes. Cada um responde no seu ritmo.'}
        </p>
      </div>
    </div>`;
  drawQr();
}
function updateLobby() {
  $('#lobby-count').textContent = state.players;
  const cloud = $('#cloud');
  const have = new Set($$('.p', cloud).map(el => el.dataset.id));
  const ids = new Set(playerList.map(p => p.id));
  $$('.p', cloud).forEach(el => { if (!ids.has(el.dataset.id)) el.remove(); });
  [...playerList].reverse().forEach(p => {
    if (have.has(p.id)) return;
    cloud.insertAdjacentHTML('afterbegin', `<span class="p" data-id="${p.id}">
      <span class="avatar" style="background:${avatarColor(p.name)}">${esc(initials(p.name))}</span>
      ${esc(p.name)} <small>${esc(p.store)}</small></span>`);
  });
}

// ---------- contagem ----------
function buildCountdown() {
  const q = state.question;
  tv().innerHTML = `
    <div class="tv-countdown">
      <h2>Pergunta ${q.idx + 1} de ${state.total_questions}</h2>
      <span class="chip yellow" style="font-size:1.3rem">${esc(q.category)}</span>
      <div class="num" id="cd-num"></div>
      <p class="muted" style="font-size:1.6rem">Prepare o celular!</p>
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

// ---------- pergunta ----------
function questionFrame(q, withRing) {
  return `
    <div class="tv-qhead">
      <span class="qcount">Pergunta <b>${q.idx + 1}</b> de ${state.total_questions}</span>
      <span class="chip yellow" style="font-size:1.1rem">${esc(q.category)}</span>
    </div>
    <div class="tv-qbody">
      <p class="tv-qtext">${esc(q.text)}</p>
      ${withRing ? `<div class="ring" id="ring"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="45"/><circle class="fg" cx="50" cy="50" r="45"/></svg><div class="n" id="ring-n"></div></div>` : ''}
    </div>
    <div class="tv-options">${q.options.map((o, i) => `
      <div class="tv-opt c${i % 6}" data-i="${i}">${shape(i)}<span class="txt">${esc(o)}</span><span class="cnt"></span><span class="fill"></span></div>`).join('')}
    </div>`;
}

function buildQuestion() {
  const q = state.question;
  tv().innerHTML = `${questionFrame(q, true)}
    <div class="tv-foot">
      <span class="answered"><b id="ans-n">0</b> de <span id="ans-t">0</span> responderam</span>
      <span class="muted">Responda pelo celular 📱</span>
    </div>`;
  const s = state.session;
  updateRing(Date.parse(s.question_started_at) + q.time_limit * 1000 - now(), q.time_limit);
}
function updateQuestion() {
  if (!$('#ans-n')) return;
  $('#ans-n').textContent = state.question.answered;
  $('#ans-t').textContent = state.players;
}
function updateRing(leftMs, limit) {
  const ring = $('#ring');
  if (!ring) return;
  const frac = Math.max(0, Math.min(1, leftMs / (limit * 1000)));
  ring.querySelector('.fg').style.strokeDashoffset = String(283 * (1 - frac));
  ring.classList.toggle('low', leftMs < 5000);
  $('#ring-n').textContent = Math.max(0, Math.ceil(leftMs / 1000));
}

// ---------- revelação ----------
function buildReveal() {
  const q = state.question;
  const dist = q.distribution || [];
  if (q.correct_index === undefined) {
    // resultado oculto até o final: só a quantidade de respostas, sem gabarito
    const total = dist.reduce((a, b) => a + b, 0);
    tv().innerHTML = `${questionFrame(q, false)}
      <div class="explain tv-explain"><b>🔒 Respostas encerradas</b>A resposta certa e a classificação serão reveladas no final do jogo.</div>
      <div class="tv-foot"><span class="answered"><b>${total}</b> resposta${total === 1 ? '' : 's'}</span><span class="muted">Prepare-se para a próxima!</span></div>`;
    return;
  }
  const total = dist.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...dist);
  const pct = total ? Math.round(100 * (dist[q.correct_index] || 0) / total) : 0;
  tv().innerHTML = `${questionFrame(q, false)}
    ${q.explanation ? `<div class="explain tv-explain"><b>Você sabia?</b>${esc(q.explanation)}</div>` : ''}
    <div class="tv-foot">
      <span class="answered"><b>${pct}%</b> acertaram</span>
      <span class="muted">${total} resposta${total === 1 ? '' : 's'}</span>
    </div>`;
  $$('.tv-opt', tv()).forEach(el => {
    const i = Number(el.dataset.i);
    el.classList.add(i === q.correct_index ? 'right' : 'dim');
    el.querySelector('.cnt').textContent = (i === q.correct_index ? '✓ ' : '') + (dist[i] ?? 0);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.querySelector('.fill').style.width = (100 * (dist[i] || 0) / max) + '%';
    }));
  });
}

// ---------- ranking ----------
function rankRows(list, { gain = false, animate = true } = {}) {
  return list.map((p, i) => {
    let mv = '';
    if (gain && p.prev_pos && p.prev_pos !== p.pos) {
      mv = p.prev_pos > p.pos ? `<span class="mv move-up">▲${p.prev_pos - p.pos}</span>` : `<span class="mv move-down">▼${p.pos - p.prev_pos}</span>`;
    }
    return `<div class="tv-row ${p.pos === 1 ? 'first' : ''}" style="${animate ? `animation-delay:${i * 120}ms` : 'animation:none'}">
      <span class="pos">${(p.score > 0 && medal(p.pos)) || p.pos}</span>
      <span class="nm"><b>${esc(p.name)}${mv}</b><small>${esc(p.store)}</small></span>
      <span class="gain">${gain && p.last_points ? '+' + fmt(p.last_points) : (p.finished ? '✅' : '')}</span>
      <span class="sc">${fmt(p.score)}</span>
    </div>`;
  }).join('');
}

function hiddenBoard(text) {
  return `<div class="card center" style="padding:5vh 2vw"><div style="font-size:4rem">🔒</div>
    <h2 style="font-size:2.6rem">Classificação secreta</h2><p class="muted" style="font-size:1.4rem">${text}</p></div>`;
}

function buildRanking() {
  const q = state.question;
  if (!state.leaderboard) {
    tv().innerHTML = `<div class="tv-rank">${hiddenBoard('O ranking será revelado no final do jogo.')}</div>`;
    return;
  }
  tv().innerHTML = `
    <div class="tv-rank">
      <h2>🏁 Ranking após a pergunta ${q.idx + 1}</h2>
      ${rankRows(state.leaderboard.slice(0, 5), { gain: true })}
      ${state.leaderboard.length === 0 ? '<p class="center muted">Ninguém pontuou ainda.</p>' : ''}
    </div>`;
}

// ---------- modo no seu ritmo ----------
function buildSelf() {
  const s = state.session;
  tv().innerHTML = `
    <div class="tv-self">
      <div>
        <h2 style="font-size:2.6rem">${state.leaderboard ? '🏁 Ranking ao vivo' : '🏁 Ranking'}</h2>
        <div id="self-board"></div>
      </div>
      <div class="tv-side">
        <div class="card hazard tv-join">
          <p class="step">Acesse <b style="color:var(--text)">${esc(joinTarget())}</b></p>
          ${qrBlock(220)}
          <p class="step" style="margin-top:1.5vh">PIN</p>
          <div class="pin" style="font-size:5rem">${s.pin}</div>
        </div>
        <div class="card">
          <h3>Progresso</h3>
          <div class="progress-big"><i id="self-prog" style="width:0"></i></div>
          <p style="margin-top:1vh;font-size:1.2rem"><b id="self-done">0</b> de <b id="self-total">0</b> participantes concluíram</p>
          ${s.closes_at ? `<p class="muted" style="font-size:1.1rem;margin:0">🕒 Respostas aceitas até <b style="color:var(--yellow)">${fmtWhen(s.closes_at)}</b></p>` : ''}
        </div>
      </div>
    </div>`;
  drawQr();
  updateSelf(true);
}
function updateSelf(first = false) {
  const board = $('#self-board');
  if (!board) return;
  board.innerHTML = !state.leaderboard ? hiddenBoard('O pódio e a classificação aparecem quando a sala for encerrada.')
    : state.leaderboard.length
    ? rankRows(state.leaderboard.slice(0, 8), { animate: first === true })
    : '<p class="muted" style="font-size:1.3rem">Aguardando as primeiras respostas…</p>';
  $('#self-done').textContent = state.finished_players;
  $('#self-total').textContent = state.players;
  $('#self-prog').style.width = (state.players ? 100 * state.finished_players / state.players : 0) + '%';
}

// ---------- pódio final ----------
async function buildFinal() {
  if (Date.now() - lastFinal < 1500) return;
  lastFinal = Date.now();
  let res;
  try { res = await rpc('session_results', { p_session: sessionId }); } catch (e) { toast(e.message, 'error'); screenKey = ''; return; }
  const top3 = res.ranking.slice(0, 3);
  const players = res.ranking.length;
  const answered = res.ranking.reduce((a, p) => a + p.answered, 0);
  const correct = res.ranking.reduce((a, p) => a + p.correct, 0);
  const has = code => res.ranking.filter(p => p.badges.includes(code));
  const perfect = has('gabaritou');
  const streakKing = [...res.ranking].sort((a, b) => b.best_streak - a.best_streak)[0];
  const catCounts = {};
  res.ranking.forEach(p => p.badges.filter(b => b.startsWith('cat:')).forEach(b => { catCounts[b] = (catCounts[b] || 0) + 1; }));

  const highlights = [
    `<div class="hl"><span class="ic">👥</span><span><b>${players}</b> participantes · <b>${answered ? Math.round(100 * correct / answered) : 0}%</b> de acertos no geral</span></div>`,
    perfect.length ? `<div class="hl"><span class="ic">🏆</span><span><b>Gabaritaram:</b> ${perfect.slice(0, 4).map(p => esc(p.name)).join(', ')}${perfect.length > 4 ? ` e mais ${perfect.length - 4}` : ''}</span></div>` : '',
    streakKing && streakKing.best_streak >= 3 ? `<div class="hl"><span class="ic">🔥</span><span><b>Maior sequência:</b> ${esc(streakKing.name)} (${streakKing.best_streak} acertos seguidos)</span></div>` : '',
    ...Object.entries(catCounts).map(([code, n]) => {
      const b = badgeInfo(code);
      return `<div class="hl"><span class="ic">${b.icon}</span><span><b>${esc(b.name)}:</b> ${n} pessoa${n > 1 ? 's' : ''}</span></div>`;
    })
  ].join('');

  tv().innerHTML = `
    <div class="tv-final">
      <div>
        <h1>🏆 Pódio</h1>
        <div class="podium">${[1, 0, 2].map(i => top3[i] ? `
          <div class="place p${i + 1}" data-order="${i}">
            ${trophy(['gold', 'silver', 'bronze'][i])}
            <div class="name">${esc(top3[i].name)}</div>
            <div class="store">${esc(top3[i].store)}</div>
            <div class="pts">${fmt(top3[i].score)} pts</div>
            <div class="block">${i + 1}º</div>
          </div>` : '<div></div>').join('')}
        </div>
      </div>
      <div class="tv-side">
        ${res.stores.length ? `<div class="card"><h3>🏬 Ranking das lojas</h3>
          <ol class="board">${res.stores.slice(0, 5).map(s => `
            <li><span class="pos">${medal(s.pos) || s.pos}</span>
            <span class="who"><b>${esc(s.store)}</b><small>${s.players} part. · ${s.correct_pct ?? 0}% acertos</small></span>
            <span class="score">${fmt(s.avg_score)}</span></li>`).join('')}</ol>
          <p class="muted small" style="margin:8px 0 0">Média de pontos por participante</p></div>` : ''}
        <div class="card"><h3>⭐ Destaques</h3>${highlights}</div>
      </div>
    </div>`;

  $$('.podium .place', tv())
    .sort((a, b) => b.dataset.order - a.dataset.order)
    .forEach((el, i) => setTimeout(() => {
      el.classList.add('in');
      if (i === 2) celebrate(2.2);
    }, 700 + i * 1100));
}

// =====================================================================
//  CONTROLES DO APRESENTADOR (aparecem se o admin fez login neste navegador)
// =====================================================================
function actionsFor(s) {
  const last = state.question && state.question.idx + 1 >= state.total_questions;
  const list = [];
  if (s.mode === 'live') {
    if (s.status === 'lobby') list.push({ label: '▶ Iniciar jogo', action: 'start', primary: true });
    if (s.status === 'question') {
      list.push({ label: 'Revelar resposta', action: 'reveal', primary: true });
      list.push(s.paused_at ? { label: '▶ Continuar', action: 'resume' } : { label: '⏸ Pausar', action: 'pause' });
    }
    if (s.status === 'reveal') {
      list.push({ label: 'Mostrar ranking', action: 'ranking', primary: true });
      list.push({ label: last ? 'Ver pódio 🏆' : 'Próxima pergunta →', action: 'next' });
    }
    if (s.status === 'ranking') list.push({ label: last ? 'Ver pódio 🏆' : 'Próxima pergunta →', action: 'next', primary: true });
    if (s.status !== 'finished' && s.status !== 'lobby') list.push({ label: 'Encerrar', action: 'finish', danger: true });
  } else {
    if (s.status === 'lobby') list.push({ label: '▶ Abrir sala', action: 'open', primary: true });
    if (s.status === 'open') list.push({ label: 'Encerrar e mostrar pódio 🏆', action: 'finish', primary: true });
    if (s.status === 'closed') list.push({ label: 'Reabrir sala', action: 'open' });
  }
  return list;
}

function renderControls() {
  const box = $('#controls');
  if (!adminPass) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const list = actionsFor(state.session);
  const sig = JSON.stringify(list);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = list.map(a => `<button class="btn btn-sm ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : ''}" data-action="${a.action}" type="button">${a.label}</button>`).join('')
    + `<button class="btn btn-sm btn-ghost" data-action="fullscreen" type="button" title="Tela cheia (F)">⛶</button>`
    + `<span class="hint">Espaço = avançar · P = pausar · F = tela cheia</span>`;
}

async function doAction(action) {
  if (action === 'fullscreen') { toggleFullscreen(); return; }
  if (action === 'finish' && !confirm('Encerrar o jogo agora e mostrar o pódio?')) return;
  try {
    await rpc('admin_session_action', { p_pass: adminPass, p_session: sessionId, p_action: action });
    await refresh();
  } catch (e) {
    toast(e.message, 'error');
    if (e.code === '28P01') { adminPass = null; store.del(ADMIN_KEY); renderControls(); }
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function setupControls() {
  const box = $('#controls');
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (b) doAction(b.dataset.action);
  });
  let idleTimer;
  const wake = () => {
    box.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => box.classList.add('idle'), 3500);
  };
  document.addEventListener('mousemove', wake);
  wake();
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key.toLowerCase() === 'f') { toggleFullscreen(); return; }
    if (!adminPass || !state) return;
    const list = actionsFor(state.session);
    if ([' ', 'Enter', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const p = list.find(a => a.primary);
      if (p) doAction(p.action);
    }
    if (e.key.toLowerCase() === 'p') {
      const p = list.find(a => a.action === 'pause' || a.action === 'resume');
      if (p) doAction(p.action);
    }
  });
}

init();
