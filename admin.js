import {
  configured, rpc, now, subscribe, $, $$, esc, showScreen, toast, fmt, medal,
  LETTERS, shape, badgeInfo, store, ADMIN_KEY, playerUrl, notConfiguredHtml
} from './common.js';

let pass = store.get(ADMIN_KEY);
let quizzes = [];
let currentQuiz = null;
let questions = [];
const ctrl = { id: null, unsub: null, poll: null, tick: null, state: null, report: null, busy: false };

const panel = () => $('#panel');
const P = () => ({ p_pass: pass });

const STATUS = {
  lobby: ['Aguardando início', 'yellow'], question: ['Pergunta em andamento', 'green'],
  reveal: ['Resposta revelada', 'blue'], ranking: ['Mostrando ranking', 'blue'],
  finished: ['Encerrada', ''], open: ['Aberta', 'green'], closed: ['Encerrada', '']
};
const statusChip = s => `<span class="chip ${STATUS[s]?.[1] || ''}">${STATUS[s]?.[0] || s}</span>`;
const modeLabel = m => m === 'live' ? 'Ao vivo' : 'No seu ritmo';
const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '–';
const telaoUrl = id => new URL('telao.html?s=' + id, location.href).href;

// =====================================================================
//  LOGIN
// =====================================================================
async function init() {
  if (!configured) { $('#main').innerHTML = notConfiguredHtml(); return; }
  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    await tryLogin($('#login-pass').value);
  });
  $('#btn-logout').addEventListener('click', () => { store.del(ADMIN_KEY); location.hash = ''; location.reload(); });
  window.addEventListener('hashchange', route);
  if (pass) await tryLogin(pass, true);
  else showScreen('v-login');
}

async function tryLogin(p, silent = false) {
  try {
    const r = await rpc('admin_login', { p_pass: p });
    pass = p;
    store.set(ADMIN_KEY, p);
    $('#default-pass-warning').classList.toggle('hidden', !r.default_password);
    $('#btn-logout').classList.remove('hidden');
    showScreen('v-app');
    route();
  } catch (e) {
    store.del(ADMIN_KEY);
    showScreen('v-login');
    if (!silent) $('#login-msg').textContent = e.message;
  }
}

// =====================================================================
//  ROTAS
// =====================================================================
function route() {
  if (!pass) return;
  stopControl();
  const [tab, id] = (location.hash.slice(1) || 'sessoes').split('/');
  const activeTab = { sessao: 'sessoes', relatorio: 'relatorios' }[tab] || tab;
  $$('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === activeTab));
  panel().innerHTML = '<div class="waiting-ring"></div>';
  const go = {
    sessoes: loadSessions, sessao: () => openControl(id), perguntas: loadQuestionsTab,
    relatorios: loadReports, relatorio: () => openReport(id), config: loadSettings
  }[tab] || loadSessions;
  go().catch(handleError);
}

function handleError(e) {
  if (e.code === '28P01') { store.del(ADMIN_KEY); pass = null; showScreen('v-login'); $('#login-msg').textContent = 'Sessão expirada. Entre novamente.'; return; }
  toast(e.message, 'error');
}

async function withBusy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { handleError(e); } finally { if (btn) btn.disabled = false; }
}

// =====================================================================
//  SESSÕES
// =====================================================================
async function loadSessions() {
  const [list, qz] = await Promise.all([rpc('admin_list_sessions', P()), rpc('admin_list_quizzes', P())]);
  quizzes = qz;
  const active = list.filter(s => !['finished', 'closed'].includes(s.status));
  panel().innerHTML = `
    <div class="grid-2">
      <div class="card hazard">
        <h2>Nova sessão</h2>
        <form id="form-new">
          <div class="field">
            <label for="n-name">Nome da sessão</label>
            <input id="n-name" type="text" maxlength="80" placeholder="Ex.: Encontro CIPA – Outubro/2026" required>
          </div>
          <div class="field">
            <label for="n-quiz">Questionário</label>
            <select id="n-quiz">${quizzes.map(q => `<option value="${q.id}">${esc(q.title)} (${q.questions} perguntas)</option>`).join('')}</select>
          </div>
          <label>Modo de jogo</label>
          <div class="mode-pick">
            <label><input type="radio" name="mode" value="live" checked><span class="opt-card"><b>🎤 Ao vivo</b><small>Você controla as perguntas pelo telão; todos respondem ao mesmo tempo.</small></span></label>
            <label><input type="radio" name="mode" value="self"><span class="opt-card"><b>🏃 No seu ritmo</b><small>Cada participante responde sozinho enquanto a sala estiver aberta.</small></span></label>
          </div>
          <label class="check self-only"><input type="checkbox" id="n-timed" checked><span>Usar cronômetro em cada pergunta<small>Desmarcado: sem limite de tempo; cada acerto vale 1.000 pontos + bônus de sequência, e o tempo só desempata. (No modo ao vivo o cronômetro é sempre usado.)</small></span></label>
          <label class="check self-only"><input type="checkbox" id="n-shuffle-q"><span>Embaralhar a ordem das perguntas<small>Disponível apenas no modo "no seu ritmo".</small></span></label>
          <label class="check"><input type="checkbox" id="n-shuffle-o"><span>Embaralhar as alternativas em cada celular<small>Dificulta copiar a resposta do colega.</small></span></label>
          <label class="check"><input type="checkbox" id="n-expl" checked><span>Mostrar a explicação após cada resposta<small>Reforça o aprendizado.</small></span></label>
          <button class="btn btn-primary btn-lg btn-block" type="submit" id="btn-create">Criar sessão</button>
        </form>
      </div>
      <div class="card">
        <h2>Sessões em andamento</h2>
        ${active.length ? active.map(s => `
          <div class="sess">
            <div class="pinbox">${s.pin}</div>
            <div class="grow">
              <b>${esc(s.name)}</b><br>
              <span class="small muted">${modeLabel(s.mode)} · ${s.players} participante${s.players === 1 ? '' : 's'} · criada ${fmtDate(s.created_at)}</span>
            </div>
            ${statusChip(s.status)}
            <a class="btn btn-primary btn-sm" href="#sessao/${s.id}">Controlar</a>
          </div>`).join('') : '<p class="empty">Nenhuma sessão em andamento.<br>Crie uma sessão ao lado para começar.</p>'}
        <p class="small muted" style="margin-top:16px">Sessões encerradas ficam em <a href="#relatorios">Relatórios</a>.</p>
      </div>
    </div>`;

  const syncShuffle = () => {
    const self = $('input[name=mode]:checked').value === 'self';
    $('#n-shuffle-q').disabled = !self;
    $('#n-timed').disabled = !self;
    if (!self) { $('#n-shuffle-q').checked = false; $('#n-timed').checked = true; }
    $$('.self-only').forEach(el => { el.style.opacity = self ? 1 : .5; });
  };
  $$('input[name=mode]').forEach(r => r.addEventListener('change', syncShuffle));
  syncShuffle();

  $('#form-new').addEventListener('submit', e => {
    e.preventDefault();
    withBusy($('#btn-create'), async () => {
      const r = await rpc('admin_create_session', {
        ...P(), p_name: $('#n-name').value, p_quiz: $('#n-quiz').value,
        p_mode: $('input[name=mode]:checked').value,
        p_shuffle_questions: $('#n-shuffle-q').checked,
        p_shuffle_options: $('#n-shuffle-o').checked,
        p_show_explanation: $('#n-expl').checked,
        p_timed: $('#n-timed').checked
      });
      toast(`Sessão criada! PIN ${r.pin}`, 'success');
      location.hash = '#sessao/' + r.id;
    });
  });
}

// =====================================================================
//  CONTROLE DA SESSÃO
// =====================================================================
function stopControl() {
  ctrl.unsub?.(); clearInterval(ctrl.poll); clearInterval(ctrl.tick);
  Object.assign(ctrl, { id: null, unsub: null, poll: null, tick: null, state: null, report: null });
}

async function openControl(id) {
  ctrl.id = id;
  await refreshControl(true);
  ctrl.unsub = subscribe(id, () => refreshControl());
  ctrl.poll = setInterval(() => refreshControl(), 3000);
  ctrl.tick = setInterval(tickControl, 250);
}

async function refreshControl(throwErrors = false) {
  const id = ctrl.id;
  if (!id || ctrl.busy) return;
  ctrl.busy = true;
  try {
    const [st, rep] = await Promise.all([
      rpc('live_state', { p_session: id }),
      rpc('admin_session_report', { ...P(), p_session: id, p_full: false })
    ]);
    if (ctrl.id !== id) return;
    ctrl.state = st; ctrl.report = rep;
    renderControl();
  } catch (e) {
    if (throwErrors) throw e;
  } finally {
    ctrl.busy = false;
  }
}

function controlActions(s, st) {
  const last = st.question && st.question.idx + 1 >= st.total_questions;
  const a = [];
  if (s.mode === 'live') {
    if (s.status === 'lobby') a.push(['start', '▶ Iniciar jogo', 'btn-primary btn-lg']);
    if (s.status === 'question') {
      a.push(['reveal', 'Revelar resposta agora', 'btn-primary btn-lg']);
      a.push(s.paused_at ? ['resume', '▶ Continuar', 'btn-green'] : ['pause', '⏸ Pausar', '']);
    }
    if (s.status === 'reveal') {
      a.push(['ranking', 'Mostrar ranking', 'btn-primary btn-lg']);
      a.push(['next', last ? 'Ver pódio 🏆' : 'Próxima pergunta →', '']);
    }
    if (s.status === 'ranking') a.push(['next', last ? 'Ver pódio 🏆' : 'Próxima pergunta →', 'btn-primary btn-lg']);
    if (!['lobby', 'finished'].includes(s.status)) a.push(['finish', 'Encerrar jogo', 'btn-danger']);
  } else {
    if (s.status === 'lobby') a.push(['open', '▶ Abrir sala', 'btn-primary btn-lg']);
    if (s.status === 'open') a.push(['finish', 'Encerrar sala e mostrar pódio 🏆', 'btn-primary btn-lg']);
    if (s.status === 'closed') a.push(['open', 'Reabrir sala', '']);
  }
  return a;
}

function statusLine(s, st) {
  if (s.mode === 'self') {
    if (s.status === 'lobby') return `Os participantes podem entrar. Clique em <b>Abrir sala</b> para liberar as perguntas.`;
    if (s.status === 'open') return `Sala aberta · <b>${st.finished_players}</b> de <b>${st.players}</b> concluíram`;
    return 'Sala encerrada. O pódio está disponível no telão e nos celulares.';
  }
  const q = st.question;
  switch (s.status) {
    case 'lobby': return `<b>${st.players}</b> participante${st.players === 1 ? '' : 's'} na sala. Quando todos entrarem, clique em <b>Iniciar jogo</b>.`;
    case 'question': return `Pergunta <b>${q.idx + 1}</b> de ${st.total_questions} · <span id="ctrl-timer">–</span> · <b>${q.answered}</b> de ${st.players} responderam${s.paused_at ? ' · <span class="chip yellow">PAUSADO</span>' : ''}`;
    case 'reveal': return `Pergunta <b>${q.idx + 1}</b> revelada. Mostre o ranking ou avance.`;
    case 'ranking': return `Ranking após a pergunta <b>${q.idx + 1}</b>.`;
    case 'finished': return 'Jogo encerrado. O pódio está no telão e nos celulares.';
  }
  return '';
}

function tickControl() {
  const st = ctrl.state;
  const el = $('#ctrl-timer');
  if (!st || !el || st.session.status !== 'question') return;
  const s = st.session;
  const start = Date.parse(s.question_started_at);
  const ref = s.paused_at ? Date.parse(s.paused_at) : now();
  if (ref < start) { el.textContent = `começa em ${Math.ceil((start - ref) / 1000)} s`; return; }
  const left = Math.max(0, Math.ceil((start + st.question.time_limit * 1000 - ref) / 1000));
  el.textContent = `${left} s restantes`;
}

function renderControl() {
  const st = ctrl.state, rep = ctrl.report, s = st.session;
  const link = playerUrl(s.pin);
  const cur = s.mode === 'live' && s.current_index >= 0 ? rep.questions[s.current_index] : null;
  const showCur = cur && ['question', 'reveal', 'ranking'].includes(s.status);
  const total = rep.questions.length;

  panel().innerHTML = `
    <p><a href="#sessoes">← Voltar para sessões</a></p>
    <div class="card hazard">
      <div class="ctrl-head">
        <div>
          <h2 style="margin-bottom:4px">${esc(s.name)}</h2>
          <p class="muted" style="margin:0 0 10px">${esc(s.quiz_title || '')} · ${total} perguntas · ${modeLabel(s.mode)}
            ${s.timed === false ? ' · sem cronômetro' : ''}${s.shuffle_options ? ' · alternativas embaralhadas' : ''}${s.shuffle_questions ? ' · perguntas embaralhadas' : ''}</p>
          ${statusChip(s.status)}
        </div>
        <div class="center">
          <div class="small muted">PIN da sala</div>
          <div class="big-pin">${s.pin}</div>
        </div>
      </div>
      <div class="row" style="margin-top:16px">
        <a class="btn" href="${telaoUrl(s.id)}" target="_blank" rel="noopener">📺 Abrir telão</a>
        <button class="btn" id="btn-copy" type="button">🔗 Copiar link dos participantes</button>
        <a class="btn btn-ghost" href="#relatorio/${s.id}">📊 Relatório</a>
      </div>
      <p class="small muted" style="margin:10px 0 0">Link: <code>${esc(link)}</code></p>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="col">
        <div class="card">
          <h3>Controle</h3>
          <p class="ctrl-status">${statusLine(s, st)}</p>
          <div class="ctrl-actions">${controlActions(s, st).map(([a, label, cls]) =>
            `<button class="btn ${cls}" data-action="${a}" type="button">${label}</button>`).join('')}</div>
          ${s.mode === 'live' ? '<p class="small muted" style="margin:12px 0 0">A resposta é revelada sozinha quando o tempo acaba ou quando todos respondem. Você também pode controlar pelo telão (Espaço = avançar).</p>' : ''}
        </div>
        ${showCur ? `<div class="card qprev">
          <div class="row between"><h3 style="margin:0">Pergunta ${cur.idx + 1}</h3><span class="chip yellow">${esc(cur.category)}</span></div>
          <p style="font-weight:700;margin:10px 0">${esc(cur.text)}</p>
          ${cur.options.map((o, i) => `<div class="opt-line ${i === cur.correct_index ? 'right' : ''}">
            <span style="fill:var(--o${i % 6})">${shape(i)}</span><span>${esc(o)}</span>
            <span class="n">${i === cur.correct_index ? '✓ ' : ''}${s.status !== 'question' ? (cur.distribution?.[i] ?? 0) : ''}</span></div>`).join('')}
        </div>` : ''}
      </div>

      <div class="card">
        <div class="row between"><h3 style="margin:0">Participantes (${rep.players.length})</h3>
          ${s.mode === 'live' && s.status === 'question' ? '<span class="small muted">✓ = já respondeu</span>' : ''}</div>
        ${rep.players.length ? `<div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th class="num">#</th><th>Nome</th><th>Loja/Setor</th><th class="num">Pontos</th><th class="num">Acertos</th><th></th><th></th></tr></thead>
          <tbody>${rep.players.map(p => `<tr>
            <td class="num">${medal(p.pos) || p.pos}</td>
            <td>${esc(p.name)}</td>
            <td class="muted">${esc(p.store)}</td>
            <td class="num"><b>${fmt(p.score)}</b></td>
            <td class="num">${p.correct}/${s.mode === 'self' ? total : p.answered}</td>
            <td>${s.mode === 'live' && s.status === 'question' ? (p.answered_current ? '<span style="color:var(--green-2)">✓</span>' : '<span class="muted">…</span>') : (s.mode === 'self' ? (p.finished ? '<span class="chip green">concluiu</span>' : `<span class="small muted">${p.answered}/${total}</span>`) : '')}</td>
            <td><button class="icon-btn" data-remove="${p.id}" data-name="${esc(p.name)}" title="Remover participante" aria-label="Remover ${esc(p.name)}">✕</button></td>
          </tr>`).join('')}</tbody></table></div>`
          : '<p class="empty">Ninguém entrou ainda. Mostre o QR Code do telão ou compartilhe o link.</p>'}
      </div>
    </div>`;

  tickControl();
  $('#btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copiado!', 'success'); } catch { prompt('Copie o link:', link); }
  });
  $$('[data-action]', panel()).forEach(b => b.addEventListener('click', () => doControl(b.dataset.action, b)));
  $$('[data-remove]', panel()).forEach(b => b.addEventListener('click', () => {
    if (!confirm(`Remover ${b.dataset.name} da sessão? A pontuação dessa pessoa será apagada.`)) return;
    withBusy(b, async () => { await rpc('admin_remove_player', { ...P(), p_player: b.dataset.remove }); await refreshControl(); });
  }));
}

async function doControl(action, btn) {
  if (action === 'finish' && !confirm('Encerrar agora e mostrar o pódio?')) return;
  if (action === 'start' && ctrl.state.players === 0 && !confirm('Ninguém entrou na sala ainda. Iniciar mesmo assim?')) return;
  await withBusy(btn, async () => {
    await rpc('admin_session_action', { ...P(), p_session: ctrl.id, p_action: action });
    await refreshControl();
  });
}

// =====================================================================
//  PERGUNTAS
// =====================================================================
async function loadQuestionsTab() {
  quizzes = await rpc('admin_list_quizzes', P());
  if (!quizzes.find(q => q.id === currentQuiz)) currentQuiz = quizzes[0]?.id || null;
  questions = currentQuiz ? await rpc('admin_get_questions', { ...P(), p_quiz: currentQuiz }) : [];
  renderQuestions();
}

function renderQuestions() {
  const quiz = quizzes.find(q => q.id === currentQuiz);
  const cats = [...new Set(questions.map(q => q.category))];
  panel().innerHTML = `
    <div class="card">
      <div class="row">
        <div class="grow" style="min-width:220px">
          <label for="quiz-sel">Questionário</label>
          <select id="quiz-sel">${quizzes.map(q => `<option value="${q.id}" ${q.id === currentQuiz ? 'selected' : ''}>${esc(q.title)} (${q.questions})</option>`).join('')}</select>
        </div>
        <div class="row" style="align-self:flex-end">
          <button class="btn btn-sm" id="qz-new" type="button">+ Novo</button>
          ${quiz ? `<button class="btn btn-sm" id="qz-rename" type="button">Renomear</button>
          <button class="btn btn-sm" id="qz-dup" type="button">Duplicar</button>
          <button class="btn btn-sm btn-danger" id="qz-del" type="button">Excluir</button>` : ''}
        </div>
      </div>
      <p class="small muted" style="margin:12px 0 0">As alterações valem para as próximas sessões. Sessões já criadas guardam uma cópia das perguntas.</p>
    </div>
    ${quiz ? `
    <div class="row between" style="margin:20px 0 12px">
      <h2 style="margin:0">${questions.length} pergunta${questions.length === 1 ? '' : 's'}</h2>
      <button class="btn btn-primary" id="q-add" type="button">+ Adicionar pergunta</button>
    </div>
    ${questions.map((q, i) => `
      <div class="qitem">
        <div class="num">${i + 1}</div>
        <div>
          <div class="row" style="gap:6px;margin-bottom:6px"><span class="chip yellow">${esc(q.category)}</span><span class="chip">⏱ ${q.time_limit} s</span></div>
          <div class="qt">${esc(q.text)}</div>
          <ol type="A">${q.options.map((o, j) => `<li class="${j === q.correct_index ? 'ok' : ''}">${esc(o)}${j === q.correct_index ? ' ✓' : ''}</li>`).join('')}</ol>
          ${q.explanation ? `<div class="exp">💡 ${esc(q.explanation)}</div>` : ''}
        </div>
        <div class="acts">
          <button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Mover para cima" aria-label="Mover para cima">↑</button>
          <button class="icon-btn" data-down="${i}" ${i === questions.length - 1 ? 'disabled' : ''} title="Mover para baixo" aria-label="Mover para baixo">↓</button>
          <button class="icon-btn" data-edit="${i}" title="Editar" aria-label="Editar">✎</button>
          <button class="icon-btn" data-del="${i}" title="Excluir" aria-label="Excluir">🗑</button>
        </div>
      </div>`).join('') || '<p class="empty">Nenhuma pergunta ainda.</p>'}` : '<p class="empty">Crie um questionário para começar.</p>'}
    <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;

  $('#quiz-sel')?.addEventListener('change', e => { currentQuiz = e.target.value; loadQuestionsTab().catch(handleError); });
  $('#qz-new').addEventListener('click', async () => {
    const t = prompt('Nome do novo questionário:');
    if (!t) return;
    currentQuiz = await rpc('admin_save_quiz', { ...P(), p_id: null, p_title: t }).catch(handleError) || currentQuiz;
    loadQuestionsTab().catch(handleError);
  });
  $('#qz-rename')?.addEventListener('click', async () => {
    const t = prompt('Novo nome:', quiz.title);
    if (!t) return;
    await rpc('admin_save_quiz', { ...P(), p_id: currentQuiz, p_title: t }).catch(handleError);
    loadQuestionsTab().catch(handleError);
  });
  $('#qz-dup')?.addEventListener('click', async () => {
    currentQuiz = await rpc('admin_duplicate_quiz', { ...P(), p_id: currentQuiz }).catch(handleError) || currentQuiz;
    toast('Questionário duplicado.', 'success');
    loadQuestionsTab().catch(handleError);
  });
  $('#qz-del')?.addEventListener('click', async () => {
    if (!confirm(`Excluir o questionário "${quiz.title}" e todas as suas perguntas? O histórico das sessões já realizadas é mantido.`)) return;
    await rpc('admin_delete_quiz', { ...P(), p_id: currentQuiz }).catch(handleError);
    currentQuiz = null;
    loadQuestionsTab().catch(handleError);
  });
  $('#q-add')?.addEventListener('click', () => editQuestion(null));
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => editQuestion(questions[b.dataset.edit])));
  $$('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const q = questions[b.dataset.del];
    if (!confirm(`Excluir a pergunta "${q.text}"?`)) return;
    await rpc('admin_delete_question', { ...P(), p_id: q.id }).catch(handleError);
    loadQuestionsTab().catch(handleError);
  }));
  const move = async (i, d) => {
    const ids = questions.map(q => q.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    await rpc('admin_reorder_questions', { ...P(), p_ids: ids }).catch(handleError);
    loadQuestionsTab().catch(handleError);
  };
  $$('[data-up]').forEach(b => b.addEventListener('click', () => move(Number(b.dataset.up), -1)));
  $$('[data-down]').forEach(b => b.addEventListener('click', () => move(Number(b.dataset.down), 1)));
}

function editQuestion(q) {
  const data = q ? structuredClone(q) : { category: questions.at(-1)?.category || '', text: '', options: ['', '', '', ''], correct_index: 0, time_limit: 30, explanation: '' };
  const root = $('#modal-root');
  const optsHtml = () => data.options.map((o, i) => `
    <div class="opt-edit">
      <input type="radio" name="correct" value="${i}" ${i === data.correct_index ? 'checked' : ''} aria-label="Marcar alternativa ${LETTERS[i]} como correta">
      <span class="letter">${LETTERS[i]}</span>
      <input type="text" data-opt="${i}" value="${esc(o)}" maxlength="200" placeholder="Alternativa ${LETTERS[i]}">
      <button class="icon-btn" type="button" data-rm="${i}" ${data.options.length <= 2 ? 'disabled' : ''} aria-label="Remover alternativa">✕</button>
    </div>`).join('');

  root.innerHTML = `
    <div class="modal-bg" role="dialog" aria-modal="true" aria-labelledby="m-title">
      <form class="modal" id="q-form">
        <h2 id="m-title">${q ? 'Editar pergunta' : 'Nova pergunta'}</h2>
        <div class="row">
          <div class="field grow"><label for="q-cat">Categoria</label><input id="q-cat" type="text" list="cat-list" maxlength="60" value="${esc(data.category)}" placeholder="Ex.: Segurança do Trabalho"></div>
          <div class="field" style="width:130px"><label for="q-time">Tempo (s)</label><input id="q-time" type="number" min="5" max="300" value="${data.time_limit}"></div>
        </div>
        <div class="field"><label for="q-text">Enunciado</label><textarea id="q-text" maxlength="500" required>${esc(data.text)}</textarea></div>
        <label>Alternativas <span class="muted small">(marque a correta)</span></label>
        <div id="q-opts">${optsHtml()}</div>
        <button class="btn btn-sm btn-ghost" type="button" id="q-add-opt" style="margin-bottom:14px">+ Alternativa</button>
        <div class="field"><label for="q-exp">Explicação (aparece depois da resposta)</label><textarea id="q-exp" maxlength="600" placeholder="Por que essa é a resposta certa?">${esc(data.explanation || '')}</textarea></div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn btn-ghost" type="button" id="q-cancel">Cancelar</button>
          <button class="btn btn-primary" type="submit" id="q-save">Salvar</button>
        </div>
      </form>
    </div>`;

  const sync = () => {
    $$('[data-opt]', root).forEach(inp => { data.options[inp.dataset.opt] = inp.value; });
    data.correct_index = Number($('input[name=correct]:checked', root)?.value ?? 0);
  };
  const redraw = () => {
    $('#q-opts').innerHTML = optsHtml();
    $('#q-add-opt').disabled = data.options.length >= 6;
    $$('[data-rm]', root).forEach(b => b.addEventListener('click', () => {
      sync();
      const i = Number(b.dataset.rm);
      data.options.splice(i, 1);
      if (data.correct_index === i) data.correct_index = 0;
      else if (data.correct_index > i) data.correct_index--;
      redraw();
    }));
  };
  redraw();
  const close = () => { root.innerHTML = ''; };
  $('#q-cancel').addEventListener('click', close);
  $('.modal-bg', root).addEventListener('click', e => { if (e.target.classList.contains('modal-bg')) close(); });
  $('#q-add-opt').addEventListener('click', () => { sync(); data.options.push(''); redraw(); });
  $('#q-form').addEventListener('submit', e => {
    e.preventDefault();
    sync();
    withBusy($('#q-save'), async () => {
      await rpc('admin_save_question', {
        ...P(), p_q: {
          id: q?.id || null, quiz_id: currentQuiz, category: $('#q-cat').value, text: $('#q-text').value,
          options: data.options, correct_index: data.correct_index,
          time_limit: Math.min(300, Math.max(5, Number($('#q-time').value) || 30)), explanation: $('#q-exp').value
        }
      });
      close();
      toast('Pergunta salva.', 'success');
      await loadQuestionsTab();
    });
  });
  $('#q-text').focus();
}

// =====================================================================
//  RELATÓRIOS
// =====================================================================
async function loadReports() {
  const list = await rpc('admin_list_sessions', P());
  panel().innerHTML = `
    <h2>Histórico de sessões</h2>
    ${list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Sessão</th><th>Modo</th><th>Status</th><th class="num">Participantes</th><th>1º lugar</th><th></th></tr></thead>
      <tbody>${list.map(s => `<tr>
        <td>${fmtDate(s.started_at || s.created_at)}</td>
        <td><b>${esc(s.name)}</b><br><span class="small muted">${esc(s.quiz_title || '')} · PIN ${s.pin}</span></td>
        <td>${modeLabel(s.mode)}</td>
        <td>${statusChip(s.status)}</td>
        <td class="num">${s.players}</td>
        <td>${s.winner ? '🥇 ' + esc(s.winner) : '<span class="muted">–</span>'}</td>
        <td><a class="btn btn-sm" href="#relatorio/${s.id}">Ver relatório</a></td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nenhuma sessão realizada ainda.</p>'}`;
}

async function openReport(id) {
  const rep = await rpc('admin_session_report', { ...P(), p_session: id, p_full: true });
  const s = rep.session;
  const ps = rep.players, qs = rep.questions;
  const answered = ps.reduce((a, p) => a + p.answered, 0);
  const correct = ps.reduce((a, p) => a + p.correct, 0);
  const avgScore = ps.length ? Math.round(ps.reduce((a, p) => a + p.score, 0) / ps.length) : 0;
  const pctQ = q => q.answers ? Math.round(100 * q.correct / q.answers) : null;
  const barCls = p => p >= 80 ? '' : p >= 60 ? 'warn' : 'bad';

  const cats = {};
  qs.forEach(q => { cats[q.category] ??= { a: 0, c: 0 }; cats[q.category].a += q.answers; cats[q.category].c += q.correct; });
  const attention = qs.filter(q => q.answers && pctQ(q) < 70).sort((a, b) => pctQ(a) - pctQ(b));

  panel().innerHTML = `
    <p><a href="#relatorios">← Voltar para o histórico</a></p>
    <div class="row between" style="margin-bottom:16px">
      <div>
        <h2 style="margin-bottom:4px">${esc(s.name)}</h2>
        <p class="muted" style="margin:0">${esc(s.quiz_title || '')} · ${modeLabel(s.mode)} · ${fmtDate(s.started_at || s.created_at)} · PIN ${s.pin}</p>
      </div>
      <div class="row">
        <button class="btn btn-primary" id="btn-xlsx" type="button">⬇ Exportar Excel</button>
        <a class="btn" href="${telaoUrl(s.id)}" target="_blank" rel="noopener">📺 Pódio no telão</a>
        ${!['finished', 'closed'].includes(s.status) ? `<a class="btn" href="#sessao/${s.id}">🎮 Controlar</a>` : ''}
        <button class="btn btn-danger" id="btn-del" type="button">Excluir</button>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><b>${ps.length}</b><span>Participantes</span></div>
      <div class="kpi"><b>${answered ? Math.round(100 * correct / answered) : 0}%</b><span>Acertos no geral</span></div>
      <div class="kpi"><b>${fmt(avgScore)}</b><span>Pontuação média</span></div>
      <div class="kpi"><b>${qs.length}</b><span>Perguntas</span></div>
    </div>

    <div class="grid-2">
      <div class="col">
        <div class="card">
          <h3>Acertos por tema</h3>
          ${Object.entries(cats).map(([c, v]) => {
            if (!v.a) return `<div style="margin-top:10px"><div class="row between small"><b>${esc(c)}</b><span class="muted">sem respostas</span></div><div class="bar"><i style="width:0"></i></div></div>`;
            const p = Math.round(100 * v.c / v.a);
            return `<div style="margin-top:10px"><div class="row between small"><b>${esc(c)}</b><span>${p}%</span></div><div class="bar ${barCls(p)}"><i style="width:${p}%"></i></div></div>`;
          }).join('')}
        </div>
        <div class="card">
          <h3>⚠️ Pontos de atenção</h3>
          <p class="small muted">Perguntas com menos de 70% de acertos. São bons temas para reforçar nos próximos encontros e DDS.</p>
          ${attention.length ? attention.map(q => {
            const wrong = q.distribution.map((n, i) => [n, i]).filter(([, i]) => i !== q.correct_index).sort((a, b) => b[0] - a[0])[0];
            return `<div class="attention"><b>${q.idx + 1}. ${esc(q.text)}</b> — ${pctQ(q)}% de acertos
              ${wrong && wrong[0] ? `<small>Resposta errada mais marcada: "${esc(q.options[wrong[1]])}" (${wrong[0]} pessoa${wrong[0] > 1 ? 's' : ''})</small>` : ''}</div>`;
          }).join('') : '<p class="empty" style="padding:12px">Nenhuma pergunta abaixo de 70%. 🎉</p>'}
        </div>
        ${rep.stores.length ? `<div class="card">
          <h3>Ranking das lojas</h3>
          <div class="table-wrap"><table><thead><tr><th class="num">#</th><th>Loja/Setor</th><th class="num">Part.</th><th class="num">Média</th><th class="num">Acertos</th></tr></thead>
          <tbody>${rep.stores.map(t => `<tr><td class="num">${medal(t.pos) || t.pos}</td><td>${esc(t.store)}</td><td class="num">${t.players}</td><td class="num"><b>${fmt(t.avg_score)}</b></td><td class="num">${t.correct_pct ?? 0}%</td></tr>`).join('')}</tbody></table></div>
        </div>` : ''}
      </div>

      <div class="col">
        <div class="card">
          <h3>Desempenho por pergunta</h3>
          <div class="table-wrap"><table>
            <thead><tr><th class="num">#</th><th>Pergunta</th><th>Acertos</th><th class="num">Tempo médio</th><th class="num">Sem resp.</th></tr></thead>
            <tbody>${qs.map(q => { const p = pctQ(q); return `<tr>
              <td class="num">${q.idx + 1}</td>
              <td class="qcell">${esc(q.text)}<br><span class="small muted">${esc(q.category)}</span></td>
              <td style="min-width:120px">${p === null ? '<span class="muted">–</span>' : `<div class="small">${p}%</div><div class="bar ${barCls(p)}"><i style="width:${p}%"></i></div>`}</td>
              <td class="num">${q.avg_ms ? (q.avg_ms / 1000).toFixed(1) + ' s' : '–'}</td>
              <td class="num">${q.timeouts}</td></tr>`; }).join('')}</tbody>
          </table></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Classificação geral</h3>
      ${ps.length ? `<div class="table-wrap"><table>
        <thead><tr><th class="num">#</th><th>Nome</th><th>Loja/Setor</th><th class="num">Pontos</th><th class="num">Acertos</th><th class="num">Maior seq.</th><th class="num">Tempo médio</th><th>Medalhas</th></tr></thead>
        <tbody>${ps.map(p => `<tr>
          <td class="num">${medal(p.pos) || p.pos}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.store)}</td>
          <td class="num"><b>${fmt(p.score)}</b></td><td class="num">${p.correct}/${qs.length}</td><td class="num">${p.best_streak}</td>
          <td class="num">${p.avg_ms ? (p.avg_ms / 1000).toFixed(1) + ' s' : '–'}</td>
          <td class="badge-icons">${p.badges.map(b => `<span title="${esc(badgeInfo(b).name)}">${badgeInfo(b).icon}</span>`).join('')}</td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nenhum participante.</p>'}
    </div>`;

  $('#btn-xlsx').addEventListener('click', e => withBusy(e.currentTarget, () => exportExcel(rep)));
  $('#btn-del').addEventListener('click', async () => {
    if (!confirm(`Excluir definitivamente a sessão "${s.name}" e todos os seus resultados? Esta ação não pode ser desfeita.`)) return;
    await rpc('admin_delete_session', { ...P(), p_session: s.id }).catch(handleError);
    toast('Sessão excluída.', 'success');
    location.hash = '#relatorios';
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('Não foi possível carregar o gerador de Excel.'));
    document.head.appendChild(el);
  });
}

async function exportExcel(rep) {
  if (!window.XLSX) await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  const X = window.XLSX;
  const s = rep.session, qs = rep.questions;
  const byId = Object.fromEntries(rep.players.map(p => [p.id, p]));
  const wb = X.utils.book_new();
  const add = (name, rows, widths) => {
    const ws = X.utils.json_to_sheet(rows);
    if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, name);
  };
  add('Classificação', rep.players.map(p => ({
    'Posição': p.pos, 'Nome': p.name, 'Loja/Setor': p.store, 'Pontos': p.score,
    'Acertos': p.correct, 'Respondidas': p.answered, 'Total de perguntas': qs.length,
    '% de acertos': p.answered ? Math.round(100 * p.correct / p.answered) : 0,
    'Maior sequência': p.best_streak, 'Tempo médio (s)': p.avg_ms ? +(p.avg_ms / 1000).toFixed(1) : '',
    'Medalhas': p.badges.map(b => badgeInfo(b).name).join(', '),
    'Entrou em': fmtDate(p.joined_at)
  })), [9, 30, 20, 10, 9, 12, 10, 12, 10, 12, 50, 16]);
  add('Lojas', rep.stores.map(t => ({
    'Posição': t.pos, 'Loja/Setor': t.store, 'Participantes': t.players,
    'Média de pontos': t.avg_score, 'Total de pontos': t.total_score, '% de acertos': t.correct_pct ?? 0
  })), [9, 26, 13, 15, 15, 12]);
  add('Perguntas', qs.map(q => ({
    'Nº': q.idx + 1, 'Categoria': q.category, 'Pergunta': q.text,
    'Resposta certa': `${LETTERS[q.correct_index]}) ${q.options[q.correct_index]}`,
    'Respostas': q.answers, 'Acertos': q.correct,
    '% de acertos': q.answers ? Math.round(100 * q.correct / q.answers) : '',
    'Sem resposta': q.timeouts, 'Tempo médio (s)': q.avg_ms ? +(q.avg_ms / 1000).toFixed(1) : '',
    ...Object.fromEntries(q.options.map((o, i) => [`Marcaram ${LETTERS[i]}`, q.distribution[i]]))
  })), [5, 22, 60, 50, 10, 9, 12, 12, 14, 11, 11, 11, 11]);
  add('Respostas', (rep.answers || []).map(a => {
    const p = byId[a.player_id] || {}, q = qs[a.q];
    return {
      'Nome': p.name, 'Loja/Setor': p.store, 'Pergunta nº': a.q + 1, 'Pergunta': q?.text,
      'Resposta marcada': a.chosen === null ? '(sem resposta)' : `${LETTERS[a.chosen]}) ${q?.options[a.chosen]}`,
      'Correta?': a.ok ? 'Sim' : 'Não', 'Tempo (s)': +(a.ms / 1000).toFixed(1), 'Pontos': a.pts
    };
  }), [28, 20, 11, 55, 50, 9, 9, 8]);
  const safe = s.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '_') || 'sessao';
  X.writeFile(wb, `CIPA_${safe}_${(s.started_at || s.created_at).slice(0, 10)}.xlsx`);
  toast('Planilha gerada.', 'success');
}

// =====================================================================
//  CONFIGURAÇÕES
// =====================================================================
async function loadSettings() {
  const st = await rpc('admin_get_settings', P());
  panel().innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2>Lojas e setores</h2>
        <p class="muted small">Um por linha. Os participantes escolhem nesta lista ao entrar, o que evita erros de digitação no ranking das lojas. Se a lista ficar vazia, cada pessoa digita a sua.</p>
        <textarea id="stores" rows="12" placeholder="Loja Centro&#10;Loja Bairro Novo&#10;Centro de Distribuição&#10;Administrativo">${esc((st.stores || []).join('\n'))}</textarea>
        <button class="btn btn-primary" id="btn-stores" type="button" style="margin-top:12px">Salvar lista</button>
      </div>
      <div class="col">
        <div class="card">
          <h2>Trocar senha</h2>
          <form id="form-pass">
            <div class="field"><label for="np1">Nova senha</label><input id="np1" type="password" minlength="6" autocomplete="new-password" required></div>
            <div class="field"><label for="np2">Repita a nova senha</label><input id="np2" type="password" minlength="6" autocomplete="new-password" required></div>
            <button class="btn btn-primary" type="submit" id="btn-pass">Trocar senha</button>
          </form>
        </div>
        <div class="card">
          <h2>Links úteis</h2>
          <p class="small muted" style="margin-bottom:4px">Participantes</p><code>${esc(playerUrl(''))}</code>
          <p class="small muted" style="margin:12px 0 4px">Telão (pede o PIN)</p><code>${esc(new URL('telao.html', location.href).href)}</code>
        </div>
      </div>
    </div>`;
  $('#btn-stores').addEventListener('click', e => withBusy(e.currentTarget, async () => {
    const r = await rpc('admin_save_settings', { ...P(), p_stores: $('#stores').value.split('\n') });
    $('#stores').value = r.stores.join('\n');
    toast('Lista salva.', 'success');
  }));
  $('#form-pass').addEventListener('submit', e => {
    e.preventDefault();
    const a = $('#np1').value, b = $('#np2').value;
    if (a !== b) { toast('As senhas não conferem.', 'error'); return; }
    withBusy($('#btn-pass'), async () => {
      await rpc('admin_change_password', { ...P(), p_new: a });
      pass = a;
      store.set(ADMIN_KEY, a);
      $('#default-pass-warning').classList.add('hidden');
      e.target.reset();
      toast('Senha alterada.', 'success');
    });
  });
}

init();
