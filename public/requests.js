'use strict';
/* 요청: 요청 보드 · 요청 목록 · 우선순위 회의 · 요청 등록 · 요청 상세 · 버전 · 알림 기록 */

// ───────────────────────── 요청 보드 ─────────────────────────
function requestCard(r) {
  const inner = `<div class="top"><span class="key">REQ-${r.id}</span>${prioBadge(r.priority)}${r.restricted ? '<span class="lock">다른 팀 요청</span>' : ''}</div>
    <div class="title">${esc(r.title)}</div>
    <div class="meta">${tags(r.platforms)}<span class="tag">${esc(r.type)}</span>${versionTags(r.versions)}</div>
    <div class="foot"><span>${esc(r.requesterTeam)}</span><span>${r.assignees && r.assignees.length ? esc(names(r.assignees)) : ago(r.createdAt)}</span></div>`;
  return r.restricted
    ? `<div class="card restricted" title="다른 팀 요청이라 상세 내용은 볼 수 없어요">${inner}</div>`
    : `<a class="card" href="#/r/${r.id}">${inner}</a>`;
}

function viewBoard(main) {
  const f = S.board, E = S.meta.enums;
  const items = S.requests.filter((r) =>
    (!f.platform || r.platforms.includes(f.platform)) && (!f.job || r.jobs.includes(f.job)) && (!f.mine || (r.assignees || []).includes(S.me.memberId)));
  // 회사 보드(task-management) 칸 순서 그대로 + 접수
  const cols = ['접수', '백로그', '기획·디자인', '개발 대기', '개발', 'QA', '배포 대기', '완료', ...(f.showClosed ? ['보류', '반려'] : [])];
  const cutoff = Date.now() - 30 * 86400000;
  const teamOnly = !has('request.viewAll') && !has('request.triage');
  main.innerHTML = `
    <div class="page-head">
      <div><div class="crumb">요청 / 보드</div><h1>요청 보드</h1>
        <p>들어온 요청이 지금 어느 단계에 있는지 봐요.${teamOnly && S.meta.boardShowsAllTeams ? ' 다른 팀 요청은 제목과 상태만 보여요.' : ''}</p></div>
      <div class="toolbar">
        ${selectHtml('board.platform', '플랫폼 전체', E.platforms, f.platform)}
        ${selectHtml('board.job', '직군 전체', E.jobs, f.job)}
        ${has('request.handle') ? toggleHtml('board.mine', '내 담당만', f.mine) : ''}
        ${toggleHtml('board.showClosed', '보류·반려 보기', f.showClosed)}
      </div>
    </div>
    <div class="board">${cols.map((st) => {
      let list = items.filter((r) => r.status === st);
      if (st === '완료') list = list.filter((r) => new Date(r.updatedAt).getTime() >= cutoff).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      else list.sort(byPriority);
      return `<section class="col"><header>${statusBadge(st)}<span class="n">${list.length}</span>${st === '완료' ? '<span class="sub">최근 30일</span>' : ''}</header>
        <div class="cards">${list.map(requestCard).join('') || '<div class="empty" style="padding:22px 8px">없음</div>'}</div></section>`;
    }).join('')}</div>`;
  bindFilters(main, () => viewBoard(main));
}

// ───────────────────────── 요청 목록 ─────────────────────────
function viewList(main) {
  const f = S.list, E = S.meta.enums;
  const all = has('request.viewAll') || has('request.triage');
  const teams = [...new Set(S.requests.filter((r) => !r.restricted).map((r) => r.requesterTeam))].sort();
  main.innerHTML = `
    <div class="page-head">
      <div><div class="crumb">요청 / 목록</div><h1>요청 목록</h1>
        <p>${all ? '모든 팀의 요청을 볼 수 있어요.' : `${esc(S.me.teams.join(', ') || '내 팀')} 요청과 내가 등록한 요청만 보여요.`}</p></div>
      <a class="btn primary" href="#/new">+ 요청 등록</a>
    </div>
    <div class="filters">
      <input class="input search" type="search" placeholder="제목·내용·번호 검색" data-f="list.q" value="${esc(f.q)}" aria-label="검색">
      <select class="select sm" data-f="list.status" aria-label="상태">
        <option value="open" ${f.status === 'open' ? 'selected' : ''}>끝나지 않은 요청</option>
        <option value="all" ${f.status === 'all' ? 'selected' : ''}>모든 상태</option>
        ${E.statuses.map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      ${selectHtml('list.priority', '우선순위 전체', [...E.priorities.map((p) => [p, PRIO_LABEL[p]]), ['미정', '미정']], f.priority)}
      ${selectHtml('list.platform', '플랫폼 전체', E.platforms, f.platform)}
      ${selectHtml('list.job', '직군 전체', E.jobs, f.job)}
      ${all ? selectHtml('list.team', '요청 팀 전체', teams, f.team) : ''}
      <span class="spacer"></span>
      ${has('request.handle') ? toggleHtml('list.mine', '내 담당', f.mine) : ''}
      ${toggleHtml('list.requested', '내가 등록한 것', f.requested)}
    </div>
    <div id="list-results"></div>`;
  bindFilters(main, renderListResults);
  renderListResults();
}

function filteredList() {
  const f = S.list, q = f.q.trim().toLowerCase();
  return S.requests
    .filter((r) => !r.restricted)
    .filter((r) => (f.status === 'all' ? true : f.status === 'open' ? OPEN_STATUSES.includes(r.status) : r.status === f.status))
    .filter((r) => !f.priority || (f.priority === '미정' ? !r.priority : r.priority === f.priority))
    .filter((r) => !f.platform || r.platforms.includes(f.platform))
    .filter((r) => !f.job || r.jobs.includes(f.job))
    .filter((r) => !f.team || r.requesterTeam === f.team)
    .filter((r) => !f.mine || r.assignees.includes(S.me.memberId))
    .filter((r) => !f.requested || r.requester.memberId === S.me.memberId)
    .filter((r) => !q || `req-${r.id} #${r.id} ${r.title} ${r.description}`.toLowerCase().includes(q))
    .sort(byPriority);
}

function renderListResults() {
  const el = $('#list-results');
  if (!el) return;
  const rows = filteredList();
  if (!rows.length) { el.innerHTML = '<div class="table-wrap"><div class="empty">조건에 맞는 요청이 없어요. 필터를 바꿔 보세요.</div></div>'; return; }
  el.innerHTML = `<div class="result-count">${rows.length}건 · 우선순위 높은 순</div>
  <div class="table-wrap"><table class="list">
    <thead><tr><th>번호</th><th>우선순위</th><th>제목</th><th>유형</th><th>직군</th><th>요청</th><th>담당자</th><th>반영 버전</th><th>상태</th><th>희망일</th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-id="${r.id}" tabindex="0">
      <td class="nowrap"><span class="key">REQ-${r.id}</span></td>
      <td>${prioBadge(r.priority)}</td>
      <td class="t-title">${esc(r.title)}<div class="chips-inline">${tags(r.platforms)}${r.commentCount ? `<span class="tag">💬 ${r.commentCount}</span>` : ''}</div></td>
      <td class="nowrap">${esc(r.type)}</td>
      <td class="nowrap">${esc(r.jobs.join(', ') || '미정')}</td>
      <td class="nowrap">${esc(r.requester.name)}<br><small class="muted">${esc(r.requesterTeam)}</small></td>
      <td>${esc(names(r.assignees) || '-')}</td>
      <td class="nowrap">${versionTags(r.versions) || '<span class="muted">-</span>'}</td>
      <td class="nowrap">${statusBadge(r.status)}</td>
      <td class="nowrap">${r.dueDate ? `<span class="mono" style="font-size:12px">${fmtDay(r.dueDate)}</span><br><small class="muted">${dueText(r.dueDate)}</small>` : '-'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
  $$('tr[data-id]', el).forEach((tr) => {
    tr.onclick = () => (location.hash = '#/r/' + tr.dataset.id);
    tr.onkeydown = (e) => { if (e.key === 'Enter') tr.click(); };
  });
}

// ───────────────────────── 우선순위 회의 ─────────────────────────
function triCard(r) {
  const E = S.meta.enums;
  const primary = r.status === '접수' ? '우선순위 확정' : r.status === '보류' ? '다시 진행 (백로그로)' : '변경 저장';
  return `<article class="tri panel" data-id="${r.id}">
    <div class="info">
      <div class="head"><span class="key">REQ-${r.id}</span>${statusBadge(r.status)}${tags(r.platforms)}<span class="tag">${esc(r.type)}</span>
        <span class="muted" style="margin-left:auto;font-size:12.5px">${esc(r.requester.name)} · ${esc(r.requesterTeam)} · ${ago(r.createdAt)}</span></div>
      <h3><a href="#/r/${r.id}">${esc(r.title)}</a></h3>
      <p class="desc">${esc(r.description)}</p>
      ${r.status === '보류' && r.statusReason ? `<div class="callout st-보류" style="margin-bottom:10px"><b>보류 사유</b> ${esc(r.statusReason)}</div>` : ''}
      <div class="reasons">
        <div class="reason"><div class="rh">긴급도 ${lvBadge(r.urgency)}</div><p>${esc(r.urgencyReason)}</p></div>
        <div class="reason"><div class="rh">중요도 ${lvBadge(r.importance)}</div><p>${esc(r.importanceReason)}</p></div>
      </div>
      ${r.dueDate ? `<p class="muted" style="margin-top:10px;font-size:12.5px">희망 완료일 <span class="mono">${fmtDay(r.dueDate)}</span> (${dueText(r.dueDate)})</p>` : ''}
    </div>
    <div class="ctrl">
      <div class="field"><span class="label">우선순위</span><div class="chips">${E.priorities.map((p) =>
        `<label class="chip p-${p}"><input type="radio" name="prio-${r.id}" value="${p}" ${r.priority === p ? 'checked' : ''}><span>${PRIO_LABEL[p]}</span></label>`).join('')}</div></div>
      <div class="field"><span class="label">담당 직군</span><div class="chips">${chipGroup('jobs', E.jobs, 'checkbox', '', r.jobs)}</div></div>
      <div class="field"><span class="label">담당자</span>${assigneePicker(r.assignees)}</div>
      <div class="reason-box"><span class="label rb-label"></span><textarea class="textarea" name="reason" rows="2" maxlength="1000"></textarea>
        <div class="row"><button class="btn sm primary" data-act="reason-ok">확인</button><button class="btn sm ghost" data-act="reason-cancel">취소</button></div></div>
      <div class="actions"><button class="btn primary" data-act="save">${primary}</button>${r.status !== '보류' ? '<button class="btn" data-act="hold">보류</button>' : ''}<button class="btn danger" data-act="reject">반려</button></div>
    </div>
  </article>`;
}

function viewTriage(main) {
  const tabs = [['접수', '새로 들어온 요청'], ['백로그', '백로그 다시 보기'], ['보류', '보류']];
  const tab = S.triageTab;
  const visible = S.requests.filter((r) => !r.restricted);
  const items = visible.filter((r) => r.status === tab).sort(tab === '접수' ? (a, b) => new Date(a.createdAt) - new Date(b.createdAt) : byPriority);
  main.innerHTML = `
    <div class="page-head"><div><div class="crumb">요청 / 우선순위 회의</div><h1>우선순위 회의</h1>
      <p>요청자가 적은 긴급도·중요도와 그 이유를 보고, 기획·개발·디자인·운영이 함께 우선순위를 정해요.</p></div></div>
    <div class="legend-row">${S.meta.enums.priorities.map((p) => `<span>${prioBadge(p)} ${esc(S.meta.enums.priorityHints[p])}</span>`).join('')}</div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}<span class="n">${visible.filter((r) => r.status === k).length}</span></button>`).join('')}</div>
    ${tab === '접수' ? '<div class="note">우선순위를 고르고 <b>우선순위 확정</b>을 누르면 \'백로그\'로 넘어가요. 요청자와 담당자에게 슬랙 알림이 가요.</div>' : ''}
    <div class="tri-list">${items.map(triCard).join('') || `<div class="empty">${tab === '접수' ? '새로 들어온 요청이 없어요.' : '해당하는 요청이 없어요.'}</div>`}</div>`;

  $$('[data-tab]', main).forEach((b) => (b.onclick = () => { S.triageTab = b.dataset.tab; viewTriage(main); }));
  $$('.tri', main).forEach((el) => {
    const id = Number(el.dataset.id);
    const r = S.requests.find((x) => x.id === id);
    const box = $('.reason-box', el);
    let pending = null;
    const collect = () => ({
      priority: ($(`input[name="prio-${id}"]:checked`, el) || {}).value || null,
      jobs: $$('input[name="jobs"]:checked', el).map((i) => i.value),
      assignees: pickerValue(el),
    });
    const submit = async (body, msg) => {
      $$('button', el).forEach((b) => (b.disabled = true));
      try {
        await api('PATCH', `/api/requests/${id}`, body);
        toast(msg);
        await refresh();
        viewTriage(main);
      } catch (e) {
        toast(e.message, true);
        $$('button', el).forEach((b) => (b.disabled = false));
      }
    };
    $('[data-act="save"]', el).onclick = () => {
      const body = collect();
      if (!body.priority) return toast('우선순위를 골라 주세요.', true);
      if (r.status === '보류') body.status = '백로그';
      submit(body, r.status === '접수' ? `REQ-${id} 우선순위를 '${PRIO_LABEL[body.priority]}'(으)로 확정했어요.` : '저장했어요.');
    };
    const ask = (status) => {
      pending = status;
      $('.rb-label', el).textContent = `${status} 사유 (요청자에게 그대로 전달돼요)`;
      box.classList.add('open');
      $('textarea', box).focus();
    };
    const hold = $('[data-act="hold"]', el);
    if (hold) hold.onclick = () => ask('보류');
    $('[data-act="reject"]', el).onclick = () => ask('반려');
    $('[data-act="reason-cancel"]', el).onclick = () => { pending = null; box.classList.remove('open'); };
    $('[data-act="reason-ok"]', el).onclick = () => {
      const reason = $('textarea', box).value.trim();
      if (!reason) return toast(`${pending} 사유를 입력해 주세요.`, true);
      submit({ status: pending, statusReason: reason }, `REQ-${id}을(를) ${pending} 처리했어요.`);
    };
  });
}

// ───────────────────────── 요청 등록 ─────────────────────────
function viewNew(main) {
  const E = S.meta.enums;
  S.draft = { attachments: [] };
  main.innerHTML = `
    <div class="page-head"><div><div class="crumb">요청 / 새 요청</div><h1>요청 등록</h1>
      <p>슬랙 DM이나 구두 대신 여기로 요청해 주세요. 우선순위 회의에서 검토하고, 진행 상황은 슬랙으로 알려드려요.</p></div></div>
    <form class="form-wrap" id="new-form" novalidate>
      <section class="form-sec panel">
        <h2><span class="step">1/3</span>무엇을 요청하나요?</h2>
        <div class="field"><label class="label" for="f-title">제목<span class="req">*</span></label>
          <input class="input" id="f-title" name="title" maxlength="120" placeholder="예: 강남점 키오스크 영수증 미출력"></div>
        <div class="field"><span class="label">대상 플랫폼<span class="req">*</span></span><div class="chips">${chipGroup('platforms', E.platforms, 'checkbox')}</div></div>
        <div class="field"><span class="label">요청 유형<span class="req">*</span></span><div class="chips">${chipGroup('type', E.types, 'radio')}</div>
          <span class="hint" id="type-hint">${E.types.map((t) => `${esc(t)}: ${esc(E.typeHints[t])}`).join(' · ')}</span></div>
        <div class="field"><span class="label">누구의 일이 필요한가요?</span><div class="chips">${chipGroup('jobs', E.jobs, 'checkbox')}</div>
          <span class="hint">잘 모르겠으면 비워 두세요. 우선순위 회의에서 정해요.</span></div>
      </section>

      <section class="form-sec panel">
        <h2><span class="step">2/3</span>자세한 내용</h2>
        <div class="field"><label class="label" for="f-desc">요청 내용<span class="req">*</span></label>
          <textarea class="textarea" id="f-desc" name="description" rows="6" maxlength="5000" placeholder="무엇이, 어디서, 어떻게 되길 원하는지 적어 주세요."></textarea></div>
        <div class="field" id="repro-field" hidden><label class="label" for="f-repro">재현 방법</label>
          <textarea class="textarea" id="f-repro" name="reproSteps" rows="4" maxlength="3000" placeholder="1. 메뉴 선택 후 카드 결제&#10;2. 결제 완료 화면까지 정상&#10;3. 영수증이 나오지 않음"></textarea>
          <span class="hint">어떤 순서로 하면 문제가 생기는지 적어 주시면 훨씬 빨리 고칠 수 있어요.</span></div>
        <div class="field"><span class="label">스크린샷 <small class="muted">(이미지 5개, 하나당 5MB까지)</small></span>
          <div class="drop" id="drop" tabindex="0" role="button">클릭하거나 이미지를 끌어다 놓으세요. 캡처 후 Ctrl+V로 붙여넣어도 돼요.</div>
          <input type="file" id="f-files" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden>
          <div class="thumbs" id="thumbs"></div></div>
        <div class="field" style="max-width:240px"><label class="label" for="f-due">희망 완료일</label>
          <input class="input" type="date" id="f-due" name="dueDate" min="${today()}"></div>
      </section>

      <section class="form-sec panel">
        <h2><span class="step">3/3</span>긴급도와 중요도</h2>
        <p class="lead">우선순위는 기획·개발·디자인·운영이 함께하는 우선순위 회의에서 정해요. 적어 주신 <b>이유</b>가 판단 근거가 되니 구체적으로 적어 주세요.</p>
        <div class="grid-2">
          <div class="level-block">
            <div class="q">긴급도<span class="req">*</span><small>언제까지 처리되지 않으면 어떤 문제가 생기나요?</small></div>
            <div class="chips">${chipGroup('urgency', E.levels, 'radio', 'lv')}</div>
            <textarea class="textarea" name="urgencyReason" rows="3" maxlength="1000" aria-label="긴급도 이유" placeholder="예: 금요일 프로모션 시작 전에 반영되지 않으면 키오스크에서 할인이 적용되지 않아요."></textarea>
          </div>
          <div class="level-block">
            <div class="q">중요도<span class="req">*</span><small>얼마나 많은 고객·매장·매출에 영향이 있나요?</small></div>
            <div class="chips">${chipGroup('importance', E.levels, 'radio', 'lv')}</div>
            <textarea class="textarea" name="importanceReason" rows="3" maxlength="1000" aria-label="중요도 이유" placeholder="예: 전체 30개 매장, 하루 결제 약 200건에 영향이 있어요."></textarea>
          </div>
        </div>
      </section>

      <div class="err-box" id="new-err" hidden></div>
      <div class="form-foot"><a class="btn" href="#/board">취소</a><button class="btn primary" type="submit" id="new-submit">요청 등록</button></div>
    </form>`;

  const form = $('#new-form');
  $$('input[name="type"]', form).forEach((i) => i.addEventListener('change', () => {
    $('#repro-field').hidden = i.value !== '버그' || !i.checked;
    $('#type-hint').textContent = E.typeHints[i.value] || '';
  }));
  const drop = $('#drop'), files = $('#f-files');
  drop.onclick = () => files.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); files.click(); } };
  files.onchange = () => { addFiles(files.files); files.value = ''; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
  form.onsubmit = (e) => { e.preventDefault(); submitNew(form); };
  $('#f-title').focus();
}

function addFiles(list) {
  for (const f of list) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { toast('이미지 파일(png, jpg, gif, webp)만 첨부할 수 있어요.', true); continue; }
    if (f.size > 5 * 1024 * 1024) { toast(`${f.name}: 5MB를 넘어요.`, true); continue; }
    if (S.draft.attachments.length >= 5) { toast('첨부는 5개까지 가능해요.', true); break; }
    const item = { name: f.name || '붙여넣은 이미지.png', type: f.type, dataUrl: null };
    S.draft.attachments.push(item);
    const reader = new FileReader();
    reader.onload = () => { item.dataUrl = reader.result; renderThumbs(); };
    reader.readAsDataURL(f);
  }
}

function renderThumbs() {
  const el = $('#thumbs');
  if (!el) return;
  el.innerHTML = S.draft.attachments.filter((a) => a.dataUrl)
    .map((a, i) => `<div class="thumb"><img src="${a.dataUrl}" alt="${esc(a.name)}"><button type="button" data-rm="${i}" aria-label="삭제">✕</button></div>`).join('');
  $$('[data-rm]', el).forEach((b) => (b.onclick = () => { S.draft.attachments.splice(Number(b.dataset.rm), 1); renderThumbs(); }));
}

async function submitNew(form) {
  const fd = new FormData(form);
  const v = (k) => String(fd.get(k) || '').trim();
  const type = v('type');
  const body = {
    title: v('title'), platforms: fd.getAll('platforms'), type, jobs: fd.getAll('jobs'),
    description: v('description'), reproSteps: type === '버그' ? v('reproSteps') : '', dueDate: v('dueDate'),
    urgency: v('urgency'), urgencyReason: v('urgencyReason'), importance: v('importance'), importanceReason: v('importanceReason'),
    attachments: S.draft.attachments.filter((a) => a.dataUrl).map((a) => ({ name: a.name, type: a.type, data: a.dataUrl.split(',')[1] })),
  };
  const errs = [];
  if (!body.title) errs.push('제목을 입력해 주세요.');
  if (!body.platforms.length) errs.push('대상 플랫폼을 하나 이상 골라 주세요.');
  if (!body.type) errs.push('요청 유형을 골라 주세요.');
  if (!body.description) errs.push('요청 내용을 입력해 주세요.');
  if (!body.urgency) errs.push('긴급도를 골라 주세요.');
  if (!body.urgencyReason) errs.push('긴급하다고 생각한 이유를 적어 주세요.');
  if (!body.importance) errs.push('중요도를 골라 주세요.');
  if (!body.importanceReason) errs.push('중요하다고 생각한 이유를 적어 주세요.');
  const errBox = $('#new-err');
  if (errs.length) { errBox.textContent = errs.join('\n'); errBox.hidden = false; errBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  errBox.hidden = true;
  const btn = $('#new-submit');
  btn.disabled = true; btn.textContent = '등록 중…';
  try {
    const r = await api('POST', '/api/requests', body);
    toast(`REQ-${r.id} 요청을 등록했어요. 우선순위 회의에서 검토할게요.`);
    S.lastView = 'list';
    S.list.requested = true;
    S.list.status = 'open';
    location.hash = '#/r/' + r.id;
  } catch (e) {
    errBox.textContent = e.message; errBox.hidden = false;
    btn.disabled = false; btn.textContent = '요청 등록';
  }
}

// ───────────────────────── 요청 상세 (드로어) ─────────────────────────
async function openRequestDrawer(id) {
  const root = $('#drawer-root');
  root.innerHTML = `<div class="overlay" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="요청 상세">
    <div class="d-body"><div class="empty">불러오는 중…</div></div></aside>`;
  $$('[data-close]', root).forEach((b) => (b.onclick = closeDrawer));
  try {
    const r = await api('GET', `/api/requests/${id}`);
    if (S.detail && S.detail.kind === 'r' && S.detail.id === id) renderRequestDrawer(r);
  } catch (e) {
    if (S.detail && S.detail.id === id) $('.d-body', root).innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function githubCell(g, canRetry) {
  if (g && g.url) return `<a href="${esc(g.url)}" target="_blank" rel="noopener" class="mono" style="font-size:12px">${esc(g.repo)}#${g.number}</a>`;
  if (!S.meta.integrations.github) return '<span class="muted">연동 전 (설정 필요)</span>';
  if (g && g.error) return `<span style="color:var(--danger)">이슈를 만들지 못했어요</span> ${canRetry ? '<button class="btn sm" data-act="gh-retry">다시 만들기</button>' : ''}<br><small class="muted">${esc(g.error)}</small>`;
  return '<span class="muted">이슈 만드는 중…</span>';
}

function tlItem(t) {
  const by = `<b>${esc(t.by ? t.by.name : '')}</b>`;
  const when = `<span class="when" title="${fmtDateTime(t.at)}">${ago(t.at)}</span>`;
  const row = (ic, html) => `<div class="tl"><span class="ic">${ic}</span><span>${html}</span>${when}</div>`;
  switch (t.type) {
    case 'created': return row('+', `${by} 님이 등록했어요`);
    case 'status': return row('⇄', `${by} · 상태 ${statusBadge(t.from)} → ${statusBadge(t.to)}${t.reason ? `<br><span class="muted">사유: ${esc(t.reason)}</span>` : ''}`);
    case 'priority': return row('↑', `${by} · 우선순위 ${prioBadge(t.from)} → ${prioBadge(t.to)}`);
    case 'jobs': return row('◎', `${by} · 담당 직군: ${esc(t.to.join(', ') || '미정')}`);
    case 'assignees': return row('@', `${by} · 담당자: ${esc(names(t.to) || '없음')}`);
    case 'versions': return row('v', `${by} · 반영 버전: <b>${esc((t.to || []).join(', ') || '없음')}</b>`);
    case 'released': return row('📦', `<b>${esc(t.text)}</b> 배포에 반영됐어요`);
    case 'field': return row('•', `${by} · ${esc(t.label)}: ${t.field === 'status' ? `${statusBadge(t.from)} → ${statusBadge(t.to)}` : `${esc(t.from)} → <b>${esc(t.to)}</b>`}`);
    case 'comment': return `<div class="tl comment${t.ghCommentId ? ' gh' : ''}"><div class="ch"><span class="avatar sm">${esc((t.by ? t.by.name : '?').slice(0, 1))}</span>${by}${when}</div><p>${esc(t.text)}</p></div>`;
    default: return '';
  }
}

function renderRequestDrawer(r) {
  const root = $('#drawer-root'), p = r.perms, E = S.meta.enums;
  const handlerStatuses = E.statuses.filter((s) => !['접수', '보류', '반려'].includes(s));
  let statusOpts = p.triage ? E.statuses : handlerStatuses;
  if (!statusOpts.includes(r.status)) statusOpts = [r.status, ...statusOpts];
  // 플랫폼마다 반영 버전 하나씩 고르기 (취소된 버전 제외)
  const versionPicks = S.meta.enums.versionPlatforms.filter((pl) => r.platforms.includes(pl)).map((pl) => {
    const cur = r.versions.find((v) => v.platform === pl);
    const opts = S.versions.filter((v) => v.platform === pl && (v.status !== '취소' || (cur && cur.id === v.id)))
      .sort((a, b) => (b.plannedDate || '').localeCompare(a.plannedDate || ''));
    return `<div class="field"><label class="label" for="m-v-${esc(pl)}">${esc(pl)} 반영 버전</label><select class="select" data-vpick id="m-v-${esc(pl)}">
      <option value="">아직 안 정함</option>${opts.map((v) => `<option value="${v.id}" ${cur && cur.id === v.id ? 'selected' : ''}>${esc(vName(v.version))} · ${esc(v.status)}${v.status === '배포 완료' ? (v.releasedDate ? ` ${shortDay(v.releasedDate)}` : '') : v.plannedDate ? ` · ${shortDay(v.plannedDate)} 예정` : ''}</option>`).join('')}</select></div>`;
  }).join('');
  const manage = p.status || p.versions ? `
    <section class="manage" id="manage"><h3>처리 ${p.triage ? '' : p.status ? '<small class="muted" style="font-weight:400">· 담당자는 상태와 반영 버전만 바꿀 수 있어요</small>' : '<small class="muted" style="font-weight:400">· 반영 버전만 바꿀 수 있어요</small>'}</h3>
      ${p.status ? `<div class="grid-2">
        <div class="field"><label class="label" for="m-status">상태</label><select class="select" id="m-status">${statusOpts.map((s) =>
          `<option value="${s}" ${s === r.status ? 'selected' : ''} ${!p.triage && !handlerStatuses.includes(s) ? 'disabled' : ''}>${s}</option>`).join('')}</select></div>
        ${p.triage ? `<div class="field"><label class="label" for="m-prio">우선순위</label><select class="select" id="m-prio"><option value="">미정</option>${E.priorities.map((x) =>
          `<option value="${x}" ${x === r.priority ? 'selected' : ''}>${PRIO_LABEL[x]}</option>`).join('')}</select></div>` : ''}
      </div>
      <div class="field" id="m-reason-f" hidden><label class="label" for="m-reason">사유<span class="req">*</span></label>
        <textarea class="textarea" id="m-reason" rows="2" maxlength="1000" placeholder="요청자에게 그대로 전달돼요."></textarea></div>` : ''}
      ${p.triage ? `<div class="field"><span class="label">담당 직군</span><div class="chips">${chipGroup('m-jobs', E.jobs, 'checkbox', '', r.jobs)}</div></div>
        <div class="field"><span class="label">담당자</span>${assigneePicker(r.assignees)}</div>` : ''}
      ${p.versions && versionPicks ? `<div class="grid-2">${versionPicks}</div><p class="hint" style="margin-top:-4px">버전이 '배포 완료'가 되면 이 요청도 자동으로 완료되고 요청자에게 알림이 가요.</p>` : ''}
      <div><button class="btn primary" id="m-save">변경 저장</button></div>
    </section>` : '';

  root.innerHTML = `<div class="overlay" data-close></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-label="요청 상세">
    <div class="d-head">
      <div class="row"><span class="key">REQ-${r.id}</span>${statusBadge(r.status)}${prioBadge(r.priority)}<button class="btn ghost sm close" data-close aria-label="닫기">✕ 닫기</button></div>
      <h2>${esc(r.title)}</h2>
      <div class="sub">${esc(r.requester.name)} · ${esc(r.requesterTeam)} · <span class="mono">${fmtDateTime(r.createdAt)}</span> 등록</div>
    </div>
    <div class="d-body">
      ${NEEDS_REASON.includes(r.status) && r.statusReason ? `<div class="callout ${STATUS_CLASS[r.status]}"><b>${esc(r.status)} 사유</b><br>${esc(r.statusReason)}</div>` : ''}
      <dl class="kv">
        <div><dt>플랫폼</dt><dd>${tags(r.platforms)}</dd></div>
        <div><dt>유형</dt><dd>${esc(r.type)}</dd></div>
        <div><dt>담당 직군</dt><dd>${esc(r.jobs.join(', ') || '미정')}</dd></div>
        <div><dt>담당자</dt><dd>${esc(names(r.assignees) || '미정')}</dd></div>
        <div><dt>희망 완료일</dt><dd>${r.dueDate ? `<span class="mono">${fmtDay(r.dueDate)}</span> <small class="muted">${dueText(r.dueDate)}</small>` : '-'}</dd></div>
        <div><dt>반영 버전</dt><dd>${r.versions.length ? r.versions.map((v) => `<a href="#/v/${v.id}">${esc(vLabel(v))}</a> <small class="muted">${esc(v.status)}</small>`).join('<br>') : '-'}</dd></div>
        <div><dt>GitHub</dt><dd>${githubCell(r.github, p.triage)}</dd></div>
        <div><dt>최근 변경</dt><dd>${ago(r.updatedAt)}</dd></div>
      </dl>
      <section class="sec"><h3>요청 내용</h3><div class="body">${esc(r.description)}</div></section>
      ${r.reproSteps ? `<section class="sec"><h3>재현 방법</h3><div class="body">${esc(r.reproSteps)}</div></section>` : ''}
      <section class="sec"><h3>요청자가 판단한 긴급도·중요도</h3><div class="reasons">
        <div class="reason"><div class="rh">긴급도 ${lvBadge(r.urgency)}</div><p>${esc(r.urgencyReason)}</p></div>
        <div class="reason"><div class="rh">중요도 ${lvBadge(r.importance)}</div><p>${esc(r.importanceReason)}</p></div>
      </div></section>
      ${r.attachments.length ? `<section class="sec"><h3>첨부 <span class="muted mono" style="font-weight:400">${r.attachments.length}</span></h3><div class="attach">${r.attachments.map((a) =>
        `<a href="/files/${esc(a.file)}" target="_blank" rel="noopener" title="${esc(a.name)}"><img src="/files/${esc(a.file)}" alt="${esc(a.name)}"></a>`).join('')}</div></section>` : ''}
      ${manage}
      <section class="sec"><h3>진행 기록</h3>
        <div class="timeline">${r.timeline.map(tlItem).join('')}</div>
        <form class="comment-form" id="c-form">
          <textarea class="textarea" name="text" rows="2" maxlength="3000" aria-label="댓글" placeholder="질문이나 추가 내용을 남겨 주세요. 요청자와 담당자에게 슬랙으로 알려요."></textarea>
          <div class="row"><button class="btn primary sm" type="submit">댓글 남기기</button></div>
        </form>
      </section>
    </div>
  </aside>`;

  $$('[data-close]', root).forEach((b) => (b.onclick = closeDrawer));
  const reload = async (msg) => {
    if (msg) toast(msg);
    const fresh = await api('GET', `/api/requests/${r.id}`);
    if (S.detail && S.detail.kind === 'r' && S.detail.id === r.id) renderRequestDrawer(fresh);
    refreshSafe();
  };

  const gh = $('[data-act="gh-retry"]', root);
  if (gh) gh.onclick = async () => {
    gh.disabled = true;
    try { await api('POST', `/api/requests/${r.id}/github-sync`, {}); await reload('GitHub 이슈를 다시 만들었어요.'); }
    catch (e) { toast(e.message, true); gh.disabled = false; }
  };

  if (p.status || p.versions) {
    const sel = $('#m-status'), rf = $('#m-reason-f');
    if (sel) sel.onchange = () => { rf.hidden = !(NEEDS_REASON.includes(sel.value) && sel.value !== r.status); };
    $('#m-save').onclick = async () => {
      const body = {};
      if (sel) {
        body.status = sel.value;
        if (NEEDS_REASON.includes(sel.value) && sel.value !== r.status) {
          body.statusReason = $('#m-reason').value.trim();
          if (!body.statusReason) return toast(`${sel.value} 사유를 입력해 주세요.`, true);
        }
      }
      if (p.versions && $$('[data-vpick]', root).length) {
        // 화면에 없는 플랫폼(요청 플랫폼에서 빠진 경우)의 기존 버전은 그대로 유지
        const shown = S.meta.enums.versionPlatforms.filter((pl) => r.platforms.includes(pl));
        body.versionIds = [
          ...r.versions.filter((v) => !shown.includes(v.platform)).map((v) => v.id),
          ...$$('[data-vpick]', root).map((s) => s.value).filter(Boolean).map(Number),
        ];
      }
      if (p.triage) {
        body.priority = $('#m-prio').value || null;
        body.jobs = $$('input[name="m-jobs"]:checked', root).map((i) => i.value);
        body.assignees = pickerValue($('#manage'));
      }
      const btn = $('#m-save');
      btn.disabled = true;
      try { await api('PATCH', `/api/requests/${r.id}`, body); await reload('변경 사항을 저장했어요.'); }
      catch (e) { toast(e.message, true); btn.disabled = false; }
    };
  }

  $('#c-form').onsubmit = async (e) => {
    e.preventDefault();
    const ta = $('textarea', e.target);
    const text = ta.value.trim();
    if (!text) return;
    const btn = $('button', e.target);
    btn.disabled = true;
    try { await api('POST', `/api/requests/${r.id}/comments`, { text }); await reload('댓글을 남겼어요.'); }
    catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

// ───────────────────────── 알림 기록 ─────────────────────────
async function viewNotifications(main) {
  const I = S.meta.integrations;
  const on = (x) => (x ? '<span class="on">연결됨</span>' : '<span class="off">미설정</span>');
  main.innerHTML = `
    <div class="page-head"><div><div class="crumb">기타 / 알림 기록</div><h1>알림 기록</h1>
      <p>요청·작업이 바뀔 때 보낸 슬랙 알림이에요. 슬랙을 설정하기 전에는 실제로 보내지 않고 여기에만 남아요.</p></div></div>
    <div class="note">슬랙 채널 ${on(I.slackChannel)} · 슬랙 DM ${on(I.slackDm)} · GitHub ${on(I.github)}</div>
    <div id="noti-list"><div class="empty">불러오는 중…</div></div>`;
  try {
    const list = await api('GET', '/api/notifications');
    const el = $('#noti-list');
    if (!el) return;
    el.innerHTML = list.length ? list.map((n) => `<div class="noti panel">
      <div class="t">${fmtDateTime(n.at)}<a class="key" href="${esc(n.link || '#/r/' + n.requestId)}">${esc(n.ref || 'REQ-' + n.requestId)}</a></div>
      <div><b>${esc(n.title)}</b><div class="msg">${esc(n.text)}</div>
        <div class="to">${n.channel ? '<span class="tag">채널</span>' : ''}${n.dm.map((d) => `<span class="tag">DM ${esc(d)}</span>`).join('')}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">${esc(n.delivery.join(' · '))}</div></div>
    </div>`).join('') : '<div class="empty">아직 보낸 알림이 없어요.</div>';
  } catch (e) { toast(e.message, true); }
}
