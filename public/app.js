'use strict';
/* 공통: 상태 · 도우미 · 로그인 · 앱 골격 · 라우팅 · 모달 */

const S = {
  meta: null, me: null, requests: [], users: [], usersById: {}, versions: [],
  lastView: 'board', detail: null, // { kind: 'r'|'v', id }
  board: { platform: '', job: '', mine: false, showClosed: false },
  list: { q: '', status: 'open', priority: '', platform: '', job: '', team: '', mine: false, requested: false },
  triageTab: '접수',
  draft: { attachments: [] },
};
let started = false;

// 요청 상태 = task-management 보드 칸 (규칙 v2) + 접수·보류·반려
const STATUS_CLASS = {
  '접수': 'st-접수', '백로그': 'st-백로그', '기획·디자인': 'st-진행예정', '개발 대기': 'st-개발대기', '개발': 'st-진행중',
  'QA': 'st-리뷰', '배포 대기': 'st-배포대기', '완료': 'st-완료', '보류': 'st-보류', '반려': 'st-반려',
  '계획': 'st-접수', '개발 중': 'st-진행중', '배포 완료': 'st-완료', '취소': 'st-취소',
};
const PRIO_LABEL = { P0: '즉시 대응', P1: '높음', P2: '보통', P3: '낮음' }; // P0~P3는 내부 값, 화면에는 한글만
const PRIO_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
const OPEN_STATUSES = ['접수', '백로그', '기획·디자인', '개발 대기', '개발', 'QA', '배포 대기', '보류'];
const NEEDS_REASON = ['보류', '반려'];
const UPCOMING = ['계획', '개발 중', 'QA', '배포 대기'];

const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const has = (perm) => !!(S.me && S.me.perms.includes(perm));

// ───────────────────────── 날짜·표시 ─────────────────────────
function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`;
  return fmtDateTime(iso).slice(0, 10);
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const fmtDay = (d) => (d ? d.replace(/-/g, '.') : '');
const shortDay = (d) => (d ? d.slice(5).replace('-', '.') : '');
function daysLeft(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const [y, m, dd] = d.split('-').map(Number);
  return Math.round((new Date(y, m - 1, dd) - t) / 86400000);
}
function dueText(d) {
  const diff = daysLeft(d);
  return diff > 0 ? `D-${diff}` : diff === 0 ? 'D-day' : `${-diff}일 지남`;
}
const rank = (p) => (p in PRIO_RANK ? PRIO_RANK[p] : 9);
const byPriority = (a, b) => rank(a.priority) - rank(b.priority) || new Date(a.createdAt) - new Date(b.createdAt);
const userName = (id) => (S.usersById[id] ? S.usersById[id].name : id || '');
const names = (ids) => (ids || []).map(userName).join(', ');
const vName = (s) => (/^\d+\.\d+/.test(s || '') ? 'v' + s : s || ''); // 2.3.0 → v2.3.0, 2026-11은 그대로
const vLabel = (v) => `${v.platform} ${vName(v.version)}`;

const statusBadge = (s) => `<span class="badge ${STATUS_CLASS[s] || ''}"><span class="dot"></span>${esc(s)}</span>`;
const prioBadge = (p) => (p ? `<span class="prio prio-${p}">${PRIO_LABEL[p]}</span>` : '<span class="prio prio-none">미정</span>');
const lvBadge = (l) => `<span class="lv lv-${esc(l)}">${esc(l)}</span>`;
const tags = (list) => (list || []).map((x) => `<span class="tag">${esc(x)}</span>`).join('');
const versionTags = (vs) => (vs || []).map((v) => `<span class="vtag${v.status === '배포 완료' ? ' shipped' : ''}" title="${esc(v.status)}">${esc(v.platform)} <b>${esc(vName(v.version))}</b></span>`).join('');

// 요청 진행 막대: 버전에 담긴 요청이 어디까지 왔는지
function reqMeter(reqs, { legend = true, size = 'mini' } = {}) {
  // 보드 칸을 네 묶음으로: 완료 / 검증·배포 대기 / 진행 중 / 대기
  const order = [['완료', '완료', ['완료']], ['검증·배포 대기', '리뷰', ['QA', '배포 대기']], ['진행 중', '진행중', ['기획·디자인', '개발 대기', '개발']], ['대기', '접수', ['접수', '백로그', '보류']]];
  const parts = order.map(([st, cls, sts]) => ({ st, cls, n: reqs.filter((r) => sts.includes(r.status)).length }));
  const total = reqs.length;
  const done = parts[0].n;
  const segs = total ? parts.filter((p) => p.n).map((p) => `<span class="seg-${p.cls}" style="width:${(p.n / total) * 100}%" title="${p.st} ${p.n}건"></span>`).join('') : '';
  return `<div class="meter ${size}" role="img" aria-label="요청 ${total}건 중 ${done}건 완료"><div class="bar">${segs}</div>${legend ? `<div class="legend">${parts
    .filter((p) => p.n).map((p) => `<span><i class="seg-${p.cls}"></i>${p.st} ${p.n}</span>`).join('')}<span class="pct">${done}/${total} 완료</span></div>` : ''}</div>`;
}

let toastTimer;
function toast(msg, err = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (err ? ' err' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), err ? 4500 : 2400);
}

async function api(method, url, body) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  let r;
  try { r = await fetch(url, opt); }
  catch { throw new Error('서버에 연결하지 못했어요. 서버 창이 켜져 있는지 확인해 주세요.'); }
  let data = null;
  try { data = await r.json(); } catch { /* 본문 없음 */ }
  if (r.status === 401 && url !== '/api/login') {
    S.me = null;
    renderLogin('로그인이 만료됐어요. 다시 로그인해 주세요.');
    throw new Error('로그인이 필요해요.');
  }
  if (!r.ok) throw new Error((data && data.message) || '처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return data;
}

async function refresh() {
  const [reqs, users, me, versions] = await Promise.all([api('GET', '/api/requests'), api('GET', '/api/users'), api('GET', '/api/me'), api('GET', '/api/versions')]);
  S.requests = reqs;
  S.users = users;
  S.usersById = Object.fromEntries(users.map((u) => [u.memberId, u]));
  S.versions = versions;
  const permsChanged = me.perms.join() !== S.me.perms.join();
  S.me = me;
  if (permsChanged) renderShell();
  updateSide();
}
const refreshSafe = () => refresh().catch((e) => toast(e.message, true));

// ───────────────────────── 로그인 (통합계정 SSO) ─────────────────────────
const mockBanner = () =>
  S.meta.ssoMode === 'mock' ? '<div class="mock-banner">테스트 로그인 모드예요 — 실제 통합계정 대신 테스트 계정으로 로그인해요.</div>' : '';

function renderLogin(msg = '') {
  const m = S.meta;
  const dr = $('#drawer-root'); if (dr) dr.innerHTML = '';
  closeModal();
  app.innerHTML = `${mockBanner()}
  <div class="login"><div class="login-card panel">
    <div class="brand"><span class="logo"></span><div><b>요청 창구</b><small>기획 · 개발 · 디자인 요청과 배포</small></div></div>
    <div><h1>로그인</h1><p class="muted" style="margin-top:4px">통합계정 아이디와 비밀번호를 입력해 주세요.</p></div>
    <form id="login-form">
      <div class="field"><label class="label" for="lg-id">아이디</label><input class="input" id="lg-id" autocomplete="username" required></div>
      <div class="field"><label class="label" for="lg-pw">비밀번호</label><input class="input" id="lg-pw" type="password" autocomplete="current-password" required></div>
      <div class="err-box" id="lg-err" ${msg ? '' : 'hidden'}>${esc(msg)}</div>
      <button class="btn primary block" type="submit" id="lg-btn">로그인</button>
    </form>
    ${m.ssoMode === 'mock' ? `<div class="mock-list"><div class="h">테스트 계정 · 비밀번호 1234 · 누르면 바로 로그인돼요</div>
      ${m.mockUsers.map((u) => `<button type="button" data-mock="${esc(u.memberId)}"><span>${esc(u.memberName)} <span class="mono">${esc(u.memberId)}</span></span><small>${esc(u.label)}</small></button>`).join('')}
    </div>` : ''}
  </div></div>`;
  $('#login-form').onsubmit = (e) => { e.preventDefault(); doLogin($('#lg-id').value.trim(), $('#lg-pw').value); };
  $$('[data-mock]').forEach((b) => (b.onclick = () => {
    $('#lg-id').value = b.dataset.mock;
    $('#lg-pw').value = '1234';
    doLogin(b.dataset.mock, '1234');
  }));
  $('#lg-id').focus();
}

async function doLogin(memberId, loginPw) {
  const btn = $('#lg-btn'), err = $('#lg-err');
  if (!memberId || !loginPw) { err.textContent = '아이디와 비밀번호를 입력해 주세요.'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = '로그인 중…'; err.hidden = true;
  try {
    // ① 브라우저 → 통합계정: ID/PW로 1단계 로그인 (비밀번호는 이 서버로 보내지 않음)
    let r1;
    try {
      r1 = await fetch(S.meta.ssoBaseUrl + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId, loginPw }),
      });
    } catch { throw new Error('통합계정 서버에 연결하지 못했어요. 사내망 연결을 확인해 주세요.'); }
    const d1 = await r1.json().catch(() => ({}));
    if (!r1.ok) throw new Error(d1.message || '로그인하지 못했어요.');
    // ② 다른 시스템 SSO용 Second Token 보관
    try { sessionStorage.setItem('secondToken', d1.secondToken || ''); } catch { /* 무시 */ }
    // ③ 임시 Token(15초)을 바로 이 서버로 → 서버가 ④⑤⑥ 처리 후 세션 쿠키 발급(⑦)
    S.me = await api('POST', '/api/login', { tempToken: d1.tempToken });
    await startApp();
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
    btn.disabled = false; btn.textContent = '로그인';
  }
}

// ───────────────────────── 앱 골격 ─────────────────────────
function roleName() {
  return (S.me.roles || []).map((r) => (S.meta.roles.find((x) => x.id === r) || {}).name || r).join(', ');
}

function renderShell() {
  const me = S.me;
  app.innerHTML = `${mockBanner()}
  <div class="layout${S.meta.ssoMode === 'mock' ? ' with-banner' : ''}">
    <aside class="side">
      <div class="brand"><span class="logo"></span><div><b>요청 창구</b><small>요청부터 배포까지 한곳에서</small></div></div>
      <a class="btn primary block" href="#/new">+ 요청 등록</a>
      <nav class="nav" aria-label="주 메뉴">
        <div class="group">요청</div>
        <a href="#/board" data-nav="board">요청 보드</a>
        <a href="#/list" data-nav="list">요청 목록</a>
        ${has('request.triage') ? '<a href="#/triage" data-nav="triage">우선순위 회의 <span class="count" id="triage-count" hidden></span></a>' : ''}
        <div class="group">배포</div>
        <a href="#/versions" data-nav="versions">버전 관리</a>
        ${has('admin') ? '<div class="group">관리</div><a href="#/notifications" data-nav="notifications">알림 기록</a><a href="#/admin" data-nav="admin">권한 관리</a>' : ''}
      </nav>
      <div class="side-next" id="side-next" hidden></div>
      <div class="me">
        <span class="avatar">${me.photoUrl ? `<img src="${esc(me.photoUrl)}" alt="">` : esc(me.name.slice(0, 1))}</span>
        <div class="who"><b>${esc(me.name)}</b><small>${esc(me.team || '-')} · ${esc(roleName())}</small></div>
        <button class="btn ghost sm" id="logout">로그아웃</button>
      </div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  if (!$('#drawer-root')) document.body.insertAdjacentHTML('beforeend', '<div id="drawer-root"></div><div id="modal-root" class="modal-root"></div>');
  $('#logout').onclick = async () => {
    await api('POST', '/api/logout', {}).catch(() => {});
    try { sessionStorage.removeItem('secondToken'); } catch { /* 무시 */ }
    S.me = null;
    renderLogin();
  };
  if (S.lastView && started) renderView(S.lastView);
}

// 사이드바: 플랫폼별 다음 배포
function updateSide() {
  const c = $('#triage-count');
  if (c) {
    const n = S.requests.filter((r) => !r.restricted && r.status === '접수').length;
    c.textContent = n;
    c.hidden = !n;
  }
  const box = $('#side-next');
  if (!box) return;
  const rows = S.meta.enums.versionPlatforms.map((p) => {
    const next = S.versions.filter((v) => v.platform === p && UPCOMING.includes(v.status))
      .sort((a, b) => (a.plannedDate || '9999').localeCompare(b.plannedDate || '9999'))[0];
    if (!next) return '';
    const d = next.plannedDate ? dueText(next.plannedDate) : '날짜 미정';
    return `<a href="#/v/${next.id}"><span class="p">${esc(p)}</span><span class="mono">${esc(vName(next.version))}</span><span class="d">${esc(d)}</span></a>`;
  }).join('');
  box.hidden = !rows;
  box.innerHTML = rows ? `<div class="h">다음 배포</div>${rows}` : '';
}

// ───────────────────────── 라우팅 ─────────────────────────
function parseHash() {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  if ((a === 'r' || a === 'v') && /^\d+$/.test(b || '')) return { view: 'detail', kind: a, id: Number(b) };
  if (VIEWS[a]) return { view: a };
  return { view: 'board' };
}

const VIEWS = {
  board: { fn: () => viewBoard },
  list: { fn: () => viewList },
  triage: { fn: () => viewTriage, perm: 'request.triage' },
  new: { fn: () => viewNew },
  versions: { fn: () => viewVersions },
  notifications: { fn: () => viewNotifications, perm: 'admin' },
  admin: { fn: () => viewAdmin, perm: 'admin' },
};

function renderView(v) {
  const main = $('#main');
  if (!main) return;
  if (!VIEWS[v] || (VIEWS[v].perm && !has(VIEWS[v].perm))) v = 'board';
  main.dataset.view = v;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === v));
  VIEWS[v].fn()(main);
}

async function route() {
  if (!S.me) return;
  const r = parseHash();
  closeModal();
  if (r.view === 'detail') {
    S.detail = { kind: r.kind, id: r.id };
    if (!$('#main').dataset.view && r.kind === 'v') S.lastView = 'versions'; // 링크로 바로 들어오면 뒤에 버전 화면을 깔아요
    if ($('#main').dataset.view !== S.lastView) { await refreshSafe(); renderView(S.lastView); }
    if (r.kind === 'r') openRequestDrawer(r.id);
    else openVersionDrawer(r.id);
    return;
  }
  S.detail = null;
  $('#drawer-root').innerHTML = '';
  S.lastView = r.view;
  if (r.view !== 'new') await refreshSafe();
  renderView(r.view);
}

function closeDrawer() { location.hash = '#/' + S.lastView; }

async function startApp() {
  renderShell();
  await refreshSafe();
  if (!started) {
    started = true;
    window.addEventListener('hashchange', route);
    setInterval(poll, 45000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  }
  route();
}

// 입력 중이 아닌 화면만 주기적으로 새로 그림
async function poll() {
  if (document.hidden || !S.me || S.detail || $('#modal-root .modal')) return;
  const v = S.lastView;
  if (!['board', 'list', 'versions'].includes(v)) return;
  if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  try {
    await refresh();
    if (S.detail || S.lastView !== v) return;
    if (v === 'list') renderListResults();
    else renderView(v);
  } catch { /* 다음 주기에 다시 */ }
}

// ───────────────────────── 모달 ─────────────────────────
function openModal(html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay" data-mclose></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  $$('[data-mclose]', root).forEach((b) => (b.onclick = (e) => { e.preventDefault(); closeModal(); }));
  const m = $('.modal', root);
  if (onMount) onMount(m);
  const first = $('input:not([type=hidden]):not([type=radio]),textarea,select', m);
  if (first) first.focus();
  return m;
}
function closeModal() {
  const root = $('#modal-root');
  if (root) root.innerHTML = '';
}

// ───────────────────────── 공통 UI 조각 ─────────────────────────
function selectHtml(key, allLabel, options, value) {
  return `<select class="select sm" data-f="${key}" aria-label="${esc(allLabel)}"><option value="">${esc(allLabel)}</option>${options
    .map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('')}</select>`;
}
const toggleHtml = (key, label, checked) => `<label class="toggle"><input type="checkbox" data-f="${key}" ${checked ? 'checked' : ''}> ${label}</label>`;

function bindFilters(root, rerender) {
  $$('[data-f]', root).forEach((el) => {
    el.addEventListener(el.type === 'search' ? 'input' : 'change', () => {
      const [obj, key] = el.dataset.f.split('.');
      S[obj][key] = el.type === 'checkbox' ? el.checked : el.value;
      rerender();
    });
  });
}

function chipGroup(name, opts, type, cls = '', selected = []) {
  return opts.map((o) => `<label class="chip${cls ? ` ${cls}-${esc(o)}` : ''}"><input type="${type}" name="${name}" value="${esc(o)}" ${selected.includes(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('');
}

function assigneePicker(selected) {
  const groups = {};
  S.users.forEach((u) => (groups[u.job || '기타'] = groups[u.job || '기타'] || []).push(u));
  const order = ['기획', '개발', '디자인', ...Object.keys(groups).filter((k) => !['기획', '개발', '디자인'].includes(k))];
  const body = order.filter((g) => groups[g]).map((g) => `<div class="pg-h">${esc(g)}</div>${groups[g]
    .map((u) => `<label><input type="checkbox" value="${esc(u.memberId)}" ${selected.includes(u.memberId) ? 'checked' : ''}> ${esc(u.name)} <small>${esc(u.team)}</small></label>`).join('')}`).join('');
  return `<details class="picker"><summary>${pickerLabel(selected)}</summary><div class="picker-menu">${
    body || '<div class="muted" style="padding:8px">한 번 이상 로그인한 처리 담당자만 고를 수 있어요.</div>'}</div></details>`;
}
const pickerLabel = (ids) => (ids.length ? esc(names(ids)) : '<span class="muted">담당자 선택</span>');
const pickerValue = (root) => $$('.picker input:checked', root).map((i) => i.value);

// ───────────────────────── 전역 이벤트 ─────────────────────────
document.addEventListener('click', (e) => {
  $$('details.picker[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
});
document.addEventListener('change', (e) => {
  const picker = e.target.closest && e.target.closest('.picker');
  if (picker) $('summary', picker).innerHTML = pickerLabel(pickerValue(picker.parentElement));
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = $('details.picker[open]');
  if (open) { open.open = false; return; }
  if ($('#modal-root .modal')) { closeModal(); return; }
  if (S.detail) closeDrawer();
});
document.addEventListener('paste', (e) => {
  if (!S.me || S.detail || $('#main')?.dataset.view !== 'new') return;
  const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (imgs.length) { e.preventDefault(); addFiles(imgs); }
});

// ───────────────────────── 시작 ─────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  try { S.meta = await fetch('/api/meta').then((r) => r.json()); }
  catch { app.innerHTML = '<div class="boot">서버에 연결하지 못했어요. 서버 창이 켜져 있는지 확인해 주세요.</div>'; return; }
  const r = await fetch('/api/me', { credentials: 'same-origin' });
  if (!r.ok) return renderLogin();
  S.me = await r.json();
  startApp();
});
