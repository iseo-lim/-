'use strict';
/* 관리자: 사람별 역할 · 역할별 권한 · 연동 상태 */

let adminTab = 'users';

async function viewAdmin(main) {
  const tabs = [['users', '사람별 역할'], ['roles', '역할별 권한'], ['integrations', '연동']];
  main.innerHTML = `
    <div class="page-head"><div><div class="crumb">기타 / 권한 관리</div><h1>권한 관리</h1>
      <p>기본 역할은 통합계정 권한그룹으로 정해져요. 여기서 사람마다 역할을 바꾸거나, 역할별로 할 수 있는 일을 조정할 수 있어요.</p></div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${k === adminTab ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="admin-body"><div class="empty">불러오는 중…</div></div>`;
  $$('[data-tab]', main).forEach((b) => (b.onclick = () => { adminTab = b.dataset.tab; viewAdmin(main); }));
  const el = $('#admin-body');
  try {
    if (adminTab === 'users') renderAdminUsers(el, await api('GET', '/api/admin/users'));
    else if (adminTab === 'roles') renderAdminRoles(el, await api('GET', '/api/admin/roles'));
    else renderAdminIntegrations(el);
  } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

const roleNameOf = (id) => (S.meta.roles.find((r) => r.id === id) || {}).name || id;

function renderAdminUsers(el, users) {
  el.innerHTML = `
    <div class="note">한 번 이상 로그인한 사람만 보여요. '통합계정 기본값'으로 두면 권한그룹이 바뀔 때 역할도 따라 바뀌어요.</div>
    <div class="table-wrap"><table class="list" style="min-width:820px">
      <thead><tr><th>이름</th><th>팀 · 직군</th><th>통합계정 권한그룹</th><th>역할</th><th>마지막 로그인</th></tr></thead>
      <tbody>${users.map((u) => {
        const self = u.memberId === S.me.memberId;
        const locked = u.configAdmin || self;
        const def = `통합계정 기본값 (${(u.ssoRoles.length ? u.ssoRoles : ['requester']).map(roleNameOf).join(', ')})`;
        return `<tr style="cursor:default">
          <td><b>${esc(u.name)}</b> <span class="mono muted" style="font-size:11.5px">${esc(u.memberId)}</span></td>
          <td>${esc(u.team || '-')} · ${esc(u.job || '-')}</td>
          <td>${u.groups.length ? u.groups.map((g) => `<span class="key" style="margin-right:4px">${esc(g)}</span>`).join('') : '<span class="muted">-</span>'}</td>
          <td>${locked ? `<span class="tag">${esc(u.roles.map(roleNameOf).join(', '))}</span> <small class="muted">${u.configAdmin ? '설정 파일에서 지정' : '내 역할은 바꿀 수 없어요'}</small>`
            : `<select class="select sm" data-user="${esc(u.memberId)}" aria-label="${esc(u.name)} 역할">
                <option value="">${esc(def)}</option>
                ${S.meta.roles.map((r) => `<option value="${r.id}" ${u.override === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
              </select>`}</td>
          <td class="mono muted" style="font-size:12px">${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '아직 없음'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  $$('[data-user]', el).forEach((sel) => (sel.onchange = async () => {
    try {
      const list = await api('PATCH', `/api/admin/users/${encodeURIComponent(sel.dataset.user)}`, { role: sel.value || null });
      toast('역할을 바꿨어요. 다음 화면 이동부터 적용돼요.');
      renderAdminUsers(el, list);
    } catch (e) { toast(e.message, true); }
  }));
}

function renderAdminRoles(el, table) {
  const roles = S.meta.roles;
  el.innerHTML = `
    <div class="role-desc">${roles.map((r) => `<div class="panel"><b>${esc(r.name)}</b><small>${esc(r.desc)}</small></div>`).join('')}</div>
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>할 수 있는 일</th>${roles.map((r) => `<th>${esc(r.name)}${r.id === 'admin' ? '<small>항상 전부</small>' : ''}</th>`).join('')}</tr></thead>
      <tbody>${S.meta.perms.map((p) => `<tr><td>${esc(p.label)}</td>${roles.map((r) => {
        const on = (table[r.id] || []).includes(p.key);
        const lock = r.id === 'admin' || p.key === 'admin';
        return `<td><input type="checkbox" data-role="${r.id}" data-perm="${p.key}" ${on ? 'checked' : ''} ${lock ? 'disabled' : ''} aria-label="${esc(r.name)} · ${esc(p.label)}"></td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="hint" style="margin:10px 2px">모든 사람은 요청 등록, 자기 팀 요청 보기, 댓글 쓰기를 할 수 있어요. 관리자 권한은 관리자 역할에만 있어요.</p>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" id="roles-reset">되돌리기</button><button class="btn primary" id="roles-save">권한 저장</button></div>`;
  $('#roles-reset').onclick = () => renderAdminRoles(el, table);
  $('#roles-save').onclick = async () => {
    const next = {};
    roles.forEach((r) => (next[r.id] = $$(`input[data-role="${r.id}"]:checked`, el).map((i) => i.dataset.perm)));
    try {
      const saved = await api('PUT', '/api/admin/roles', { rolePerms: next });
      toast('역할별 권한을 저장했어요.');
      renderAdminRoles(el, saved);
      refreshSafe();
    } catch (e) { toast(e.message, true); }
  };
}

function renderAdminIntegrations(el) {
  const I = S.meta.integrations;
  const on = (x) => (x ? '<span class="on">연결됨</span>' : '<span class="off">미설정</span>');
  el.innerHTML = `<div class="integr">
    <div class="panel"><h3>GitHub ${on(I.github)}</h3>
      <p class="hint">요청이 접수되면 이슈를 만들고, 우선순위·상태가 바뀌면 댓글과 라벨로 남겨요. 완료·반려되면 이슈를 닫아요.</p>
      ${I.github ? '' : '<p class="hint">설정 방법은 README의 \'GitHub 연동\'을 참고해 주세요.</p>'}</div>
    <div class="panel"><h3>슬랙 채널 ${on(I.slackChannel)}</h3><p class="hint">새 요청, 상태·우선순위 변경, 버전 배포를 채널에 올려요.</p></div>
    <div class="panel"><h3>슬랙 DM ${on(I.slackDm)}</h3><p class="hint">요청자·담당자에게 개인 메시지로 알려요. 요청이 담긴 버전이 배포되면 요청자에게도 알려요.</p></div>
  </div>`;
}
