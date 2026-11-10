'use strict';
/**
 * 사내 요청 창구 — 서버
 * 외부 패키지 없이 Node.js 20 이상에서 실행: node server.js  (테스트 모드 예시 데이터: node server.js --seed)
 */
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const cfg = loadConfig();
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || cfg.dataDir || 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_COOKIE = 'rq_sid';

const ENUMS = {
  platforms: ['앱', '웹', '키오스크', '기타'],
  types: ['버그·오류', '기능 개선', '신규 기능', '디자인', '데이터·운영 지원', '기타'],
  jobs: ['기획', '개발', '디자인'],
  levels: ['상', '중', '하'],
  statuses: ['접수', '진행 예정', '진행 중', '완료', '보류', '반려'],
  priorities: ['P0', 'P1', 'P2', 'P3'],
  taskStatuses: ['할 일', '진행 중', '리뷰', '완료'],
  epicColors: ['#4a6fa5', '#2f8f83', '#7a5bb8', '#b8693a', '#a8456f', '#5a7a2c'],
};
const STATUS_NEEDS_REASON = new Set(['보류', '반려']);
const ASSIGNEE_STATUSES = new Set(['진행 예정', '진행 중', '완료']);
const IMG_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// ───────────────────────── 권한 ─────────────────────────
const PERMS = [
  { key: 'request.viewAll', label: '모든 팀의 요청 보기' },
  { key: 'request.triage', label: '우선순위 회의 진행 (우선순위·담당자 지정, 보류·반려)' },
  { key: 'work.view', label: '작업 관리 보기 (스프린트 보드·백로그·에픽)' },
  { key: 'work.edit', label: '작업 만들기·수정·상태 변경 (담당자 후보가 돼요)' },
  { key: 'work.plan', label: '스프린트·에픽 관리, 작업 삭제' },
  { key: 'admin', label: '권한 관리, 알림 기록, 연동 관리' },
];
const PERM_KEYS = PERMS.map((p) => p.key);
const ROLES = [
  { id: 'admin', name: '관리자', desc: '모든 권한을 가져요.' },
  { id: 'lead', name: '리드', desc: '우선순위 회의를 진행하고 스프린트·에픽을 계획해요.' },
  { id: 'member', name: '작업자', desc: '기획·개발·디자인 실무자예요.' },
  { id: 'opsLead', name: '운영 리드', desc: '운영 쪽 대표로 우선순위 회의에 참여해요.' },
  { id: 'requester', name: '요청자', desc: '요청을 등록하고 자기 팀 요청을 봐요.' },
];
const ROLE_IDS = ROLES.map((r) => r.id);
const DEFAULT_ROLE_PERMS = {
  admin: PERM_KEYS,
  lead: ['request.viewAll', 'request.triage', 'work.view', 'work.edit', 'work.plan'],
  member: ['request.viewAll', 'work.view', 'work.edit'],
  opsLead: ['request.viewAll', 'request.triage'],
  requester: [],
};

// ───────────────────────── 설정 ─────────────────────────
function loadConfig() {
  const file = process.env.CONFIG_PATH || path.join(ROOT, 'config.json');
  const fallback = path.join(ROOT, 'config.example.json');
  const src = fs.existsSync(file) ? file : fallback;
  if (src === fallback) console.warn('[설정] config.json이 없어 config.example.json으로 실행해요.');
  const c = JSON.parse(fs.readFileSync(src, 'utf8'));
  c.port = Number(process.env.PORT || c.port || 8080);
  c.host = process.env.HOST || c.host || '0.0.0.0';
  c.baseUrl = (process.env.BASE_URL || c.baseUrl || `http://localhost:${c.port}`).replace(/\/$/, '');
  c.sso = c.sso || {};
  c.sso.mode = process.env.SSO_MODE || c.sso.mode || 'real';
  c.sso.baseUrl = (process.env.SSO_BASE_URL || c.sso.baseUrl || '').replace(/\/$/, '');
  c.github = c.github || {};
  c.github.token = process.env.GITHUB_TOKEN || c.github.token || '';
  c.github.apiUrl = (process.env.GITHUB_API_URL || c.github.apiUrl || 'https://api.github.com').replace(/\/$/, '');
  c.github.repoByPlatform = c.github.repoByPlatform || {};
  c.github.repos = c.github.repos || [];
  c.github.pollSeconds = Math.max(15, Number(process.env.GITHUB_POLL_SECONDS || c.github.pollSeconds || 60));
  c.slack = c.slack || {};
  c.slack.webhookUrl = process.env.SLACK_WEBHOOK_URL || c.slack.webhookUrl || '';
  c.slack.botToken = process.env.SLACK_BOT_TOKEN || c.slack.botToken || '';
  c.groupMap = c.groupMap || {};
  c.admins = c.admins || [];
  c.mockUsers = c.mockUsers || [];
  c.sessionHours = Number(c.sessionHours || 12);
  c.boardShowsAllTeams = c.boardShowsAllTeams !== false;
  if (c.sso.mode === 'real' && !c.sso.baseUrl) throw new Error('sso.baseUrl을 설정해 주세요.');
  return c;
}

// ───────────────────────── 저장소 (JSON 파일) ─────────────────────────
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
let db = {
  seq: 0, taskSeq: 0, epicSeq: 0, sprintSeq: 0,
  requests: [], tasks: [], epics: [], sprints: [],
  users: {}, sessions: {}, notifications: [],
  roleOverrides: {}, rolePerms: null, ghSync: {},
};
if (fs.existsSync(DB_PATH)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };

let saveChain = Promise.resolve();
function save() {
  saveChain = saveChain
    .then(async () => {
      const tmp = DB_PATH + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(db));
      await fsp.rename(tmp, DB_PATH);
    })
    .catch((e) => console.error('[저장 실패]', e));
  return saveChain;
}

// ───────────────────────── 공통 도우미 ─────────────────────────
const now = () => new Date().toISOString();
const today = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400e3 + 9 * 3600e3).toISOString().slice(0, 10);
const rand = (n = 24) => crypto.randomBytes(n).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const pickList = (v, allowed) => (Array.isArray(v) ? [...new Set(v.filter((x) => allowed.includes(x)))] : []);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const who = (u) => ({ memberId: u.memberId, name: u.name });
const sumPoints = (list) => list.reduce((s, t) => s + (Number(t.points) || 0), 0);
const userName = (id) => (db.users[id] ? db.users[id].name : id);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req, limit = 30 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpError(413, '보내는 내용이 너무 커요.');
    chunks.push(c);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw httpError(400, 'JSON 형식이 올바르지 않아요.');
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function setSecurityHeaders(res) {
  const ssoOrigin = cfg.sso.mode === 'real' ? new URL(cfg.sso.baseUrl).origin : '';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${ssoOrigin}; ` +
      `font-src 'self'; connect-src 'self' ${ssoOrigin}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  );
}

// 상태를 바꾸는 요청은 JSON + 같은 출처만 허용 (CSRF 방지)
function checkCsrf(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw httpError(415, 'JSON 요청만 받아요.');
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* 잘못된 Origin */ }
    if (host !== req.headers.host) throw httpError(403, '허용되지 않은 출처예요.');
  }
}

// ───────────────────────── 사용자·권한 ─────────────────────────
// 통합계정 권한그룹(permGroupIds) → 팀·직군·역할
function legacyRole(m) {
  if (m.scope === 'all') return m.triage ? 'lead' : 'member';
  return m.triage ? 'opsLead' : 'requester';
}

function resolveGroups(groupIds) {
  const matched = (Array.isArray(groupIds) ? groupIds : [])
    .filter((g) => cfg.groupMap[g])
    .map((g) => ({ id: g, ...cfg.groupMap[g] }));
  if (!matched.length) return null;
  const roles = [...new Set(matched.map((m) => (ROLE_IDS.includes(m.role) ? m.role : legacyRole(m))))];
  const primary = matched.find((m) => m.job && m.job !== '운영') || matched[0];
  return {
    team: primary.team || '',
    job: primary.job || '',
    teams: [...new Set(matched.map((m) => m.team).filter(Boolean))],
    ssoRoles: roles,
    groups: matched.map((m) => m.id),
  };
}

function rolePermsTable() {
  const t = { ...DEFAULT_ROLE_PERMS, ...(db.rolePerms || {}) };
  t.admin = PERM_KEYS;
  return t;
}
function rolesOf(u) {
  if (cfg.admins.includes(u.memberId)) return ['admin'];
  if (db.roleOverrides[u.memberId]) return [db.roleOverrides[u.memberId]];
  return u.ssoRoles && u.ssoRoles.length ? u.ssoRoles : ['requester'];
}
function permsOf(u) {
  const table = rolePermsTable();
  const set = new Set();
  for (const r of rolesOf(u)) (table[r] || []).forEach((p) => set.add(p));
  return set;
}
const can = (u, p) => permsOf(u).has(p);
function need(u, p) {
  if (!can(u, p)) throw httpError(403, '이 작업을 할 권한이 없어요. 관리자에게 권한을 요청해 주세요.');
}

function upsertUser(info, { login = true } = {}) {
  const g = resolveGroups(info.permGroupIds);
  if (!g && !cfg.admins.includes(info.memberId)) return null;
  const prev = db.users[info.memberId] || {};
  let photoUrl = null;
  if (info.photoUrl) photoUrl = /^https?:\/\//.test(info.photoUrl) ? info.photoUrl : cfg.sso.baseUrl + info.photoUrl;
  const u = {
    memberId: info.memberId,
    name: info.memberName || info.memberId,
    email: info.email || '',
    photoUrl,
    team: '', job: '', teams: [], ssoRoles: [], groups: [],
    ...(g || {}),
    firstLoginAt: prev.firstLoginAt || (login ? now() : null),
    lastLoginAt: login ? now() : prev.lastLoginAt || null,
  };
  db.users[u.memberId] = u;
  return u;
}

const publicUser = (u) =>
  u && {
    memberId: u.memberId, name: u.name, team: u.team, teams: u.teams, job: u.job, photoUrl: u.photoUrl,
    roles: rolesOf(u), perms: [...permsOf(u)],
  };

function currentUser(req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  const s = db.sessions[sha(sid)];
  if (!s || s.exp < Date.now()) return null;
  return db.users[s.memberId] || null;
}

function sessionCookie(value, maxAge) {
  const secure = cfg.baseUrl.startsWith('https://') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function canView(u, r) {
  return can(u, 'request.viewAll') || can(u, 'request.triage') || u.teams.includes(r.requesterTeam) ||
    r.requester.memberId === u.memberId || r.assignees.includes(u.memberId);
}

// ───────────────────────── 통합계정 SSO ─────────────────────────
// 실제: 매뉴얼 ④ POST {SSO}/api/auth/login/complete (서버 대 서버)
// 테스트(mock): 같은 규칙(15초·1회용 임시 Token)을 흉내 내는 가짜 통합계정
const mockTemp = new Map();

function mockLogin(body) {
  if (!str(body.memberId, 100) || !str(body.loginPw, 200)) return [400, { status: 400, message: 'memberId : 공백일 수 없습니다' }];
  const u = cfg.mockUsers.find((m) => m.memberId === body.memberId);
  if (!u || body.loginPw !== (u.password || '1234')) return [401, { status: 401, message: '입력 정보를 확인해주세요.' }];
  for (const [k, v] of mockTemp) if (v.memberId === u.memberId || v.exp < Date.now()) mockTemp.delete(k);
  const tempToken = rand(16);
  mockTemp.set(tempToken, { memberId: u.memberId, exp: Date.now() + 15000 });
  return [200, { tempToken, secondToken: rand(16) }];
}

function mockComplete(tempToken) {
  const e = mockTemp.get(tempToken);
  mockTemp.delete(tempToken);
  if (!e || e.exp < Date.now()) return null;
  const u = cfg.mockUsers.find((m) => m.memberId === e.memberId);
  return { memberId: u.memberId, memberName: u.memberName, email: u.email || '', photoUrl: null, permGroupIds: u.permGroupIds || [] };
}

async function ssoComplete(tempToken) {
  if (cfg.sso.mode === 'mock') return mockComplete(tempToken);
  let r;
  try {
    r = await fetch(cfg.sso.baseUrl + '/api/auth/login/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error('[SSO] 통합계정 서버 연결 실패:', e.message);
    throw httpError(502, '통합계정 서버에 연결하지 못했어요. 잠시 후 다시 로그인해 주세요.');
  }
  if (!r.ok) return null; // 401: 임시 Token 무효·만료
  return r.json();
}

async function handleLogin(req, res) {
  const body = await readJson(req);
  const tempToken = str(body.tempToken, 500);
  if (!tempToken) throw httpError(400, '임시 Token이 없어요.');
  const info = await ssoComplete(tempToken);
  if (!info || !info.memberId) throw httpError(401, '로그인 시간이 지났어요. 다시 로그인해 주세요.');
  const u = upsertUser(info);
  if (!u) throw httpError(403, '요청 창구를 쓸 수 있는 권한그룹이 아니에요. 관리자에게 문의해 주세요.');
  const sid = rand(32);
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < Date.now()) delete db.sessions[k];
  db.sessions[sha(sid)] = { memberId: u.memberId, exp: Date.now() + cfg.sessionHours * 3600e3 };
  await save();
  res.setHeader('Set-Cookie', sessionCookie(sid, cfg.sessionHours * 3600));
  send(res, 200, publicUser(u));
}

function handleLogout(req, res) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid && db.sessions[sha(sid)]) {
    delete db.sessions[sha(sid)];
    save();
  }
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  send(res, 200, { ok: true });
}

// ───────────────────────── 요청 ─────────────────────────
const commentCount = (list) => list.filter((t) => t.type === 'comment').length;
const tasksOf = (r) => db.tasks.filter((t) => t.requestId === r.id);

function listItem(r) {
  const { timeline, ...rest } = r;
  const tasks = tasksOf(r);
  return { ...rest, commentCount: commentCount(timeline), taskStats: { total: tasks.length, done: tasks.filter((t) => t.status === '완료').length } };
}

// 다른 팀 요청: 보드에서 대기열만 보이도록 요약 정보만 전달
function summaryItem(r) {
  return {
    id: r.id, title: r.title, status: r.status, priority: r.priority, platforms: r.platforms, type: r.type, jobs: r.jobs,
    requesterTeam: r.requesterTeam, assignees: r.assignees, createdAt: r.createdAt, updatedAt: r.updatedAt, restricted: true,
  };
}

function detailFor(u, r) {
  const triage = can(u, 'request.triage');
  return {
    ...r,
    tasks: tasksOf(r).sort((a, b) => a.id - b.id).map((t) => ({ id: t.id, key: t.key, title: t.title, status: t.status, assignee: t.assignee, job: t.job, points: t.points })),
    perms: { triage, status: triage || r.assignees.includes(u.memberId), addTask: can(u, 'work.edit') },
  };
}

function listFor(u) {
  return db.requests.map((r) => (canView(u, r) ? listItem(r) : cfg.boardShowsAllTeams ? summaryItem(r) : null)).filter(Boolean);
}

async function saveAttachments(list) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > 5) throw httpError(400, '첨부는 5개까지 가능해요.');
  const prepared = list.map((a) => {
    const ext = IMG_TYPES[a && a.type];
    if (!ext) throw httpError(400, '이미지 파일(png, jpg, gif, webp)만 첨부할 수 있어요.');
    const buf = Buffer.from(String(a.data || ''), 'base64');
    if (!buf.length || buf.length > 5 * 1024 * 1024) throw httpError(400, '첨부 파일은 하나당 5MB 이하만 가능해요.');
    return { name: str(a.name, 120), type: a.type, ext, buf };
  });
  const out = [];
  for (const p of prepared) {
    const file = rand(16) + p.ext;
    await fsp.writeFile(path.join(UPLOAD_DIR, file), p.buf);
    out.push({ name: p.name || file, file, type: p.type, size: p.buf.length });
  }
  return out;
}

async function createRequest(u, b) {
  const errors = [];
  const title = str(b.title, 120);
  const platforms = pickList(b.platforms, ENUMS.platforms);
  const type = ENUMS.types.includes(b.type) ? b.type : '';
  const jobs = pickList(b.jobs, ENUMS.jobs);
  const description = str(b.description, 5000);
  const reproSteps = str(b.reproSteps, 3000);
  const urgency = ENUMS.levels.includes(b.urgency) ? b.urgency : '';
  const importance = ENUMS.levels.includes(b.importance) ? b.importance : '';
  const urgencyReason = str(b.urgencyReason, 1000);
  const importanceReason = str(b.importanceReason, 1000);
  const dueDate = isDate(b.dueDate) ? b.dueDate : null;

  if (!title) errors.push('제목을 입력해 주세요.');
  if (!platforms.length) errors.push('대상 플랫폼을 하나 이상 골라 주세요.');
  if (!type) errors.push('요청 유형을 골라 주세요.');
  if (!description) errors.push('요청 내용을 입력해 주세요.');
  if (!urgency) errors.push('긴급도를 골라 주세요.');
  if (!urgencyReason) errors.push('긴급하다고 생각한 이유를 적어 주세요.');
  if (!importance) errors.push('중요도를 골라 주세요.');
  if (!importanceReason) errors.push('중요하다고 생각한 이유를 적어 주세요.');
  if (errors.length) throw httpError(400, errors.join('\n'));

  const attachments = await saveAttachments(b.attachments);
  const at = now();
  const r = {
    id: ++db.seq, title, platforms, type, jobs, description, reproSteps, dueDate,
    urgency, urgencyReason, importance, importanceReason, attachments,
    requester: { memberId: u.memberId, name: u.name, team: u.team }, requesterTeam: u.team,
    status: '접수', statusReason: '', priority: null, assignees: [], targetVersion: '',
    github: null, createdAt: at, updatedAt: at,
    timeline: [{ type: 'created', at, by: who(u) }],
  };
  db.requests.push(r);
  await save();

  notify(subjReq(r), u, `🆕 새 요청이 접수됐어요 · ${r.platforms.join('/')} · ${r.type}\n요청: ${u.name} (${u.team}) · 긴급도 ${urgency} / 중요도 ${importance}`, { channel: true });
  ghQueue(() => ghCreateRequestIssue(r));
  return r;
}

async function updateRequest(u, r, b) {
  const triage = can(u, 'request.triage');
  const assignee = r.assignees.includes(u.memberId);
  if (!triage && !assignee) throw httpError(403, '이 요청을 변경할 권한이 없어요.');
  const triageOnly = (field) => {
    if (!triage) throw httpError(403, `${field} 변경은 우선순위 회의 권한이 있어야 해요.`);
  };

  // 1) 검증하면서 바뀔 값만 모으기 (실패하면 아무것도 바꾸지 않음)
  const changes = [];
  if (b.priority !== undefined) {
    const p = b.priority === null || b.priority === '' ? null : b.priority;
    if (p !== null && !ENUMS.priorities.includes(p)) throw httpError(400, '우선순위 값이 올바르지 않아요.');
    if (p !== r.priority) { triageOnly('우선순위'); changes.push({ type: 'priority', from: r.priority, to: p }); }
  }
  if (b.jobs !== undefined) {
    const j = pickList(b.jobs, ENUMS.jobs);
    if (!sameSet(j, r.jobs)) { triageOnly('담당 직군'); changes.push({ type: 'jobs', from: r.jobs, to: j }); }
  }
  if (b.assignees !== undefined) {
    const a = Array.isArray(b.assignees) ? [...new Set(b.assignees.filter((id) => typeof id === 'string' && db.users[id]))] : [];
    if (!sameSet(a, r.assignees)) { triageOnly('담당자'); changes.push({ type: 'assignees', from: r.assignees, to: a }); }
  }
  if (b.targetVersion !== undefined) {
    const v = str(b.targetVersion, 40);
    if (v !== r.targetVersion) changes.push({ type: 'version', from: r.targetVersion, to: v });
  }
  let status = b.status;
  // 접수 상태에서 우선순위가 확정되면 자동으로 '진행 예정'
  if ((status === undefined || status === r.status) && r.status === '접수' && changes.some((c) => c.type === 'priority' && c.to)) status = '진행 예정';
  if (status !== undefined && status !== r.status) {
    if (!ENUMS.statuses.includes(status)) throw httpError(400, '상태 값이 올바르지 않아요.');
    if (!triage && !ASSIGNEE_STATUSES.has(status)) throw httpError(403, '담당자는 진행 예정·진행 중·완료로만 바꿀 수 있어요.');
    const reason = str(b.statusReason, 1000);
    if (STATUS_NEEDS_REASON.has(status) && !reason) throw httpError(400, `${status} 사유를 입력해 주세요.`);
    changes.push({ type: 'status', from: r.status, to: status, reason });
  }
  await applyRequestChanges(r, u, changes);
}

// 요청 변경 적용 + 기록 + 알림 + GitHub 반영 (사람·작업 연동 공통)
async function applyRequestChanges(r, actor, changes) {
  if (!changes.length) return;
  const at = now();
  for (const c of changes) {
    if (c.type === 'priority') r.priority = c.to;
    if (c.type === 'jobs') r.jobs = c.to;
    if (c.type === 'assignees') r.assignees = c.to;
    if (c.type === 'version') r.targetVersion = c.to;
    if (c.type === 'status') { r.status = c.to; r.statusReason = c.reason || ''; }
    r.timeline.push({ ...c, at, by: who(actor) });
  }
  r.updatedAt = at;
  await save();

  const lines = changes.map(describeChange);
  const added = (changes.find((c) => c.type === 'assignees') || { to: [] }).to;
  const notable = changes.some((c) => c.type === 'status' || c.type === 'priority');
  notify(subjReq(r), actor, `${lines.join('\n')}\n(변경: ${actor.name})`, { channel: notable, dm: [r.requester.memberId, ...r.assignees, ...added] });
  ghQueue(() => ghSyncRequestUpdate(r, actor, changes, lines));
}

function describeChange(c) {
  switch (c.type) {
    case 'status': return `상태: ${c.from} → ${c.to}${c.reason ? ` (사유: ${c.reason})` : ''}`;
    case 'priority': return `우선순위: ${c.from || '미정'} → ${c.to || '미정'}`;
    case 'jobs': return `담당 직군: ${c.to.join(', ') || '미정'}`;
    case 'assignees': return `담당자: ${c.to.map(userName).join(', ') || '없음'}`;
    case 'version': return `반영 버전: ${c.to || '없음'}`;
    default: return '';
  }
}

async function addRequestComment(u, r, b) {
  const text = str(b.text, 3000);
  if (!text) throw httpError(400, '댓글 내용을 입력해 주세요.');
  const at = now();
  r.timeline.push({ type: 'comment', at, by: who(u), text });
  r.updatedAt = at;
  await save();
  notify(subjReq(r), u, `💬 ${u.name}: ${text.length > 200 ? text.slice(0, 200) + '…' : text}`, { channel: false, dm: [r.requester.memberId, ...r.assignees] });
  ghQueue(async () => {
    if (r.github && r.github.number) await ghComment(r.github, `💬 **${u.name}** (요청 창구 댓글)\n\n${text}`);
  });
}

// ───────────────────────── 작업 (Jira형 관리) ─────────────────────────
const TASK_FIELD_LABEL = {
  title: '제목', description: '설명', status: '상태', assignee: '담당자', points: '스토리 포인트', labels: '라벨',
  dueDate: '마감일', priority: '우선순위', job: '직군', epicId: '에픽', sprintId: '스프린트', repo: '저장소',
};

function displayTaskField(field, v) {
  if (field === 'sprintId' && v == null) return '백로그';
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '없음';
  if (field === 'assignee') return userName(v);
  if (field === 'epicId') { const e = db.epics.find((x) => x.id === v); return e ? `${e.key} ${e.title}` : '없음'; }
  if (field === 'sprintId') { const s = db.sprints.find((x) => x.id === v); return s ? s.name : '백로그'; }
  if (field === 'labels') return v.join(', ');
  if (field === 'description') return '(내용 수정)';
  return String(v);
}

function nextRank(sprintId) {
  const ranks = db.tasks.filter((t) => (t.sprintId ?? null) === sprintId).map((t) => t.rank || 0);
  return (ranks.length ? Math.max(...ranks) : 0) + 1;
}

function parseTaskFields(b, creating) {
  const f = {};
  const has = (k) => b[k] !== undefined;
  if (creating || has('title')) {
    const t = str(b.title, 200);
    if (!t) throw httpError(400, '작업 제목을 입력해 주세요.');
    f.title = t;
  }
  if (has('description')) f.description = str(b.description, 10000);
  if (has('status')) {
    if (!ENUMS.taskStatuses.includes(b.status)) throw httpError(400, '작업 상태 값이 올바르지 않아요.');
    f.status = b.status;
  }
  if (has('assignee')) {
    const a = b.assignee || null;
    if (a && !(db.users[a] && can(db.users[a], 'work.edit'))) throw httpError(400, '작업 권한이 없는 사람은 담당자로 지정할 수 없어요.');
    f.assignee = a;
  }
  if (has('points')) {
    const p = b.points === null || b.points === '' ? null : Number(b.points);
    if (p !== null && !(Number.isFinite(p) && p >= 0 && p <= 100)) throw httpError(400, '스토리 포인트는 0~100 사이 숫자로 입력해 주세요.');
    f.points = p;
  }
  if (has('labels')) f.labels = Array.isArray(b.labels) ? [...new Set(b.labels.map((x) => str(x, 30)).filter(Boolean))].slice(0, 10) : [];
  if (has('dueDate')) f.dueDate = isDate(b.dueDate) ? b.dueDate : null;
  if (has('priority')) {
    const p = b.priority || null;
    if (p && !ENUMS.priorities.includes(p)) throw httpError(400, '우선순위 값이 올바르지 않아요.');
    f.priority = p;
  }
  if (has('job')) {
    const j = b.job || '';
    if (j && !ENUMS.jobs.includes(j)) throw httpError(400, '직군 값이 올바르지 않아요.');
    f.job = j;
  }
  if (has('epicId')) {
    const e = b.epicId === null || b.epicId === '' ? null : Number(b.epicId);
    if (e !== null && !db.epics.some((x) => x.id === e)) throw httpError(400, '없는 에픽이에요.');
    f.epicId = e;
  }
  if (has('sprintId')) {
    const s = b.sprintId === null || b.sprintId === '' ? null : Number(b.sprintId);
    if (s !== null) {
      const sp = db.sprints.find((x) => x.id === s);
      if (!sp || sp.state === 'closed') throw httpError(400, '끝난 스프린트에는 작업을 넣을 수 없어요.');
    }
    f.sprintId = s;
  }
  if (has('repo')) {
    const r = str(b.repo, 100);
    if (r && !reposList().includes(r)) throw httpError(400, '설정되지 않은 저장소예요.');
    f.repo = r;
  }
  if (has('rank')) {
    const r = Number(b.rank);
    if (!Number.isFinite(r)) throw httpError(400, '순서 값이 올바르지 않아요.');
    f.rank = r;
  }
  if (creating && b.requestId != null && b.requestId !== '') {
    const id = Number(b.requestId);
    if (!db.requests.some((x) => x.id === id)) throw httpError(400, '없는 요청이에요.');
    f.requestId = id;
  }
  return f;
}

const taskListItem = (t) => {
  const { timeline, ...rest } = t;
  return { ...rest, commentCount: commentCount(timeline) };
};

async function createTask(u, b) {
  const f = parseTaskFields(b, true);
  const req = f.requestId ? db.requests.find((x) => x.id === f.requestId) : null;
  const id = ++db.taskSeq;
  const at = now();
  const sprintId = f.sprintId ?? null;
  const t = {
    id, key: `TASK-${id}`, title: f.title, description: f.description || '', status: f.status || '할 일',
    assignee: f.assignee || null, points: f.points ?? null, labels: f.labels || [], dueDate: f.dueDate || null,
    priority: f.priority !== undefined ? f.priority : req ? req.priority : null,
    job: f.job || '', epicId: f.epicId ?? null, sprintId, requestId: req ? req.id : null,
    repo: f.repo || (req ? repoFor(req) : cfg.github.defaultRepo || ''),
    rank: f.rank ?? nextRank(sprintId), github: null, prs: [],
    createdBy: who(u), createdAt: at, updatedAt: at, timeline: [{ type: 'created', at, by: who(u) }],
  };
  db.tasks.push(t);
  if (req) req.timeline.push({ type: 'task', at, by: who(u), text: `${t.key} ${t.title}` });
  await save();
  if (t.assignee && t.assignee !== u.memberId) notify(subjTask(t), u, `작업이 배정됐어요 (배정: ${u.name})`, { channel: false, dm: [t.assignee] });
  ghQueue(() => ghCreateTaskIssue(t));
  if (t.status !== '할 일') await cascadeRequest(t, u);
  return t;
}

async function updateTask(u, t, b) {
  const f = parseTaskFields(b, false);
  const changes = [];
  for (const [k, v] of Object.entries(f)) {
    if (k === 'rank') continue;
    if (k === 'repo' && t.github && t.github.number) continue; // 이슈가 만들어진 뒤에는 저장소 고정
    if (JSON.stringify(t[k] ?? null) !== JSON.stringify(v ?? null)) changes.push({ field: k, from: t[k], to: v });
  }
  if (f.rank !== undefined) t.rank = f.rank;
  if (!changes.length) { if (f.rank !== undefined) await save(); return; }
  await applyTaskChanges(t, u, changes);
}

async function applyTaskChanges(t, actor, changes, { fromGitHub = false } = {}) {
  const at = now();
  for (const c of changes) {
    t.timeline.push({ type: 'field', field: c.field, label: TASK_FIELD_LABEL[c.field], from: displayTaskField(c.field, c.from), to: displayTaskField(c.field, c.to), at, by: who(actor) });
    t[c.field] = c.to;
  }
  t.updatedAt = at;
  await save();

  const fields = new Set(changes.map((c) => c.field));
  if (fields.has('assignee') && t.assignee && t.assignee !== actor.memberId) {
    notify(subjTask(t), actor, `작업이 배정됐어요 (배정: ${actor.name})`, { channel: false, dm: [t.assignee] });
  }
  if (!fromGitHub && t.github && t.github.number && (fields.has('title') || fields.has('status'))) {
    ghQueue(async () => {
      if (fields.has('title')) await ghPushTaskTitle(t);
      if (fields.has('status')) await ghPushTaskStatus(t);
    });
  }
  if (fields.has('status')) await cascadeRequest(t, actor);
}

// 작업 상태 → 연결된 요청 상태 자동 반영
async function cascadeRequest(t, actor) {
  if (!t.requestId) return;
  const r = db.requests.find((x) => x.id === t.requestId);
  if (!r || r.status === '반려' || r.status === '보류') return;
  const list = tasksOf(r);
  let to = null;
  let reason = '';
  if (list.length && list.every((x) => x.status === '완료')) {
    if (r.status !== '완료') { to = '완료'; reason = '연결된 작업이 모두 끝났어요.'; }
  } else if (list.some((x) => x.status !== '할 일')) {
    if (r.status === '진행 예정' || r.status === '완료') to = '진행 중';
  }
  if (to) await applyRequestChanges(r, actor, [{ type: 'status', from: r.status, to, reason }]);
}

async function addTaskComment(u, t, b) {
  const text = str(b.text, 3000);
  if (!text) throw httpError(400, '댓글 내용을 입력해 주세요.');
  const at = now();
  t.timeline.push({ type: 'comment', at, by: who(u), text });
  t.updatedAt = at;
  await save();
  if (t.assignee && t.assignee !== u.memberId) notify(subjTask(t), u, `💬 ${u.name}: ${text.slice(0, 200)}`, { channel: false, dm: [t.assignee] });
  ghQueue(async () => {
    if (t.github && t.github.number) await ghComment(t.github, `💬 **${u.name}** (요청 창구 댓글)\n\n${text}`);
  });
}

async function deleteTask(u, t) {
  db.tasks = db.tasks.filter((x) => x.id !== t.id);
  if (t.requestId) {
    const r = db.requests.find((x) => x.id === t.requestId);
    if (r) r.timeline.push({ type: 'taskDeleted', at: now(), by: who(u), text: `${t.key} ${t.title}` });
  }
  await save();
  ghQueue(async () => {
    if (!t.github || !t.github.number) return;
    await ghComment(t.github, `🗑️ **${u.name}** 님이 요청 창구에서 이 작업을 삭제했어요.`);
    await gh('PATCH', `/repos/${t.github.repo}/issues/${t.github.number}`, { state: 'closed', state_reason: 'not_planned' });
  });
  const rest = db.tasks.find((x) => x.requestId === t.requestId);
  if (rest) await cascadeRequest(rest, u);
}

// ───────────────────────── 스프린트·에픽 ─────────────────────────
async function createSprint(u, b) {
  const id = ++db.sprintSeq;
  const s = {
    id, name: str(b.name, 60) || `스프린트 ${id}`, goal: str(b.goal, 300),
    startDate: isDate(b.startDate) ? b.startDate : null, endDate: isDate(b.endDate) ? b.endDate : null,
    state: 'planned', createdAt: now(), createdBy: who(u), startedAt: null, closedAt: null, summary: null,
  };
  if (s.startDate && s.endDate && s.endDate < s.startDate) throw httpError(400, '끝나는 날이 시작일보다 빨라요.');
  db.sprints.push(s);
  await save();
  return s;
}

async function updateSprint(u, s, b) {
  if (s.state === 'closed') throw httpError(400, '끝난 스프린트는 바꿀 수 없어요.');
  if (b.name !== undefined) s.name = str(b.name, 60) || s.name;
  if (b.goal !== undefined) s.goal = str(b.goal, 300);
  if (b.startDate !== undefined) s.startDate = isDate(b.startDate) ? b.startDate : null;
  if (b.endDate !== undefined) s.endDate = isDate(b.endDate) ? b.endDate : null;
  if (s.startDate && s.endDate && s.endDate < s.startDate) throw httpError(400, '끝나는 날이 시작일보다 빨라요.');
  await save();
}

async function startSprint(u, s) {
  if (s.state !== 'planned') throw httpError(400, '계획 중인 스프린트만 시작할 수 있어요.');
  if (db.sprints.some((x) => x.state === 'active')) throw httpError(400, '이미 진행 중인 스프린트가 있어요. 먼저 완료해 주세요.');
  s.state = 'active';
  s.startDate = s.startDate || today();
  s.endDate = s.endDate || today(14);
  s.startedAt = now();
  await save();
}

async function completeSprint(u, s, b) {
  if (s.state !== 'active') throw httpError(400, '진행 중인 스프린트만 완료할 수 있어요.');
  const moveTo = b.moveTo === undefined || b.moveTo === null || b.moveTo === '' ? null : Number(b.moveTo);
  if (moveTo !== null && !db.sprints.some((x) => x.id === moveTo && x.state === 'planned')) throw httpError(400, '옮길 스프린트를 다시 골라 주세요.');
  const tasks = db.tasks.filter((t) => t.sprintId === s.id);
  const done = tasks.filter((t) => t.status === '완료');
  s.summary = { total: tasks.length, done: done.length, points: sumPoints(tasks), donePoints: sumPoints(done) };
  const at = now();
  let rank = nextRank(moveTo);
  for (const t of tasks) {
    if (t.status === '완료') continue;
    t.timeline.push({ type: 'field', field: 'sprintId', label: TASK_FIELD_LABEL.sprintId, from: s.name, to: displayTaskField('sprintId', moveTo), at, by: who(u) });
    t.sprintId = moveTo;
    t.rank = rank++;
    t.updatedAt = at;
  }
  s.state = 'closed';
  s.closedAt = at;
  await save();
}

async function createEpic(u, b) {
  const title = str(b.title, 120);
  if (!title) throw httpError(400, '에픽 이름을 입력해 주세요.');
  const id = ++db.epicSeq;
  const e = {
    id, key: `EP-${id}`, title, description: str(b.description, 2000),
    color: ENUMS.epicColors.includes(b.color) ? b.color : ENUMS.epicColors[(id - 1) % ENUMS.epicColors.length],
    status: 'open', createdAt: now(), createdBy: who(u),
  };
  db.epics.push(e);
  await save();
  return e;
}

async function updateEpic(u, e, b) {
  if (b.title !== undefined) e.title = str(b.title, 120) || e.title;
  if (b.description !== undefined) e.description = str(b.description, 2000);
  if (b.color !== undefined && ENUMS.epicColors.includes(b.color)) e.color = b.color;
  if (b.status !== undefined) {
    if (!['open', 'done'].includes(b.status)) throw httpError(400, '에픽 상태 값이 올바르지 않아요.');
    e.status = b.status;
  }
  await save();
}

// ───────────────────────── 관리자 ─────────────────────────
function adminUsers() {
  return Object.values(db.users)
    .map((u) => ({
      memberId: u.memberId, name: u.name, team: u.team, job: u.job, groups: u.groups || [], ssoRoles: u.ssoRoles || [],
      override: db.roleOverrides[u.memberId] || null, roles: rolesOf(u), configAdmin: cfg.admins.includes(u.memberId),
      lastLoginAt: u.lastLoginAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

async function setUserRole(u, target, b) {
  if (target.memberId === u.memberId) throw httpError(400, '자기 역할은 바꿀 수 없어요. 다른 관리자에게 요청해 주세요.');
  if (cfg.admins.includes(target.memberId)) throw httpError(400, '설정 파일(admins)에 지정된 관리자는 화면에서 바꿀 수 없어요.');
  const role = b.role || null;
  if (role !== null && !ROLE_IDS.includes(role)) throw httpError(400, '없는 역할이에요.');
  if (role === null) delete db.roleOverrides[target.memberId];
  else db.roleOverrides[target.memberId] = role;
  await save();
}

async function setRolePerms(b) {
  const input = b.rolePerms || {};
  const next = {};
  for (const r of ROLE_IDS) {
    if (r === 'admin') continue;
    next[r] = pickList(input[r] !== undefined ? input[r] : rolePermsTable()[r], PERM_KEYS).filter((p) => p !== 'admin');
  }
  db.rolePerms = next;
  await save();
}

// ───────────────────────── 알림 (슬랙) ─────────────────────────
const subjReq = (r) => ({ ref: `REQ-${r.id}`, title: r.title, link: `#/r/${r.id}` });
const subjTask = (t) => ({ ref: t.key, title: t.title, link: `#/t/${t.id}` });
const slackEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function slackPost(url, payload, token) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (token) {
    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error);
  }
}

async function slackDm(user, text) {
  if (!user.email) throw new Error('이메일 없음');
  const t = cfg.slack.botToken;
  const lookup = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(user.email)}`, {
    headers: { Authorization: `Bearer ${t}` },
    signal: AbortSignal.timeout(10000),
  }).then((x) => x.json());
  if (!lookup.ok) throw new Error(lookup.error);
  await slackPost('https://slack.com/api/chat.postMessage', { channel: lookup.user.id, text }, t);
}

// 모든 알림은 '알림 기록'에 남고, 슬랙이 설정돼 있으면 실제로 전송
async function notify(subj, actor, text, { channel = true, dm = [] } = {}) {
  const targets = [...new Set(dm)].filter((id) => id && id !== actor.memberId).map((id) => db.users[id]).filter(Boolean);
  if (!channel && !targets.length) return;
  const message = `*[${subj.ref}] ${slackEsc(subj.title)}*\n${slackEsc(text)}\n<${cfg.baseUrl}/${subj.link}|요청 창구에서 보기>`;
  const entry = { id: rand(6), at: now(), ref: subj.ref, link: subj.link, title: subj.title, text, channel, dm: targets.map((t) => t.name), delivery: [] };
  db.notifications.unshift(entry);
  if (db.notifications.length > 300) db.notifications.length = 300;

  if (channel) {
    if (!cfg.slack.webhookUrl) entry.delivery.push('채널: 웹훅 미설정 (기록만)');
    else {
      try { await slackPost(cfg.slack.webhookUrl, { text: message }); entry.delivery.push('채널: 전송됨'); }
      catch (e) { entry.delivery.push(`채널: 실패 (${e.message})`); }
    }
  }
  for (const t of targets) {
    if (!cfg.slack.botToken) { entry.delivery.push(`DM ${t.name}: 봇 토큰 미설정 (기록만)`); continue; }
    try { await slackDm(t, message); entry.delivery.push(`DM ${t.name}: 전송됨`); }
    catch (e) { entry.delivery.push(`DM ${t.name}: 실패 (${e.message})`); }
  }
  save();
}

// ───────────────────────── GitHub 연동 (양방향) ─────────────────────────
// 나가는 방향: 이슈 생성·제목·상태(라벨+열림/닫힘)·댓글
// 들어오는 방향: 주기적 조회(polling)로 이슈 상태·제목·댓글, PR 연결·머지를 반영 → 사내 서버를 외부에 열 필요 없음
const GH_MARKER = '<!-- request-hub -->';
const GH_ACTOR = { memberId: 'github', name: 'GitHub' };
const STATUS_LABEL = { '진행 중': '상태:진행 중', '리뷰': '상태:리뷰' };
const pollState = { lastAt: null, lastError: null };

function reposList() {
  return [...new Set([cfg.github.defaultRepo, ...Object.values(cfg.github.repoByPlatform), ...cfg.github.repos].filter(Boolean))];
}
const githubEnabled = () => !!(cfg.github.token && reposList().length);

let ghChain = Promise.resolve();
// 모든 GitHub 호출은 한 줄로 실행해서 보내기와 받아오기가 서로 엇갈리지 않게 해요
function ghQueue(fn) {
  if (!githubEnabled()) return Promise.resolve();
  const next = ghChain.then(fn).catch((e) => console.error('[GitHub]', e.message));
  ghChain = next;
  return next;
}

async function gh(method, url, body) {
  const r = await fetch(cfg.github.apiUrl + url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.github.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'internal-request-hub',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 본문 없음 */ }
  if (!r.ok) {
    const e = new Error(`GitHub ${r.status}: ${(data && data.message) || text}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

async function ghCreateIssue(repo, payload) {
  try { return await gh('POST', `/repos/${repo}/issues`, payload); }
  catch (e) {
    if (e.status !== 422 || !payload.labels) throw e;
    const { labels, ...rest } = payload; // 라벨 권한이 없으면 라벨 없이 다시 시도
    return gh('POST', `/repos/${repo}/issues`, rest);
  }
}

const ghComment = (g, body) => gh('POST', `/repos/${g.repo}/issues/${g.number}/comments`, { body: `${body}\n\n${GH_MARKER}` });

function repoFor(r) {
  const byP = cfg.github.repoByPlatform;
  if (r.platforms.length === 1 && byP[r.platforms[0]]) return byP[r.platforms[0]];
  return cfg.github.defaultRepo || reposList()[0] || '';
}

const cell = (s) => String(s || '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function requestIssueBody(r) {
  return [
    `> 사내 요청 창구에서 자동으로 만든 이슈예요. 요청 원문·첨부·진행 기록: ${cfg.baseUrl}/#/r/${r.id}`,
    '',
    '| 항목 | 내용 |',
    '|---|---|',
    `| 요청자 | ${cell(`${r.requester.name} (${r.requesterTeam})`)} |`,
    `| 플랫폼 | ${cell(r.platforms.join(', '))} |`,
    `| 유형 | ${cell(r.type)} |`,
    `| 담당 직군 | ${cell(r.jobs.join(', ') || '미정')} |`,
    `| 희망 완료일 | ${cell(r.dueDate)} |`,
    `| 긴급도 | **${r.urgency}** — ${cell(r.urgencyReason)} |`,
    `| 중요도 | **${r.importance}** — ${cell(r.importanceReason)} |`,
    '',
    '## 요청 내용',
    r.description,
    ...(r.reproSteps ? ['', '## 재현 방법', r.reproSteps] : []),
    ...(r.attachments.length ? ['', `첨부 이미지 ${r.attachments.length}개는 요청 창구에서 볼 수 있어요.`] : []),
  ].join('\n');
}

async function ghCreateRequestIssue(r) {
  if (r.github && r.github.number) return;
  const repo = repoFor(r);
  if (!repo) { r.github = { error: '대상 저장소가 설정되지 않았어요.' }; return save(); }
  try {
    const issue = await ghCreateIssue(repo, {
      title: `[REQ-${r.id}] ${r.title}`, body: requestIssueBody(r),
      labels: ['요청창구', ...r.platforms.map((p) => `플랫폼:${p}`), `유형:${r.type}`],
    });
    r.github = { repo, number: issue.number, id: issue.id, url: issue.html_url };
  } catch (e) {
    r.github = { repo, error: e.message };
  }
  await save();
}

async function ghSyncRequestUpdate(r, actor, changes, lines) {
  if (!r.github || !r.github.number) return;
  const base = `/repos/${r.github.repo}/issues/${r.github.number}`;
  await ghComment(r.github, `🔄 **${actor.name}** 님이 요청 창구에서 변경했어요\n\n${lines.map((l) => `- ${l}`).join('\n')}`);
  const p = changes.find((c) => c.type === 'priority');
  if (p) {
    if (p.from) await gh('DELETE', `${base}/labels/${encodeURIComponent('우선순위:' + p.from)}`).catch(() => {});
    if (p.to) await gh('POST', `${base}/labels`, { labels: [`우선순위:${p.to}`] }).catch((e) => console.error('[GitHub] 라벨:', e.message));
  }
  const s = changes.find((c) => c.type === 'status');
  if (s) {
    if (s.to === '완료') await gh('PATCH', base, { state: 'closed', state_reason: 'completed' });
    else if (s.to === '반려') await gh('PATCH', base, { state: 'closed', state_reason: 'not_planned' });
    else if (s.from === '완료' || s.from === '반려') await gh('PATCH', base, { state: 'open' });
  }
}

function deriveStatus(issue) {
  if (issue.state === 'closed') return '완료';
  const names = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  if (names.includes(STATUS_LABEL['리뷰'])) return '리뷰';
  if (names.includes(STATUS_LABEL['진행 중'])) return '진행 중';
  return '할 일';
}

async function ghCreateTaskIssue(t) {
  if (t.github && t.github.number) return;
  if (!db.tasks.includes(t)) return; // 그사이 삭제됨
  const repo = t.repo || cfg.github.defaultRepo;
  if (!repo) { t.github = { error: '저장소가 설정되지 않았어요.' }; return save(); }
  const req = t.requestId ? db.requests.find((r) => r.id === t.requestId) : null;
  const body = [
    `> 사내 요청 창구 작업 **${t.key}** · ${cfg.baseUrl}/#/t/${t.id}`,
    ...(req ? [`> 연결된 요청: REQ-${req.id} ${req.title}${req.github && req.github.number ? ` (${req.github.repo}#${req.github.number})` : ''}`] : []),
    '',
    t.description || '_설명 없음_',
    '',
    '---',
    `PR 제목이나 본문에 \`${t.key}\` 또는 \`Closes #이슈번호\`를 적으면 이 작업에 연결돼요. PR이 열리면 '리뷰', 머지되면 '완료'로 바뀌어요.`,
  ].join('\n');
  try {
    const issue = await ghCreateIssue(repo, {
      title: `[${t.key}] ${t.title}`, body,
      labels: ['작업', ...(t.job ? [`직군:${t.job}`] : []), ...(STATUS_LABEL[t.status] ? [STATUS_LABEL[t.status]] : [])],
    });
    t.github = { repo, number: issue.number, id: issue.id, url: issue.html_url, syncedStatus: deriveStatus(issue), syncedTitle: t.title };
    await save();
    if (t.status !== t.github.syncedStatus) await ghPushTaskStatus(t);
    if (req && req.github && req.github.number) {
      await gh('POST', `/repos/${req.github.repo}/issues/${req.github.number}/sub_issues`, { sub_issue_id: issue.id })
        .catch((e) => console.warn('[GitHub] 하위 이슈 연결 실패:', e.message));
    }
  } catch (e) {
    t.github = { repo, error: e.message };
  }
  await save();
}

async function ghPushTaskTitle(t) {
  if (!t.github || !t.github.number) return;
  await gh('PATCH', `/repos/${t.github.repo}/issues/${t.github.number}`, { title: `[${t.key}] ${t.title}` });
  t.github.syncedTitle = t.title;
  await save();
}

async function ghPushTaskStatus(t) {
  if (!t.github || !t.github.number) return;
  const want = t.status;
  const base = `/repos/${t.github.repo}/issues/${t.github.number}`;
  for (const l of Object.values(STATUS_LABEL)) {
    if (l !== STATUS_LABEL[want]) await gh('DELETE', `${base}/labels/${encodeURIComponent(l)}`).catch(() => {});
  }
  if (STATUS_LABEL[want]) await gh('POST', `${base}/labels`, { labels: [STATUS_LABEL[want]] });
  await gh('PATCH', base, want === '완료' ? { state: 'closed', state_reason: 'completed' } : { state: 'open' });
  t.github.syncedStatus = want;
  await save();
}

const findByIssue = (list, repo, number) => list.find((x) => x.github && x.github.repo === repo && x.github.number === number);

async function inboundIssue(repo, it) {
  const t = findByIssue(db.tasks, repo, it.number);
  if (!t) return;
  const changes = [];
  const derived = deriveStatus(it);
  // GitHub 쪽이 마지막으로 맞춰 둔 상태와 다를 때만 GitHub에서 바뀐 것으로 봐요
  if (derived !== t.github.syncedStatus) {
    t.github.syncedStatus = derived;
    if (t.status !== derived) changes.push({ field: 'status', from: t.status, to: derived });
  }
  const title = String(it.title || '').replace(/^\[TASK-\d+\]\s*/, '').trim();
  if (title && title !== t.github.syncedTitle) {
    t.github.syncedTitle = title;
    if (t.title !== title) changes.push({ field: 'title', from: t.title, to: title });
  }
  if (changes.length) await applyTaskChanges(t, GH_ACTOR, changes, { fromGitHub: true });
}

async function inboundPull(repo, it) {
  const text = `${it.title || ''}\n${it.body || ''}`;
  const ids = new Set();
  for (const m of text.matchAll(/\bTASK-(\d+)\b/gi)) ids.add(Number(m[1]));
  for (const m of text.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)) {
    const t = findByIssue(db.tasks, repo, Number(m[1]));
    if (t) ids.add(t.id);
  }
  const merged = !!(it.pull_request && it.pull_request.merged_at);
  const pr = { repo, number: it.number, url: it.html_url, title: it.title, state: merged ? 'merged' : it.state, draft: !!it.draft, author: it.user ? it.user.login : '' };
  for (const id of ids) {
    const t = db.tasks.find((x) => x.id === id);
    if (!t) continue;
    t.prs = t.prs || [];
    const prev = t.prs.find((p) => p.repo === repo && p.number === it.number);
    if (prev && prev.state === pr.state && prev.title === pr.title && prev.draft === pr.draft) continue;
    const before = prev ? { state: prev.state, draft: prev.draft } : null; // 갱신 전 상태로 비교
    const at = now();
    if (!prev) { t.prs.push({ ...pr }); t.timeline.push({ type: 'pr', at, by: GH_ACTOR, text: `PR #${pr.number} 연결: ${pr.title}`, url: pr.url }); }
    else Object.assign(prev, pr);
    const newlyMerged = merged && (!before || before.state !== 'merged');
    const newlyReady = pr.state === 'open' && !pr.draft && (!before || before.state !== 'open' || before.draft);
    if (newlyMerged) t.timeline.push({ type: 'pr', at, by: GH_ACTOR, text: `PR #${pr.number} 머지됨`, url: pr.url });
    t.updatedAt = at;
    let to = null;
    if (newlyMerged && t.status !== '완료') to = '완료';
    else if (newlyReady && (t.status === '할 일' || t.status === '진행 중')) to = '리뷰';
    if (to) await applyTaskChanges(t, GH_ACTOR, [{ field: 'status', from: t.status, to }]);
    else await save();
  }
}

async function inboundComment(repo, c) {
  if (String(c.body || '').includes(GH_MARKER)) return; // 우리가 보낸 댓글
  const number = Number(String(c.issue_url || '').split('/').pop());
  const target = findByIssue(db.tasks, repo, number) || findByIssue(db.requests, repo, number);
  if (!target || target.timeline.some((x) => x.ghCommentId === c.id)) return;
  const login = c.user ? c.user.login : 'GitHub';
  target.timeline.push({ type: 'comment', at: c.created_at || now(), by: { memberId: null, name: `${login} (GitHub)` }, text: String(c.body || ''), ghCommentId: c.id, url: c.html_url });
  target.updatedAt = now();
  await save();
  if (target.requester) {
    notify(subjReq(target), GH_ACTOR, `💬 ${login} (GitHub): ${String(c.body || '').slice(0, 200)}`, { channel: false, dm: [target.requester.memberId, ...target.assignees] });
  } else if (target.assignee) {
    notify(subjTask(target), GH_ACTOR, `💬 ${login} (GitHub): ${String(c.body || '').slice(0, 200)}`, { channel: false, dm: [target.assignee] });
  }
}

async function ghPollRepo(repo) {
  const st = db.ghSync[repo] || (db.ghSync[repo] = {});
  const startedAt = Date.now();
  const since = encodeURIComponent(st.since || new Date(startedAt - 24 * 3600e3).toISOString());
  const items = [];
  for (let page = 1; page <= 5; page++) {
    const list = await gh('GET', `/repos/${repo}/issues?state=all&since=${since}&sort=updated&direction=asc&per_page=100&page=${page}`);
    items.push(...list);
    if (list.length < 100) break;
  }
  for (const it of items) {
    if (it.pull_request) await inboundPull(repo, it);
    else await inboundIssue(repo, it);
  }
  const comments = await gh('GET', `/repos/${repo}/issues/comments?since=${since}&sort=updated&direction=asc&per_page=100`);
  for (const c of comments) await inboundComment(repo, c);
  st.since = new Date(startedAt - 10000).toISOString(); // 시계 차이 대비 10초 겹쳐서 조회
  await save();
}

async function ghPollAll() {
  const repos = new Set(reposList());
  for (const x of [...db.tasks, ...db.requests]) if (x.github && x.github.repo) repos.add(x.github.repo);
  try {
    for (const repo of repos) await ghPollRepo(repo);
    pollState.lastAt = now();
    pollState.lastError = null;
  } catch (e) {
    pollState.lastError = e.message;
    throw e;
  }
}
const schedulePoll = () => ghQueue(ghPollAll);

// ───────────────────────── 라우팅 ─────────────────────────
function meta() {
  const mock = cfg.sso.mode === 'mock';
  return {
    ssoMode: cfg.sso.mode,
    ssoBaseUrl: mock ? '/mock-sso' : cfg.sso.baseUrl,
    mockUsers: mock
      ? cfg.mockUsers.map((m) => {
          const g = resolveGroups(m.permGroupIds);
          const roles = cfg.admins.includes(m.memberId) ? ['admin'] : db.roleOverrides[m.memberId] ? [db.roleOverrides[m.memberId]] : g ? g.ssoRoles : [];
          const names = roles.map((r) => (ROLES.find((x) => x.id === r) || {}).name).join(', ');
          return { memberId: m.memberId, memberName: m.memberName, label: g || roles.length ? `${g ? g.team : ''} · ${names}` : '권한그룹 없음 (접속 불가 확인용)' };
        })
      : [],
    enums: ENUMS,
    roles: ROLES,
    perms: PERMS,
    integrations: { github: githubEnabled(), slackChannel: !!cfg.slack.webhookUrl, slackDm: !!cfg.slack.botToken },
    boardShowsAllTeams: cfg.boardShowsAllTeams,
  };
}

function workPayload() {
  return {
    tasks: db.tasks.map(taskListItem),
    epics: db.epics,
    sprints: db.sprints,
    repos: reposList(),
    github: { enabled: githubEnabled(), pollSeconds: cfg.github.pollSeconds, lastPollAt: pollState.lastAt, lastPollError: pollState.lastError },
  };
}

async function handleApi(req, res, p) {
  const m = req.method;
  if (m !== 'GET' && m !== 'HEAD') checkCsrf(req);

  if (p === '/api/meta' && m === 'GET') return send(res, 200, meta());
  if (p === '/api/login' && m === 'POST') return handleLogin(req, res);
  if (p === '/api/logout' && m === 'POST') return handleLogout(req, res);

  const u = currentUser(req);
  if (!u) return send(res, 401, { message: '로그인이 필요해요.' });
  const body = m === 'GET' ? {} : await readJson(req);

  // ── 공통
  if (p === '/api/me' && m === 'GET') return send(res, 200, publicUser(u));
  if (p === '/api/users' && m === 'GET') return send(res, 200, Object.values(db.users).filter((x) => can(x, 'work.edit')).map(publicUser));

  // ── 요청
  if (p === '/api/requests' && m === 'GET') return send(res, 200, listFor(u));
  if (p === '/api/requests' && m === 'POST') return send(res, 201, detailFor(u, await createRequest(u, body)));
  let mm = p.match(/^\/api\/requests\/(\d+)(\/comments|\/github-sync)?$/);
  if (mm) {
    const r = db.requests.find((x) => x.id === Number(mm[1]));
    if (!r || !canView(u, r)) return send(res, 404, { message: '요청을 찾을 수 없거나 볼 권한이 없어요.' });
    const sub = mm[2];
    if (!sub && m === 'GET') return send(res, 200, detailFor(u, r));
    if (!sub && m === 'PATCH') { await updateRequest(u, r, body); return send(res, 200, detailFor(u, r)); }
    if (sub === '/comments' && m === 'POST') { await addRequestComment(u, r, body); return send(res, 201, detailFor(u, r)); }
    if (sub === '/github-sync' && m === 'POST') {
      need(u, 'request.triage');
      if (!githubEnabled()) throw httpError(400, 'GitHub 연동이 설정되지 않았어요.');
      if (r.github && r.github.error) r.github = null;
      await ghQueue(() => ghCreateRequestIssue(r));
      return send(res, 200, detailFor(u, r));
    }
  }

  // ── 작업 관리
  if (p === '/api/work' && m === 'GET') { need(u, 'work.view'); return send(res, 200, workPayload()); }
  if (p === '/api/tasks' && m === 'POST') { need(u, 'work.edit'); return send(res, 201, await createTask(u, body)); }
  mm = p.match(/^\/api\/tasks\/(\d+)(\/comments|\/github-sync)?$/);
  if (mm) {
    need(u, 'work.view');
    const t = db.tasks.find((x) => x.id === Number(mm[1]));
    if (!t) return send(res, 404, { message: '작업을 찾을 수 없어요. 삭제됐을 수 있어요.' });
    const sub = mm[2];
    if (!sub && m === 'GET') return send(res, 200, t);
    if (!sub && m === 'PATCH') { need(u, 'work.edit'); await updateTask(u, t, body); return send(res, 200, t); }
    if (!sub && m === 'DELETE') { need(u, 'work.plan'); await deleteTask(u, t); return send(res, 200, { ok: true }); }
    if (sub === '/comments' && m === 'POST') { await addTaskComment(u, t, body); return send(res, 201, t); }
    if (sub === '/github-sync' && m === 'POST') {
      need(u, 'work.edit');
      if (!githubEnabled()) throw httpError(400, 'GitHub 연동이 설정되지 않았어요.');
      if (t.github && t.github.error) t.github = null;
      await ghQueue(() => ghCreateTaskIssue(t));
      return send(res, 200, t);
    }
  }
  if (p === '/api/sprints' && m === 'POST') { need(u, 'work.plan'); return send(res, 201, await createSprint(u, body)); }
  mm = p.match(/^\/api\/sprints\/(\d+)(\/start|\/complete)?$/);
  if (mm) {
    need(u, 'work.plan');
    const s = db.sprints.find((x) => x.id === Number(mm[1]));
    if (!s) return send(res, 404, { message: '스프린트를 찾을 수 없어요.' });
    if (!mm[2] && m === 'PATCH') { await updateSprint(u, s, body); return send(res, 200, s); }
    if (mm[2] === '/start' && m === 'POST') { await startSprint(u, s); return send(res, 200, s); }
    if (mm[2] === '/complete' && m === 'POST') { await completeSprint(u, s, body); return send(res, 200, s); }
  }
  if (p === '/api/epics' && m === 'POST') { need(u, 'work.plan'); return send(res, 201, await createEpic(u, body)); }
  mm = p.match(/^\/api\/epics\/(\d+)$/);
  if (mm && m === 'PATCH') {
    need(u, 'work.plan');
    const e = db.epics.find((x) => x.id === Number(mm[1]));
    if (!e) return send(res, 404, { message: '에픽을 찾을 수 없어요.' });
    await updateEpic(u, e, body);
    return send(res, 200, e);
  }

  // ── 관리자
  if (p === '/api/notifications' && m === 'GET') { need(u, 'admin'); return send(res, 200, db.notifications.slice(0, 100)); }
  if (p === '/api/admin/users' && m === 'GET') { need(u, 'admin'); return send(res, 200, adminUsers()); }
  mm = p.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (mm && m === 'PATCH') {
    need(u, 'admin');
    const target = db.users[decodeURIComponent(mm[1])];
    if (!target) return send(res, 404, { message: '사용자를 찾을 수 없어요.' });
    await setUserRole(u, target, body);
    return send(res, 200, adminUsers());
  }
  if (p === '/api/admin/roles' && m === 'GET') { need(u, 'admin'); return send(res, 200, rolePermsTable()); }
  if (p === '/api/admin/roles' && m === 'PUT') { need(u, 'admin'); await setRolePerms(body); return send(res, 200, rolePermsTable()); }
  if (p === '/api/admin/github/poll' && m === 'POST') {
    need(u, 'admin');
    if (!githubEnabled()) throw httpError(400, 'GitHub 연동이 설정되지 않았어요.');
    await schedulePoll();
    return send(res, 200, { lastPollAt: pollState.lastAt, lastPollError: pollState.lastError });
  }

  return send(res, 404, { message: '없는 주소예요.' });
}

async function serveUpload(req, res, p) {
  const u = currentUser(req);
  const name = p.slice('/files/'.length);
  if (!u || !/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(name)) return send(res, 404, { message: '파일을 찾을 수 없어요.' });
  const owner = db.requests.find((r) => r.attachments.some((a) => a.file === name));
  if (!owner || !canView(u, owner)) return send(res, 404, { message: '파일을 찾을 수 없어요.' });
  try {
    const data = await fsp.readFile(path.join(UPLOAD_DIR, name));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)], 'Cache-Control': 'private, max-age=3600' });
    res.end(data);
  } catch {
    send(res, 404, { message: '파일을 찾을 수 없어요.' });
  }
}

async function serveStatic(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { message: 'Method Not Allowed' });
  let rel;
  try { rel = decodeURIComponent(p); } catch { return send(res, 400, { message: '잘못된 주소예요.' }); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { message: '없는 주소예요.' });
  try {
    const data = await fsp.readFile(file);
    const isFont = file.endsWith('.woff2');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': isFont ? 'public, max-age=604800' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, { message: '없는 주소예요.' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const p = new URL(req.url, 'http://localhost').pathname;
    if (p.startsWith('/mock-sso/')) {
      if (cfg.sso.mode !== 'mock' || req.method !== 'POST') return send(res, 404, { message: '없는 주소예요.' });
      const body = await readJson(req, 10000);
      if (p === '/mock-sso/api/auth/login') {
        const [status, data] = mockLogin(body);
        return send(res, status, data);
      }
      return send(res, 404, { message: '없는 주소예요.' });
    }
    if (p.startsWith('/api/')) return await handleApi(req, res, p);
    if (p.startsWith('/files/')) return await serveUpload(req, res, p);
    return await serveStatic(req, res, p);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { message: e.status ? e.message : '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' });
    else res.end();
  }
});

// ───────────────────────── 시작 ─────────────────────────
if (cfg.sso.mode === 'mock') {
  // 테스트 계정은 설정이 바뀌어도 바로 반영되도록 매번 다시 맞춰요 (로그인 기록은 유지)
  for (const m of cfg.mockUsers) upsertUser({ memberId: m.memberId, memberName: m.memberName, email: m.email, permGroupIds: m.permGroupIds }, { login: false });
  if (process.argv.includes('--seed') && !db.requests.length) require('./seed').run({ db, today });
  save();
}

server.listen(cfg.port, cfg.host, () => {
  console.log(`요청 창구 실행 중: ${cfg.baseUrl}  (포트 ${cfg.port})`);
  if (cfg.sso.mode === 'mock') console.warn('⚠️  테스트 로그인(mock) 모드예요. 사내 배포 전 config.json의 sso.mode를 "real"로 바꿔 주세요.');
  console.log(`GitHub 연동: ${githubEnabled() ? `켜짐 (${cfg.github.pollSeconds}초마다 동기화)` : '꺼짐'} / 슬랙 채널: ${cfg.slack.webhookUrl ? '켜짐' : '꺼짐'} / 슬랙 DM: ${cfg.slack.botToken ? '켜짐' : '꺼짐'}`);
  if (githubEnabled()) {
    setTimeout(schedulePoll, 3000);
    setInterval(schedulePoll, cfg.github.pollSeconds * 1000);
  }
});
