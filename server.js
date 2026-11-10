'use strict';
/**
 * 사내 요청 창구 — 서버 (MVP: 요청 접수 · 우선순위 회의 · 버전 관리 · 권한)
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

// 상태·유형·우선순위는 task-management 「티켓 관리 규칙 v2」의 보드 칸과 라벨을 따라요
const ENUMS = {
  platforms: ['앱', '바리스온', '키오스크', '기타'],
  types: ['버그', '신규 기능', '기능 개선', '운영 지원', '논의 필요'],
  typeHints: {
    '버그': '동작이 잘못됐어요',
    '신규 기능': '없던 기능이 필요해요',
    '기능 개선': '있는 기능을 바꾸거나 낫게 해 주세요',
    '운영 지원': '설정·데이터·문구 변경, 정리 같은 운영 업무예요',
    '논의 필요': '바로 진행하기 전에 함께 정해야 해요',
  },
  jobs: ['기획', '개발', '디자인'],
  levels: ['상', '중', '하'],
  statuses: ['접수', '백로그', '기획·디자인', '개발 대기', '개발', 'QA', '배포 대기', '완료', '보류', '반려'],
  priorities: ['P0', 'P1', 'P2', 'P3'], // 내부 값. 화면에는 priorityLabels만 보여요
  priorityLabels: { P0: '즉시 대응', P1: '높음', P2: '보통', P3: '낮음' },
  priorityHints: { P0: '하던 일을 멈추고 바로 처리해요', P1: '이번 스프린트 안에 해결해요', P2: '곧 해결해요', P3: '여유 있을 때 해요' },
  versionPlatforms: ['앱', '바리스온', '키오스크'],
  versionStatuses: ['계획', '개발 중', 'QA', '배포 대기', '배포 완료', '취소'],
};
const STATUS_NEEDS_REASON = new Set(['보류', '반려']);
// 담당자가 직접 옮길 수 있는 상태 (접수·보류·반려는 우선순위 회의 몫)
const ASSIGNEE_STATUSES = new Set(['백로그', '기획·디자인', '개발 대기', '개발', 'QA', '배포 대기', '완료']);
const DONE_STATUSES = new Set(['완료', '반려', '보류']);
// GitHub 라벨 (task-management 라벨 체계)
const GH_TYPE = { '버그': 'bug', '신규 기능': 'feature', '기능 개선': 'improvement', '운영 지원': 'chore', '논의 필요': 'discussion' };
const GH_PRIORITY = { P0: 'critical', P1: 'high', P2: 'medium', P3: 'low' };
const DEFAULT_PROJECT_LABELS = { '앱': 'project: Lounge(x) APP', '바리스온': 'project: BarisON', '키오스크': 'project: X KIOSK' };
const prioLabel = (p) => (p ? ENUMS.priorityLabels[p] : '미정');
const IMG_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// ───────────────────────── 권한 ─────────────────────────
const PERM_SCHEMA = 3; // 권한 항목이 바뀌면 올려서, 예전 권한 표를 기본값으로 되돌려요
const PERMS = [
  { key: 'request.viewAll', label: '모든 팀의 요청 보기' },
  { key: 'request.triage', label: '우선순위 회의 진행 (우선순위·담당자 지정, 보류·반려)' },
  { key: 'request.handle', label: '요청 처리 담당 (담당자 후보가 되고, 맡은 요청의 상태를 바꿔요)' },
  { key: 'version.manage', label: '버전 등록·수정, 요청 담기, 배포 완료 처리' },
  { key: 'admin', label: '권한 관리, 알림 기록' },
];
const PERM_KEYS = PERMS.map((p) => p.key);
const ROLES = [
  { id: 'admin', name: '관리자', desc: '모든 권한을 가져요.' },
  { id: 'lead', name: '리드', desc: '우선순위 회의를 진행하고 배포를 관리해요.' },
  { id: 'member', name: '작업자', desc: '기획·개발·디자인 실무자예요.' },
  { id: 'opsLead', name: '운영 리드', desc: '운영 쪽 대표로 우선순위 회의에 참여해요.' },
  { id: 'requester', name: '요청자', desc: '요청을 등록하고 자기 팀 요청을 봐요.' },
];
const ROLE_IDS = ROLES.map((r) => r.id);
const DEFAULT_ROLE_PERMS = {
  admin: PERM_KEYS,
  lead: ['request.viewAll', 'request.triage', 'request.handle', 'version.manage'],
  member: ['request.viewAll', 'request.handle', 'version.manage'],
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
  c.github.projectLabels = c.github.projectLabels || {};
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

// 화면에 찍히는 메시지를 data/server.log에도 남겨요 (창이 닫혀도 원인을 볼 수 있게)
const LOG_PATH = path.join(DATA_DIR, 'server.log');
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    const line = args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    try { fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${level.toUpperCase()} ${line}\n`); } catch { /* 기록 실패는 무시 */ }
  };
}
process.on('uncaughtException', (e) => { console.error('[치명적 오류]', e); process.exit(1); });

let db = {
  seq: 0, versionSeq: 0, requests: [], versions: [],
  users: {}, sessions: {}, notifications: [], roleOverrides: {}, rolePerms: null, permSchema: PERM_SCHEMA,
};
if (fs.existsSync(DB_PATH)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
if (db.permSchema !== PERM_SCHEMA) { db.rolePerms = null; db.permSchema = PERM_SCHEMA; }
// 예전 이름 → 새 규칙 이름 (여러 번 돌아도 결과가 같아요)
const RENAME = {
  status: { '진행 예정': '백로그', '진행 중': '개발' },
  type: { '버그·오류': '버그', '디자인': '기능 개선', '데이터·운영 지원': '운영 지원', '기타': '논의 필요' },
  platform: { '웹': '바리스온' },
};
for (const r of db.requests) {
  if (!Array.isArray(r.versionIds)) r.versionIds = [];
  r.status = RENAME.status[r.status] || r.status;
  r.type = RENAME.type[r.type] || r.type;
  r.platforms = r.platforms.map((p) => RENAME.platform[p] || p);
}
for (const v of db.versions || []) v.platform = RENAME.platform[v.platform] || v.platform;

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
function legacyRole(m) {
  if (m.scope === 'all') return m.triage ? 'lead' : 'member';
  return m.triage ? 'opsLead' : 'requester';
}

// 통합계정 권한그룹(permGroupIds) → 팀·직군·역할
function resolveGroups(groupIds) {
  const matched = (Array.isArray(groupIds) ? groupIds : [])
    .filter((g) => cfg.groupMap[g])
    .map((g) => ({ id: g, ...cfg.groupMap[g] }));
  if (!matched.length) return null;
  const roles = [...new Set(matched.map((m) => (ROLE_IDS.includes(m.role) ? m.role : legacyRole(m))))];
  const primary = matched.find((m) => m.job && m.job !== '운영') || matched[0];
  return {
    team: primary.team || '', job: primary.job || '',
    teams: [...new Set(matched.map((m) => m.team).filter(Boolean))],
    ssoRoles: roles, groups: matched.map((m) => m.id),
  };
}

function rolePermsTable() {
  const stored = db.rolePerms || {};
  const t = {};
  for (const r of ROLE_IDS) t[r] = r === 'admin' ? PERM_KEYS : pickList(stored[r] !== undefined ? stored[r] : DEFAULT_ROLE_PERMS[r], PERM_KEYS);
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
    memberId: info.memberId, name: info.memberName || info.memberId, email: info.email || '', photoUrl,
    team: '', job: '', teams: [], ssoRoles: [], groups: [],
    ...(g || {}),
    firstLoginAt: prev.firstLoginAt || (login ? now() : null),
    lastLoginAt: login ? now() : prev.lastLoginAt || null,
  };
  db.users[u.memberId] = u;
  return u;
}

const publicUser = (u) =>
  u && { memberId: u.memberId, name: u.name, team: u.team, teams: u.teams, job: u.job, photoUrl: u.photoUrl, roles: rolesOf(u), perms: [...permsOf(u)] };

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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tempToken }), signal: AbortSignal.timeout(10000),
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
  if (sid && db.sessions[sha(sid)]) { delete db.sessions[sha(sid)]; save(); }
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  send(res, 200, { ok: true });
}

// ───────────────────────── 요청 ─────────────────────────
// 숫자로 시작하는 버전은 v를 붙여 보여줘요 (2.3.1 → v2.3.1, 바리스온 월 단위 2026-11은 그대로)
const versionName = (s) => (/^\d+\.\d+/.test(s) ? 'v' + s : s);
const versionLabel = (v) => `${v.platform} ${versionName(v.version)}`;
const versionsOf = (r) => r.versionIds.map((id) => db.versions.find((v) => v.id === id)).filter(Boolean);
const versionBrief = (v) => ({ id: v.id, platform: v.platform, version: v.version, status: v.status, plannedDate: v.plannedDate, releasedDate: v.releasedDate });

function listItem(r) {
  const { timeline, ...rest } = r;
  return { ...rest, commentCount: timeline.filter((t) => t.type === 'comment').length, versions: versionsOf(r).map(versionBrief) };
}

// 다른 팀 요청: 보드에서 대기열만 보이도록 요약 정보만 전달
function summaryItem(r) {
  return {
    id: r.id, title: r.title, status: r.status, priority: r.priority, platforms: r.platforms, type: r.type, jobs: r.jobs,
    requesterTeam: r.requesterTeam, assignees: r.assignees, createdAt: r.createdAt, updatedAt: r.updatedAt,
    versions: versionsOf(r).map(versionBrief), restricted: true,
  };
}

function detailFor(u, r) {
  const triage = can(u, 'request.triage');
  const assignee = r.assignees.includes(u.memberId);
  return {
    ...r,
    versions: versionsOf(r).map(versionBrief),
    perms: { triage, status: triage || assignee, versions: triage || assignee || can(u, 'version.manage') },
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
    status: '접수', statusReason: '', priority: null, assignees: [], versionIds: [],
    github: null, createdAt: at, updatedAt: at,
    timeline: [{ type: 'created', at, by: who(u) }],
  };
  db.requests.push(r);
  await save();

  notify(subjReq(r), u, `🆕 새 요청이 접수됐어요 · ${r.platforms.join('/')} · ${r.type}\n요청: ${u.name} (${u.team}) · 긴급도 ${urgency} / 중요도 ${importance}`, { channel: true });
  ghQueue(() => ghCreateRequestIssue(r));
  return r;
}

// 요청에 담을 버전 검증: 존재 · 취소 아님 · 플랫폼당 하나
function parseVersionIds(r, ids) {
  if (!Array.isArray(ids)) throw httpError(400, '반영 버전 값이 올바르지 않아요.');
  const list = [...new Set(ids.map(Number))].map((id) => {
    const v = db.versions.find((x) => x.id === id);
    if (!v) throw httpError(400, '없는 버전이에요.');
    return v;
  });
  const seen = new Set();
  for (const v of list) {
    if (seen.has(v.platform)) throw httpError(400, `${v.platform} 버전은 하나만 고를 수 있어요.`);
    seen.add(v.platform);
    if (v.status === '취소' && !r.versionIds.includes(v.id)) throw httpError(400, `${versionLabel(v)}은(는) 취소된 버전이에요.`);
  }
  return list.map((v) => v.id);
}

async function updateRequest(u, r, b) {
  const triage = can(u, 'request.triage');
  const assignee = r.assignees.includes(u.memberId);
  const versionPerm = triage || assignee || can(u, 'version.manage');
  if (!triage && !assignee && !versionPerm) throw httpError(403, '이 요청을 변경할 권한이 없어요.');
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
    const a = Array.isArray(b.assignees) ? [...new Set(b.assignees.filter((id) => typeof id === 'string' && db.users[id] && can(db.users[id], 'request.handle')))] : [];
    if (!sameSet(a, r.assignees)) { triageOnly('담당자'); changes.push({ type: 'assignees', from: r.assignees, to: a }); }
  }
  if (b.versionIds !== undefined) {
    const ids = parseVersionIds(r, b.versionIds);
    if (!sameSet(ids, r.versionIds)) {
      if (!versionPerm) throw httpError(403, '반영 버전을 바꿀 권한이 없어요.');
      changes.push({ type: 'versions', from: r.versionIds, to: ids });
    }
  }
  let status = b.status;
  // 접수 상태에서 우선순위가 확정되면 자동으로 '백로그' (보드 규칙: 해야 할 일로 인지됨)
  if ((status === undefined || status === r.status) && r.status === '접수' && changes.some((c) => c.type === 'priority' && c.to)) status = '백로그';
  if (status !== undefined && status !== r.status) {
    if (!ENUMS.statuses.includes(status)) throw httpError(400, '상태 값이 올바르지 않아요.');
    if (!triage && !assignee) throw httpError(403, '상태를 바꿀 권한이 없어요.');
    if (!triage && !ASSIGNEE_STATUSES.has(status)) throw httpError(403, '보류·반려는 우선순위 회의 권한이 있어야 해요.');
    const reason = str(b.statusReason, 1000);
    if (STATUS_NEEDS_REASON.has(status) && !reason) throw httpError(400, `${status} 사유를 입력해 주세요.`);
    changes.push({ type: 'status', from: r.status, to: status, reason });
  }
  await applyRequestChanges(r, u, changes);
}

// 요청 변경 적용 + 기록 + 알림 + GitHub 반영 (사람·버전 배포 공통)
async function applyRequestChanges(r, actor, changes, { notifyText } = {}) {
  if (!changes.length) return;
  const at = now();
  for (const c of changes) {
    if (c.type === 'priority') r.priority = c.to;
    if (c.type === 'jobs') r.jobs = c.to;
    if (c.type === 'assignees') r.assignees = c.to;
    if (c.type === 'versions') r.versionIds = c.to;
    if (c.type === 'status') { r.status = c.to; r.statusReason = c.reason || ''; }
    const entry = { ...c, at, by: who(actor) };
    if (c.type === 'versions') { entry.from = c.from.map(labelOf); entry.to = c.to.map(labelOf); }
    r.timeline.push(entry);
  }
  r.updatedAt = at;
  await save();

  const lines = changes.map(describeChange);
  const added = (changes.find((c) => c.type === 'assignees') || { to: [] }).to;
  const notable = changes.some((c) => c.type === 'status' || c.type === 'priority');
  notify(subjReq(r), actor, notifyText || `${lines.join('\n')}\n(변경: ${actor.name})`, { channel: notable, dm: [r.requester.memberId, ...r.assignees, ...added] });
  ghQueue(() => ghSyncRequestUpdate(r, actor, changes, lines));
}

function labelOf(id) {
  const v = db.versions.find((x) => x.id === id);
  return v ? versionLabel(v) : String(id);
}

function describeChange(c) {
  switch (c.type) {
    case 'status': return `상태: ${c.from} → ${c.to}${c.reason ? ` (${c.reason})` : ''}`;
    case 'priority': return `우선순위: ${prioLabel(c.from)} → ${prioLabel(c.to)}`;
    case 'jobs': return `담당 직군: ${c.to.join(', ') || '미정'}`;
    case 'assignees': return `담당자: ${c.to.map(userName).join(', ') || '없음'}`;
    case 'versions': return `반영 버전: ${c.to.map(labelOf).join(', ') || '없음'}`;
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

// ───────────────────────── 버전 관리 ─────────────────────────
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.\-+_]{0,29}$/;
const requestsIn = (v) => db.requests.filter((r) => r.versionIds.includes(v.id));

function versionFor(u, v, { timeline = false } = {}) {
  const reqs = requestsIn(v).map((r) => {
    const base = { id: r.id, title: r.title, status: r.status, priority: r.priority, requesterTeam: r.requesterTeam, type: r.type };
    if (canView(u, r)) return { ...base, requester: r.requester.name };
    return cfg.boardShowsAllTeams ? { ...base, restricted: true } : null;
  }).filter(Boolean);
  const { timeline: tl, ...rest } = v;
  return { ...rest, requests: reqs, ...(timeline ? { timeline: tl } : {}) };
}

function checkVersionName(platform, version, exceptId) {
  if (!VERSION_RE.test(version)) throw httpError(400, '버전은 영문·숫자·점(.)·하이픈(-)으로 30자 안에서 적어 주세요. 예: 5.2.0');
  if (db.versions.some((x) => x.id !== exceptId && x.platform === platform && x.version === version)) throw httpError(400, `${platform} ${version}은(는) 이미 있어요.`);
}

async function createVersion(u, b) {
  const platform = ENUMS.versionPlatforms.includes(b.platform) ? b.platform : '';
  if (!platform) throw httpError(400, '플랫폼을 골라 주세요.');
  const version = str(b.version, 30).replace(/^v/i, '');
  checkVersionName(platform, version);
  const at = now();
  const v = {
    id: ++db.versionSeq, platform, version, status: ENUMS.versionStatuses.includes(b.status) && b.status !== '배포 완료' ? b.status : '계획',
    plannedDate: isDate(b.plannedDate) ? b.plannedDate : null, releasedDate: null, notes: str(b.notes, 5000),
    createdBy: who(u), createdAt: at, updatedAt: at, timeline: [{ type: 'created', at, by: who(u) }],
  };
  db.versions.push(v);
  await save();
  return v;
}

const VERSION_FIELD_LABEL = { version: '버전', status: '상태', plannedDate: '배포 예정일', releasedDate: '배포일', notes: '릴리스 노트' };

async function updateVersion(u, v, b) {
  const changes = [];
  if (b.version !== undefined) {
    const ver = str(b.version, 30).replace(/^v/i, '');
    if (ver !== v.version) { checkVersionName(v.platform, ver, v.id); changes.push({ field: 'version', from: v.version, to: ver }); }
  }
  if (b.status !== undefined && b.status !== v.status) {
    if (!ENUMS.versionStatuses.includes(b.status)) throw httpError(400, '버전 상태 값이 올바르지 않아요.');
    changes.push({ field: 'status', from: v.status, to: b.status });
  }
  if (b.plannedDate !== undefined) {
    const d = isDate(b.plannedDate) ? b.plannedDate : null;
    if (d !== v.plannedDate) changes.push({ field: 'plannedDate', from: v.plannedDate, to: d });
  }
  if (b.releasedDate !== undefined) {
    const d = isDate(b.releasedDate) ? b.releasedDate : null;
    if (d !== v.releasedDate) changes.push({ field: 'releasedDate', from: v.releasedDate, to: d });
  }
  if (b.notes !== undefined) {
    const n = str(b.notes, 5000);
    if (n !== v.notes) changes.push({ field: 'notes', from: '', to: '' });
    v._nextNotes = n;
  }
  const releasing = changes.some((c) => c.field === 'status' && c.to === '배포 완료');
  if (releasing && !v.releasedDate && !changes.some((c) => c.field === 'releasedDate')) changes.push({ field: 'releasedDate', from: null, to: today() });
  if (!changes.length) { delete v._nextNotes; return; }

  const at = now();
  for (const c of changes) {
    if (c.field === 'notes') v.notes = v._nextNotes;
    else v[c.field] = c.to;
    v.timeline.push({ type: 'field', field: c.field, label: VERSION_FIELD_LABEL[c.field], from: c.field === 'notes' ? '' : c.from || '없음', to: c.field === 'notes' ? '수정' : c.to || '없음', at, by: who(u) });
  }
  delete v._nextNotes;
  v.updatedAt = at;
  await save();

  const st = changes.find((c) => c.field === 'status');
  if (st && !releasing) {
    notify(subjVer(v), u, `버전 상태: ${st.from} → ${st.to} (변경: ${u.name})`, { channel: true });
    await followVersion(v, u, st.to);
  }
  if (releasing) await releaseVersion(v, u);
}

// 버전이 QA·배포 대기로 가면 담긴 요청도 같은 칸으로 (보드 규칙: develop 머지 → QA, release 머지 → 배포 대기)
const VERSION_ORDER = ['계획', '개발 중', 'QA', '배포 대기', '배포 완료'];
const FOLLOW = { 'QA': { to: 'QA', from: ['개발 대기', '개발'] }, '배포 대기': { to: '배포 대기', from: ['개발 대기', '개발', 'QA'] } };
async function followVersion(v, u, vStatus) {
  const rule = FOLLOW[vStatus];
  if (!rule) return;
  for (const r of requestsIn(v)) {
    if (!rule.from.includes(r.status)) continue;
    // 여러 플랫폼에 걸친 요청은 모든 버전이 그 단계 이상일 때만 옮겨요
    const ready = versionsOf(r).every((x) => VERSION_ORDER.indexOf(x.status) >= VERSION_ORDER.indexOf(vStatus));
    if (!ready) continue;
    await applyRequestChanges(r, u, [{ type: 'status', from: r.status, to: rule.to, reason: `${versionLabel(v)} ${vStatus}` }]);
  }
}

// 배포 완료: 담긴 요청을 완료 처리하고 요청자에게 알림
async function releaseVersion(v, u) {
  const label = versionLabel(v);
  const reqs = requestsIn(v);
  notify(subjVer(v), u, `📦 ${label} 배포 완료 · 담긴 요청 ${reqs.length}건\n${reqs.map((r) => `- REQ-${r.id} ${r.title}`).join('\n')}`.trim(), { channel: true });
  for (const r of reqs) {
    const allShipped = versionsOf(r).every((x) => x.status === '배포 완료');
    const text = `📦 요청하신 내용이 ${label}에 반영돼 배포됐어요.`;
    if (allShipped && !DONE_STATUSES.has(r.status)) {
      await applyRequestChanges(r, u, [{ type: 'status', from: r.status, to: '완료', reason: `${label} 배포` }], { notifyText: text });
    } else {
      r.timeline.push({ type: 'released', at: now(), by: who(u), text: label });
      r.updatedAt = now();
      await save();
      notify(subjReq(r), u, allShipped ? text : `${text} (다른 플랫폼 배포는 아직 남아 있어요)`, { channel: false, dm: [r.requester.memberId] });
    }
  }
}

async function setVersionRequest(u, v, b) {
  const add = b.add !== undefined ? Number(b.add) : null;
  const remove = b.remove !== undefined ? Number(b.remove) : null;
  const r = db.requests.find((x) => x.id === (add ?? remove));
  if (!r) throw httpError(404, '요청을 찾을 수 없어요.');
  let ids;
  if (add !== null) {
    if (r.versionIds.includes(v.id)) return;
    if (v.status === '취소') throw httpError(400, '취소된 버전에는 요청을 담을 수 없어요.');
    if (!r.platforms.includes(v.platform)) throw httpError(400, `이 요청은 ${v.platform} 대상이 아니에요.`);
    // 같은 플랫폼의 다른 버전에 담겨 있으면 이 버전으로 옮겨요
    ids = [...r.versionIds.filter((id) => (db.versions.find((x) => x.id === id) || {}).platform !== v.platform), v.id];
  } else {
    if (!r.versionIds.includes(v.id)) return;
    ids = r.versionIds.filter((id) => id !== v.id);
  }
  await applyRequestChanges(r, u, [{ type: 'versions', from: r.versionIds, to: ids }]);
}

// ───────────────────────── 관리자 ─────────────────────────
function adminUsers() {
  return Object.values(db.users)
    .map((u) => ({
      memberId: u.memberId, name: u.name, team: u.team, job: u.job, groups: u.groups || [], ssoRoles: u.ssoRoles || [],
      override: db.roleOverrides[u.memberId] || null, roles: rolesOf(u), configAdmin: cfg.admins.includes(u.memberId), lastLoginAt: u.lastLoginAt,
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
  const current = rolePermsTable();
  const next = {};
  for (const r of ROLE_IDS) {
    if (r === 'admin') continue;
    next[r] = pickList(input[r] !== undefined ? input[r] : current[r], PERM_KEYS).filter((p) => p !== 'admin');
  }
  db.rolePerms = next;
  await save();
}

// ───────────────────────── 알림 (슬랙) ─────────────────────────
const subjReq = (r) => ({ ref: `REQ-${r.id}`, title: r.title, link: `#/r/${r.id}` });
const subjVer = (v) => ({ ref: versionLabel(v), title: `${versionLabel(v)} 버전`, link: `#/v/${v.id}` });
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
    headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(10000),
  }).then((x) => x.json());
  if (!lookup.ok) throw new Error(lookup.error);
  await slackPost('https://slack.com/api/chat.postMessage', { channel: lookup.user.id, text }, t);
}

// 모든 알림은 '알림 기록'에 남고, 슬랙이 설정돼 있으면 실제로 전송
async function notify(subj, actor, text, { channel = true, dm = [] } = {}) {
  try {
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
  } catch (e) {
    console.error('[알림]', e);
  }
}

// ───────────────────────── GitHub (요청 → 이슈) ─────────────────────────
const GH_MARKER = '<!-- request-hub -->';
const githubRepos = () => [...new Set([cfg.github.defaultRepo, ...Object.values(cfg.github.repoByPlatform)].filter(Boolean))];
const githubEnabled = () => !!(cfg.github.token && githubRepos().length);

let ghChain = Promise.resolve();
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
      Authorization: `Bearer ${cfg.github.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'internal-request-hub', 'Content-Type': 'application/json',
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

const ghComment = (g, body) => gh('POST', `/repos/${g.repo}/issues/${g.number}/comments`, { body: `${body}\n\n${GH_MARKER}` });

function repoFor(r) {
  const byP = cfg.github.repoByPlatform;
  if (r.platforms.length === 1 && byP[r.platforms[0]]) return byP[r.platforms[0]];
  return cfg.github.defaultRepo || githubRepos()[0] || '';
}

const cell = (s) => String(s || '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// task-management 라벨 체계: project: + type: (+ 우선순위가 정해지면 priority:)
function ghLabels(r) {
  const projects = r.platforms.map((p) => cfg.github.projectLabels[p] || DEFAULT_PROJECT_LABELS[p]).filter(Boolean);
  return [...new Set(projects), ...(GH_TYPE[r.type] ? [`type: ${GH_TYPE[r.type]}`] : []), ...(r.priority ? [`priority: ${GH_PRIORITY[r.priority]}`] : [])];
}

function requestIssueBody(r) {
  return [
    `> 사내 요청 창구에서 자동으로 만든 이슈예요. 요청 원문·첨부·진행 기록: ${cfg.baseUrl}/#/r/${r.id}`,
    '',
    '| 항목 | 내용 |',
    '|---|---|',
    `| 요청자 | ${cell(`${r.requester.name} (${r.requesterTeam})`)} |`,
    `| 플랫폼 | ${cell(r.platforms.join(', '))} |`,
    `| 유형 | ${cell(r.type)} |`,
    `| 우선순위 | ${cell(prioLabel(r.priority))} |`,
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
  const payload = { title: `[REQ-${r.id}] ${r.title}`, body: requestIssueBody(r), labels: ghLabels(r) };
  try {
    let issue;
    try { issue = await gh('POST', `/repos/${repo}/issues`, payload); }
    catch (e) {
      if (e.status !== 422) throw e;
      const { labels, ...rest } = payload; // 라벨 권한이 없으면 라벨 없이 다시 시도
      issue = await gh('POST', `/repos/${repo}/issues`, rest);
    }
    r.github = { repo, number: issue.number, url: issue.html_url };
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
    if (p.from) await gh('DELETE', `${base}/labels/${encodeURIComponent('priority: ' + GH_PRIORITY[p.from])}`).catch(() => {});
    if (p.to) await gh('POST', `${base}/labels`, { labels: [`priority: ${GH_PRIORITY[p.to]}`] }).catch((e) => console.error('[GitHub] 라벨:', e.message));
  }
  const s = changes.find((c) => c.type === 'status');
  if (s) {
    if (s.to === '완료') await gh('PATCH', base, { state: 'closed', state_reason: 'completed' });
    else if (s.to === '반려') await gh('PATCH', base, { state: 'closed', state_reason: 'not_planned' });
    else if (s.from === '완료' || s.from === '반려') await gh('PATCH', base, { state: 'open' });
  }
}

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
          return { memberId: m.memberId, memberName: m.memberName, label: roles.length ? `${g ? g.team : ''} · ${names}` : '권한그룹 없음 (접속 불가 확인용)' };
        })
      : [],
    enums: ENUMS, roles: ROLES, perms: PERMS,
    integrations: { github: githubEnabled(), slackChannel: !!cfg.slack.webhookUrl, slackDm: !!cfg.slack.botToken },
    boardShowsAllTeams: cfg.boardShowsAllTeams,
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

  if (p === '/api/me' && m === 'GET') return send(res, 200, publicUser(u));
  if (p === '/api/users' && m === 'GET') return send(res, 200, Object.values(db.users).filter((x) => can(x, 'request.handle')).map(publicUser));

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

  // ── 버전
  if (p === '/api/versions' && m === 'GET') return send(res, 200, db.versions.map((v) => versionFor(u, v)));
  if (p === '/api/versions' && m === 'POST') { need(u, 'version.manage'); return send(res, 201, versionFor(u, await createVersion(u, body), { timeline: true })); }
  mm = p.match(/^\/api\/versions\/(\d+)(\/requests)?$/);
  if (mm) {
    const v = db.versions.find((x) => x.id === Number(mm[1]));
    if (!v) return send(res, 404, { message: '버전을 찾을 수 없어요.' });
    if (!mm[2] && m === 'GET') return send(res, 200, versionFor(u, v, { timeline: true }));
    if (!mm[2] && m === 'PATCH') { need(u, 'version.manage'); await updateVersion(u, v, body); return send(res, 200, versionFor(u, v, { timeline: true })); }
    if (mm[2] && m === 'POST') { need(u, 'version.manage'); await setVersionRequest(u, v, body); return send(res, 200, versionFor(u, v, { timeline: true })); }
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

// 예상 못 한 오류로 서버 전체가 꺼지지 않도록 기록만 남겨요
process.on('unhandledRejection', (e) => console.error('[처리되지 않은 오류]', e));

// ───────────────────────── 시작 ─────────────────────────
if (cfg.sso.mode === 'mock') {
  // 테스트 계정은 설정이 바뀌어도 바로 반영되도록 매번 다시 맞춰요 (로그인 기록은 유지)
  for (const m of cfg.mockUsers) upsertUser({ memberId: m.memberId, memberName: m.memberName, email: m.email, permGroupIds: m.permGroupIds }, { login: false });
  if (process.argv.includes('--seed') && !db.requests.length) require('./seed').run({ db, today });
  save();
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n❌ ${cfg.port}번 포트를 이미 다른 프로그램(아마 다른 요청 창구 서버)이 쓰고 있어요. 그 창을 닫거나 PORT를 바꿔서 실행해 주세요.\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`요청 창구 실행 중: ${cfg.baseUrl}  (포트 ${cfg.port})`);
  if (cfg.sso.mode === 'mock') console.warn('⚠️  테스트 로그인(mock) 모드예요. 사내 배포 전 config.json의 sso.mode를 "real"로 바꿔 주세요.');
  console.log(`GitHub 연동: ${githubEnabled() ? '켜짐' : '꺼짐'} / 슬랙 채널: ${cfg.slack.webhookUrl ? '켜짐' : '꺼짐'} / 슬랙 DM: ${cfg.slack.botToken ? '켜짐' : '꺼짐'}`);
});
