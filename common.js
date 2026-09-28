import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const configured = !!SUPABASE_URL && !SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_KEY.includes('COLE-AQUI');
export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// ---------- chamadas ao banco ----------
let clockOffset = 0;
let bestRtt = Infinity;

export async function rpc(fn, args = {}) {
  const t0 = Date.now();
  const { data, error } = await sb.rpc(fn, args);
  const t1 = Date.now();
  if (error) {
    const msg = /fetch|network|Load failed/i.test(error.message || '')
      ? 'Sem conexão com o servidor. Verifique a internet.'
      : (error.message || 'Erro inesperado.');
    const e = new Error(msg);
    e.code = error.code;
    throw e;
  }
  const serverNow = data && typeof data === 'object' && !Array.isArray(data) ? data.server_now : null;
  if (serverNow) syncClock(serverNow, t0, t1);
  return data;
}

function syncClock(serverIso, t0, t1) {
  const rtt = t1 - t0;
  if (rtt > bestRtt * 1.5 && bestRtt !== Infinity) return;
  bestRtt = Math.min(bestRtt, rtt);
  clockOffset = Date.parse(serverIso) - (t0 + rtt / 2);
}

/** Horário do servidor (ms), corrigido pela diferença do relógio do aparelho. */
export const now = () => Date.now() + clockOffset;

// ---------- tempo real ----------
export function subscribe(sessionId, onChange, { players = true } = {}) {
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 150); };
  const ch = sb.channel('sess-' + sessionId + '-' + Math.random().toString(36).slice(2, 7))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, fire);
  if (players) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` }, fire);
  }
  ch.subscribe();
  return () => sb.removeChannel(ch);
}

// ---------- DOM ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function showScreen(id) {
  $$('.screen').forEach(el => el.classList.toggle('active', el.id === id));
  window.scrollTo(0, 0);
}

let toastTimer;
export function toast(msg, type = 'info') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

export const fmt = n => Number(n || 0).toLocaleString('pt-BR');
export const ordinal = n => `${n}º`;
export const medal = pos => ['🥇', '🥈', '🥉'][pos - 1] || '';
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
export function avatarColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 45%)`;
}

// ---------- alternativas ----------
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SHAPE_PATHS = [
  '<path d="M12 3 22 20H2z"/>',
  '<path d="M12 2 22 12 12 22 2 12z"/>',
  '<circle cx="12" cy="12" r="10"/>',
  '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  '<path d="M7 3h10l5 9-5 9H7l-5-9z"/>',
  '<path d="m12 2 3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z"/>'
];
export const shape = i => `<svg class="shape" viewBox="0 0 24 24" aria-hidden="true">${SHAPE_PATHS[i % 6]}</svg>`;

/** Ordem embaralhada estável para o participante (mesma ordem se recarregar a página). */
export function optionOrder(n, seedText, shuffle) {
  const order = [...Array(n).keys()];
  if (!shuffle) return order;
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const rand = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// ---------- conquistas ----------
const BADGES = {
  gabaritou:  { icon: '🏆', name: 'Gabaritou', desc: 'Acertou todas as perguntas' },
  precisao:   { icon: '🎯', name: 'Precisão', desc: 'Acertou 80% ou mais' },
  imparavel:  { icon: '🚀', name: 'Imparável', desc: '10 acertos seguidos' },
  em_chamas:  { icon: '🔥', name: 'Em chamas', desc: '5 acertos seguidos' },
  mao_rapida: { icon: '⚡', name: 'Mão rápida', desc: '5 acertos em menos de 5 segundos' },
  relampago:  { icon: '⏱️', name: 'Relâmpago', desc: 'Foi o mais rápido a acertar uma pergunta' },
  presenca:   { icon: '✅', name: 'Participação completa', desc: 'Respondeu todas as perguntas' }
};
export function badgeInfo(code) {
  if (BADGES[code]) return BADGES[code];
  if (code.startsWith('cat:')) {
    const cat = code.slice(4);
    if (/segur/i.test(cat)) return { icon: '🦺', name: 'Guardião da Segurança', desc: `Acertou todas de ${cat}` };
    if (/ass[eé]dio|respeito/i.test(cat)) return { icon: '🤝', name: 'Defensor do Respeito', desc: `Acertou todas de ${cat}` };
    return { icon: '🎓', name: `Mestre: ${cat}`, desc: `Acertou todas de ${cat}` };
  }
  return { icon: '⭐', name: code, desc: '' };
}
export const ALL_BADGES = Object.keys(BADGES);

// ---------- efeitos ----------
export function celebrate(power = 1) {
  if (typeof window.confetti !== 'function') return;
  const colors = ['#FFC400', '#1FA35C', '#FFFFFF', '#2F6FEB', '#E5484D'];
  const end = Date.now() + 1400 * power;
  (function frame() {
    window.confetti({ particleCount: 5, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors });
    window.confetti({ particleCount: 5, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

export function trophy(kind) {
  const c = { gold: ['#FFD54A', '#E0A800'], silver: ['#E6ECF2', '#A9B4C0'], bronze: ['#F0A868', '#B8672E'] }[kind];
  return `<svg class="trophy" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="tg-${kind}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient></defs>
    <path fill="url(#tg-${kind})" d="M18 6h28v14c0 9-6 16-14 16S18 29 18 20z"/>
    <path fill="none" stroke="${c[1]}" stroke-width="4" d="M18 10H9v5c0 6 5 10 10 10M46 10h9v5c0 6-5 10-10 10"/>
    <rect x="29" y="35" width="6" height="10" fill="${c[1]}"/>
    <rect x="20" y="45" width="24" height="7" rx="2" fill="url(#tg-${kind})"/>
    <rect x="16" y="52" width="32" height="6" rx="2" fill="${c[1]}"/>
  </svg>`;
}

// ---------- utilidades ----------
export const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* modo privado */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* modo privado */ } }
};

export const ADMIN_KEY = 'cipa_admin_pass';

export function playerUrl(pin) {
  const u = new URL('index.html', location.href);
  u.search = pin ? '?pin=' + pin : '';
  u.hash = '';
  return u.href;
}

export function notConfiguredHtml() {
  return `<div class="card center narrow">
    <h2>Falta configurar o Supabase</h2>
    <p class="muted">Abra o arquivo <code>assets/js/config.js</code> e informe a URL do projeto e a chave pública (anon/publishable).
    O passo a passo está no arquivo <code>README.md</code>.</p></div>`;
}

export async function keepAwake() {
  try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch { /* opcional */ }
}
