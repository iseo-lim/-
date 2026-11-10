'use strict';
/* 작업 관리: 스프린트 보드 · 백로그 · 에픽 · 작업 상세 · 만들기 창 */

const byRank = (a, b) => (a.rank || 0) - (b.rank || 0) || a.id - b.id;
const tasksIn = (sprintId) => S.work.tasks.filter((t) => (t.sprintId ?? null) === sprintId).sort(byRank);
const sprintLabel = (s) => `${s.name}${s.state === 'active' ? ' · 진행 중' : s.state === 'closed' ? ' · 끝남' : ''}`;
const openSprints = () => S.work.sprints.filter((s) => s.state !== 'closed').sort((a, b) =>
  (a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0) || (a.startDate || '9999').localeCompare(b.startDate || '9999') || a.id - b.id);
const epicOptions = (selected) => `<option value="">에픽 없음</option>${S.work.epics.filter((e) => e.status === 'open' || e.id === selected)
  .map((e) => `<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${esc(e.key)} ${esc(e.title)}</option>`).join('')}`;
const sprintOptions = (selected) => `<option value="">백로그</option>${S.work.sprints.filter((s) => s.state !== 'closed' || s.id === selected)
  .map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(sprintLabel(s))}</option>`).join('')}`;
const prioOptions = (selected) => `<option value="">미정</option>${S.meta.enums.priorities.map((p) => `<option value="${p}" ${p === selected ? 'selected' : ''}>${p} ${PRIO_LABEL[p]}</option>`).join('')}`;
const jobOptions = (selected) => `<option value="">미정</option>${S.meta.enums.jobs.map((j) => `<option ${j === selected ? 'selected' : ''}>${j}</option>`).join('')}`;

// 낙관적 반영: 화면을 먼저 바꾸고 서버에 저장, 실패하면 되돌림
async function moveTask(id, patch, rerender) {
  const t = S.work.tasks.find((x) => x.id === id);
  if (!t || !Object.keys(patch).some((k) => t[k] !== patch[k])) return;
  const prev = { ...t };
  Object.assign(t, patch);
  rerender();
  try {
    await api('PATCH', `/api/tasks/${id}`, patch);
    if (patch.status && patch.status !== prev.status) toast(`${t.key}을(를) '${patch.status}'(으)로 옮겼어요.`);
    const v = S.lastView;
    refresh().then(() => { if (S.lastView === v && !S.detail && !S.dragging) rerender(); }).catch(() => {});
  } catch (e) {
    Object.assign(t, prev);
    rerender();
    toast(e.message, true);
  }
}

// ───────────────────────── 스프린트 보드 ─────────────────────────
function taskCard(t, draggable) {
  const prs = t.prs || [];
  return `<article class="card tcard" data-id="${t.id}" ${draggable ? 'draggable="true"' : ''} tabindex="0" aria-label="${esc(t.key)} ${esc(t.title)}">
    <div class="top"><span class="key">${esc(t.key)}</span>${prioBadge(t.priority)}${t.requestId ? `<span class="ref" title="연결된 요청">↳ REQ-${t.requestId}</span>` : ''}</div>
    <div class="title">${esc(t.title)}</div>
    <div class="meta">${t.epicId ? epicTag(t.epicId) : ''}${t.job ? `<span class="tag">${esc(t.job)}</span>` : ''}${(t.labels || []).map((l) => `<span class="tag">#${esc(l)}</span>`).join('')}</div>
    <div class="foot"><span class="r">${prs.length ? `<span class="pr" title="연결된 PR">⑂ PR ${prs.length}</span>` : ''}${t.dueDate ? `<span class="mono" title="마감일">${shortDay(t.dueDate)}</span>` : ''}${t.commentCount ? `<span>💬 ${t.commentCount}</span>` : ''}</span>
      <span class="r">${ptsBadge(t.points)}${avatar(t.assignee, 'sm')}</span></div>
  </article>`;
}

function viewSprint(main) {
  const sp = activeSprint();
  if (!sp) {
    main.innerHTML = `<div class="page-head"><div><div class="crumb">작업 관리 / 스프린트</div><h1>스프린트 보드</h1></div></div>
      <div class="panel empty">진행 중인 스프린트가 없어요. 백로그에서 스프린트를 만들고 작업을 넣은 뒤 시작해 주세요.<br><a class="btn primary" href="#/backlog">백로그로 가기</a></div>`;
    return;
  }
  const f = S.sprintF;
  const all = tasksIn(sp.id);
  const shown = all.filter((t) => (!f.assignee || t.assignee === f.assignee) && (!f.epic || String(t.epicId) === f.epic) && (!f.job || t.job === f.job) && (!f.mine || t.assignee === S.me.memberId));
  const left = sp.endDate ? daysLeft(sp.endDate) : null;
  const people = [...new Set(all.map((t) => t.assignee).filter(Boolean))].map((id) => [id, userName(id)]);
  const edit = has('work.edit');
  main.innerHTML = `
    <div class="page-head">
      <div><div class="crumb">작업 관리 / 스프린트</div>
        <h1>${esc(sp.name)} <span class="sub">${shortDay(sp.startDate)} – ${shortDay(sp.endDate)}${left === null ? '' : left >= 0 ? ` · ${left}일 남음` : ` · ${-left}일 지남`}</span></h1>
        ${sp.goal ? `<p>${esc(sp.goal)}</p>` : ''}</div>
      <div class="toolbar">${has('work.plan') ? '<button class="btn" id="sp-complete">스프린트 완료</button>' : ''}${edit ? '<button class="btn primary" id="sp-add">+ 작업 만들기</button>' : ''}</div>
    </div>
    <div class="panel sprint-meter">${meterHtml(all, { size: 'big' })}</div>
    <div class="filters">
      ${selectHtml('sprintF.assignee', '담당자 전체', people, f.assignee)}
      ${selectHtml('sprintF.epic', '에픽 전체', S.work.epics.map((e) => [e.id, e.title]), f.epic)}
      ${selectHtml('sprintF.job', '직군 전체', S.meta.enums.jobs, f.job)}
      ${edit ? toggleHtml('sprintF.mine', '내 작업만', f.mine) : ''}
      <span class="spacer"></span>
      ${edit ? '<span class="muted" style="font-size:12px">카드를 끌어서 상태를 바꿔요</span>' : ''}
    </div>
    <div class="board" id="sboard">${TASK_STATUSES.map((st) => {
      const list = shown.filter((t) => t.status === st);
      return `<section class="col" data-status="${st}"><header>${statusBadge(st)}<span class="n">${list.length}</span><span class="sub">${sumPts(list)}pt</span></header>
        <div class="cards">${list.map((t) => taskCard(t, edit)).join('')}</div></section>`;
    }).join('')}</div>`;

  bindFilters(main, () => viewSprint(main));
  const add = $('#sp-add');
  if (add) add.onclick = () => openTaskCreate({ sprintId: sp.id, onDone: () => viewSprint(main) });
  const done = $('#sp-complete');
  if (done) done.onclick = () => openSprintComplete(sp, () => viewSprint(main));
  bindCards(main);
  if (!edit) return;
  $$('.col[data-status]', main).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-ok'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop-ok'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drop-ok');
      const id = Number(e.dataTransfer.getData('text/plain'));
      if (id) moveTask(id, { status: col.dataset.status }, () => viewSprint(main));
    });
  });
}

function bindCards(root) {
  $$('.tcard', root).forEach((card) => {
    card.onclick = () => (location.hash = '#/t/' + card.dataset.id);
    card.onkeydown = (e) => { if (e.key === 'Enter') card.click(); };
    card.addEventListener('dragstart', (e) => {
      S.dragging = true;
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      S.dragging = false;
      card.classList.remove('dragging');
      $$('.drop-ok').forEach((c) => c.classList.remove('drop-ok'));
    });
  });
}

// ───────────────────────── 백로그 ─────────────────────────
function blRow(t, draggable) {
  return `<div class="bl-row${t.status === '완료' ? ' done' : ''}" data-id="${t.id}" ${draggable ? 'draggable="true"' : ''} tabindex="0">
    <span class="grip" aria-hidden="true">⋮⋮</span><span class="key">${esc(t.key)}</span><span class="t" title="${esc(t.title)}">${esc(t.title)}</span>
    ${t.epicId ? epicTag(t.epicId) : '<span></span>'}<span class="job">${esc(t.job || '')}</span>${prioBadge(t.priority)}${avatar(t.assignee, 'sm')}${ptsBadge(t.points)}${statusBadge(t.status)}</div>`;
}

function blSection(s, match) {
  const id = s ? s.id : null;
  const all = tasksIn(id);
  const rows = all.filter(match);
  const edit = has('work.edit'), plan = has('work.plan');
  let head;
  if (s) {
    const dates = s.startDate || s.endDate ? `${shortDay(s.startDate) || '?'} – ${shortDay(s.endDate) || '?'} · ` : '';
    head = `<h2>${esc(s.name)}</h2>${s.state === 'active' ? statusBadge('진행 중') : '<span class="tag">계획</span>'}
      <span class="facts">${dates}${all.length}개 · ${sumPts(all)}pt</span>
      <span class="acts">${s.state === 'active' ? '<a class="btn sm" href="#/sprint">보드 열기</a>' : ''}
        ${plan && s.state === 'planned' ? `<button class="btn sm ghost" data-edit-sprint="${s.id}">수정</button><button class="btn sm primary" data-start-sprint="${s.id}">스프린트 시작</button>` : ''}
        ${plan && s.state === 'active' ? `<button class="btn sm ghost" data-edit-sprint="${s.id}">수정</button>` : ''}</span>`;
  } else {
    head = `<h2>백로그</h2><span class="facts">${all.length}개 · ${sumPts(all)}pt</span><span class="muted" style="font-size:12.5px">스프린트에 넣을 작업을 위 칸으로 끌어 올리세요</span>`;
  }
  return `<section class="bl-sec panel${s && s.state === 'active' ? ' active' : ''}">
    <header>${head}</header>
    ${s && s.goal ? `<div class="goal">${esc(s.goal)}</div>` : ''}
    ${s && all.length ? meterHtml(all, { size: 'mini' }) : ''}
    <div class="bl-rows" data-sprint="${id ?? ''}">${rows.map((t) => blRow(t, edit)).join('') || `<div class="bl-empty">${all.length ? '필터에 맞는 작업이 없어요.' : edit ? '작업을 여기로 끌어 오거나 아래에서 바로 추가하세요.' : '작업이 없어요.'}</div>`}</div>
    ${edit ? `<form class="bl-add" data-sprint="${id ?? ''}"><span class="muted">+</span><input maxlength="200" placeholder="작업 제목을 입력하고 Enter" aria-label="${esc(s ? s.name : '백로그')}에 작업 추가"></form>` : ''}
  </section>`;
}

function viewBacklog(main) {
  const f = S.backlogF;
  const q = f.q.trim().toLowerCase();
  const match = (t) => (!f.epic || String(t.epicId) === f.epic) && (!f.assignee || t.assignee === f.assignee) && (!q || `${t.key} ${t.title}`.toLowerCase().includes(q));
  const edit = has('work.edit'), plan = has('work.plan');
  main.innerHTML = `
    <div class="page-head">
      <div><div class="crumb">작업 관리 / 백로그</div><h1>백로그</h1><p>작업을 끌어서 스프린트에 넣고, 위아래로 옮겨 순서를 정해요.</p></div>
      <div class="toolbar">${plan ? '<button class="btn" id="bl-new-sprint">+ 스프린트 만들기</button>' : ''}${edit ? '<button class="btn primary" id="bl-new-task">+ 작업 만들기</button>' : ''}</div>
    </div>
    <div class="filters">
      <input class="input search" type="search" placeholder="번호·제목 검색" data-f="backlogF.q" value="${esc(f.q)}" aria-label="검색">
      ${selectHtml('backlogF.epic', '에픽 전체', S.work.epics.map((e) => [e.id, e.title]), f.epic)}
      ${selectHtml('backlogF.assignee', '담당자 전체', S.users.map((u) => [u.memberId, u.name]), f.assignee)}
    </div>
    <div id="bl-list">${[...openSprints(), null].map((s) => blSection(s, match)).join('')}</div>`;

  bindFilters(main, () => { const el = $('#bl-list'); el.innerHTML = [...openSprints(), null].map((s) => blSection(s, match)).join(''); bindBacklog(main); });
  const ns = $('#bl-new-sprint');
  if (ns) ns.onclick = () => openSprintForm(null, () => viewBacklog(main));
  const nt = $('#bl-new-task');
  if (nt) nt.onclick = () => openTaskCreate({ onDone: () => viewBacklog(main) });
  bindBacklog(main);
}

function bindBacklog(main) {
  const rerender = () => viewBacklog(main);
  $$('.bl-row', main).forEach((row) => {
    row.onclick = () => (location.hash = '#/t/' + row.dataset.id);
    row.onkeydown = (e) => { if (e.key === 'Enter') row.click(); };
    row.addEventListener('dragstart', (e) => {
      S.dragging = true;
      row.classList.add('dragging');
      e.dataTransfer.setData('text/plain', row.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      S.dragging = false;
      row.classList.remove('dragging');
      $$('.drop-ok, .drop-before', main).forEach((x) => x.classList.remove('drop-ok', 'drop-before'));
    });
    row.addEventListener('dragover', () => {
      $$('.drop-before', main).forEach((x) => x !== row && x.classList.remove('drop-before'));
      row.classList.add('drop-before');
    });
  });
  $$('.bl-rows', main).forEach((box) => {
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop-ok'); });
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) { box.classList.remove('drop-ok'); $$('.drop-before', box).forEach((x) => x.classList.remove('drop-before')); } });
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = Number(e.dataTransfer.getData('text/plain'));
      if (!id) return;
      const sprintId = box.dataset.sprint === '' ? null : Number(box.dataset.sprint);
      const list = tasksIn(sprintId).filter((t) => t.id !== id);
      const target = e.target.closest('.bl-row');
      let rankV;
      const ti = target ? list.findIndex((t) => t.id === Number(target.dataset.id)) : -1;
      if (ti >= 0) {
        const next = list[ti], prev = list[ti - 1];
        rankV = prev ? (prev.rank + next.rank) / 2 : next.rank - 1;
      } else {
        rankV = list.length ? list[list.length - 1].rank + 1 : 1;
      }
      moveTask(id, { sprintId, rank: rankV }, rerender);
    });
  });
  $$('.bl-add', main).forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const input = $('input', form);
      const title = input.value.trim();
      if (!title) return;
      input.disabled = true;
      const sprint = form.dataset.sprint;
      try {
        const t = await api('POST', '/api/tasks', { title, sprintId: sprint === '' ? null : Number(sprint) });
        S.work.tasks.push(t);
        toast(`${t.key} 작업을 만들었어요.`);
        rerender();
        const again = $(`.bl-add[data-sprint="${sprint}"] input`, main);
        if (again) again.focus();
      } catch (err) { toast(err.message, true); input.disabled = false; }
    };
  });
  $$('[data-start-sprint]', main).forEach((b) => (b.onclick = () => {
    const s = S.work.sprints.find((x) => x.id === Number(b.dataset.startSprint));
    openSprintForm(s, rerender, true);
  }));
  $$('[data-edit-sprint]', main).forEach((b) => (b.onclick = () => openSprintForm(S.work.sprints.find((x) => x.id === Number(b.dataset.editSprint)), rerender)));
}

// ───────────────────────── 에픽 ─────────────────────────
function viewEpics(main) {
  const plan = has('work.plan');
  const epics = [...S.work.epics].sort((a, b) => (a.status === b.status ? a.id - b.id : a.status === 'open' ? -1 : 1));
  main.innerHTML = `
    <div class="page-head">
      <div><div class="crumb">작업 관리 / 에픽</div><h1>에픽</h1><p>여러 작업을 '12월 시즌 프로모션'처럼 큰 묶음으로 모아 진행률을 봐요.</p></div>
      <div class="toolbar">${plan ? '<button class="btn primary" id="ep-new">+ 에픽 만들기</button>' : ''}</div>
    </div>
    ${epics.length ? `<div class="epic-grid">${epics.map((e) => {
      const tasks = S.work.tasks.filter((t) => t.epicId === e.id);
      const reqs = new Set(tasks.map((t) => t.requestId).filter(Boolean));
      return `<article class="epic panel${e.status === 'done' ? ' done' : ''}" style="--c:${esc(e.color)}" data-id="${e.id}">
        <div class="top"><span class="key">${esc(e.key)}</span>${e.status === 'done' ? statusBadge('완료') : ''}</div>
        <h3>${esc(e.title)}</h3>
        ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}
        ${meterHtml(tasks, { size: 'mini' })}
        <div class="facts">작업 ${tasks.length}개 · 연결된 요청 ${reqs.size}건</div>
        <div class="acts"><button class="btn sm" data-act="backlog">백로그에서 보기</button>
          ${plan ? `<button class="btn sm ghost" data-act="edit">수정</button><button class="btn sm ghost" data-act="toggle">${e.status === 'done' ? '다시 열기' : '완료로 표시'}</button>` : ''}</div>
      </article>`;
    }).join('')}</div>` : `<div class="panel empty">아직 에픽이 없어요.${plan ? '<br><button class="btn primary" id="ep-new-2">첫 에픽 만들기</button>' : ''}</div>`}`;

  const rerender = () => viewEpics(main);
  ['#ep-new', '#ep-new-2'].forEach((sel) => { const b = $(sel); if (b) b.onclick = () => openEpicForm(null, rerender); });
  $$('.epic', main).forEach((el) => {
    const e = S.work.epics.find((x) => x.id === Number(el.dataset.id));
    $('[data-act="backlog"]', el).onclick = () => { S.backlogF.epic = String(e.id); location.hash = '#/backlog'; };
    const ed = $('[data-act="edit"]', el);
    if (ed) ed.onclick = () => openEpicForm(e, rerender);
    const tg = $('[data-act="toggle"]', el);
    if (tg) tg.onclick = async () => {
      try {
        await api('PATCH', `/api/epics/${e.id}`, { status: e.status === 'done' ? 'open' : 'done' });
        await refresh();
        rerender();
        toast(e.status === 'done' ? '에픽을 다시 열었어요.' : '에픽을 완료로 표시했어요.');
      } catch (err) { toast(err.message, true); }
    };
  });
}

// ───────────────────────── 만들기·수정 창 ─────────────────────────
function openTaskCreate(opts = {}) {
  const repos = S.work.repos || [];
  const html = `<form id="tc-form">
    <header><h2>${opts.requestId ? `REQ-${opts.requestId}을(를) 작업으로 쪼개기` : '작업 만들기'}</h2>
      <p>${opts.requestId ? '이 작업이 모두 끝나면 요청도 자동으로 완료돼요.' : '만들면 GitHub에 이슈도 함께 만들어져요.'}</p></header>
    <div class="m-body">
      <div class="field"><label class="label" for="tc-title">제목<span class="req">*</span></label><input class="input" id="tc-title" maxlength="200" value="${esc(opts.title || '')}" required></div>
      <div class="field"><label class="label" for="tc-desc">설명</label><textarea class="textarea" id="tc-desc" rows="3" maxlength="10000" placeholder="무엇을 하면 끝나는지 적어 주세요."></textarea></div>
      <div class="grid-3">
        <div class="field"><label class="label" for="tc-job">직군</label><select class="select" id="tc-job">${jobOptions(opts.job || '')}</select></div>
        <div class="field"><label class="label" for="tc-assignee">담당자</label><select class="select" id="tc-assignee">${userOptions('')}</select></div>
        <div class="field"><label class="label" for="tc-points">스토리 포인트</label><input class="input mono" id="tc-points" type="number" min="0" max="100" step="0.5" placeholder="0~100"></div>
        <div class="field"><label class="label" for="tc-prio">우선순위</label><select class="select" id="tc-prio">${prioOptions(opts.priority || '')}</select></div>
        <div class="field"><label class="label" for="tc-epic">에픽</label><select class="select" id="tc-epic">${epicOptions(opts.epicId ?? null)}</select></div>
        <div class="field"><label class="label" for="tc-sprint">스프린트</label><select class="select" id="tc-sprint">${sprintOptions(opts.sprintId ?? null)}</select></div>
      </div>
      ${repos.length > 1 ? `<div class="field"><label class="label" for="tc-repo">GitHub 저장소</label><select class="select" id="tc-repo"><option value="">기본 저장소</option>${repos.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div>` : ''}
      <div class="err-box" id="tc-err" hidden></div>
    </div>
    <footer><button type="button" class="btn" data-mclose>취소</button><button class="btn primary" type="submit" id="tc-submit">작업 만들기</button></footer>
  </form>`;
  openModal(html, (m) => {
    $('#tc-form', m).onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        title: $('#tc-title', m).value.trim(), description: $('#tc-desc', m).value, job: $('#tc-job', m).value,
        assignee: $('#tc-assignee', m).value || null, points: $('#tc-points', m).value === '' ? null : Number($('#tc-points', m).value),
        priority: $('#tc-prio', m).value || null, epicId: $('#tc-epic', m).value || null, sprintId: $('#tc-sprint', m).value || null,
        requestId: opts.requestId || null,
      };
      const repo = $('#tc-repo', m);
      if (repo && repo.value) body.repo = repo.value;
      if (!body.title) { $('#tc-err', m).textContent = '제목을 입력해 주세요.'; $('#tc-err', m).hidden = false; return; }
      const btn = $('#tc-submit', m);
      btn.disabled = true;
      try {
        const t = await api('POST', '/api/tasks', body);
        closeModal();
        toast(`${t.key} 작업을 만들었어요.`);
        await refresh();
        if (opts.onDone) opts.onDone(t);
      } catch (err) { $('#tc-err', m).textContent = err.message; $('#tc-err', m).hidden = false; btn.disabled = false; }
    };
  });
}

function openSprintForm(s, onDone, starting = false) {
  const n = S.work.sprints.length + 1;
  const html = `<form id="sf-form">
    <header><h2>${starting ? '스프린트 시작' : s ? '스프린트 수정' : '스프린트 만들기'}</h2>
      <p>${starting ? `${tasksIn(s.id).length}개 작업 · ${sumPts(tasksIn(s.id))}pt로 시작해요. 기간과 목표를 확인해 주세요.` : '보통 2주 단위로 잡아요. 기간은 시작할 때 정해도 돼요.'}</p></header>
    <div class="m-body">
      <div class="field"><label class="label" for="sf-name">이름</label><input class="input" id="sf-name" maxlength="60" value="${esc(s ? s.name : `스프린트 ${n}`)}"></div>
      <div class="field"><label class="label" for="sf-goal">목표</label><input class="input" id="sf-goal" maxlength="300" value="${esc(s ? s.goal : '')}" placeholder="이번 스프린트가 끝나면 무엇이 달라지나요?"></div>
      <div class="grid-2">
        <div class="field"><label class="label" for="sf-start">시작일</label><input class="input" type="date" id="sf-start" value="${esc((s && s.startDate) || (starting ? today() : ''))}"></div>
        <div class="field"><label class="label" for="sf-end">종료일</label><input class="input" type="date" id="sf-end" value="${esc((s && s.endDate) || (starting ? isoPlus(14) : ''))}"></div>
      </div>
      <div class="err-box" id="sf-err" hidden></div>
    </div>
    <footer><button type="button" class="btn" data-mclose>취소</button><button class="btn primary" type="submit">${starting ? '스프린트 시작' : s ? '저장' : '스프린트 만들기'}</button></footer>
  </form>`;
  openModal(html, (m) => {
    $('#sf-form', m).onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: $('#sf-name', m).value, goal: $('#sf-goal', m).value, startDate: $('#sf-start', m).value || null, endDate: $('#sf-end', m).value || null };
      try {
        if (s) await api('PATCH', `/api/sprints/${s.id}`, body);
        else await api('POST', '/api/sprints', body);
        if (starting) await api('POST', `/api/sprints/${s.id}/start`, {});
        closeModal();
        toast(starting ? `${body.name}을(를) 시작했어요.` : s ? '스프린트를 저장했어요.' : `${body.name}을(를) 만들었어요.`);
        await refresh();
        onDone();
      } catch (err) { $('#sf-err', m).textContent = err.message; $('#sf-err', m).hidden = false; }
    };
  });
}

function isoPlus(days) {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function openSprintComplete(sp, onDone) {
  const tasks = tasksIn(sp.id);
  const undone = tasks.filter((t) => t.status !== '완료');
  const planned = S.work.sprints.filter((s) => s.state === 'planned');
  const html = `<form id="sc-form">
    <header><h2>${esc(sp.name)} 완료</h2><p>끝낸 작업 ${tasks.length - undone.length}개 · 남은 작업 ${undone.length}개</p></header>
    <div class="m-body">
      ${meterHtml(tasks)}
      ${undone.length ? `<div class="field"><label class="label" for="sc-move">남은 작업 ${undone.length}개를 어디로 옮길까요?</label>
        <select class="select" id="sc-move"><option value="">백로그</option>${planned.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="mini-list">${undone.map((t) => `<div><span class="key">${esc(t.key)}</span><span class="grow">${esc(t.title)}</span>${statusBadge(t.status)}</div>`).join('')}</div>` : '<div class="note">모든 작업을 끝냈어요.</div>'}
      <div class="err-box" id="sc-err" hidden></div>
    </div>
    <footer><button type="button" class="btn" data-mclose>취소</button><button class="btn primary" type="submit">스프린트 완료</button></footer>
  </form>`;
  openModal(html, (m) => {
    $('#sc-form', m).onsubmit = async (e) => {
      e.preventDefault();
      const mv = $('#sc-move', m);
      try {
        await api('POST', `/api/sprints/${sp.id}/complete`, { moveTo: mv && mv.value ? Number(mv.value) : null });
        closeModal();
        toast(`${sp.name}을(를) 완료했어요.`);
        await refresh();
        onDone();
      } catch (err) { $('#sc-err', m).textContent = err.message; $('#sc-err', m).hidden = false; }
    };
  });
}

function openEpicForm(e, onDone) {
  const colors = S.meta.enums.epicColors;
  const cur = e ? e.color : colors[S.work.epics.length % colors.length];
  const html = `<form id="ef-form">
    <header><h2>${e ? '에픽 수정' : '에픽 만들기'}</h2><p>여러 작업을 하나의 목표로 묶어요.</p></header>
    <div class="m-body">
      <div class="field"><label class="label" for="ef-title">이름<span class="req">*</span></label><input class="input" id="ef-title" maxlength="120" value="${esc(e ? e.title : '')}" placeholder="예: 12월 시즌 프로모션"></div>
      <div class="field"><label class="label" for="ef-desc">설명</label><textarea class="textarea" id="ef-desc" rows="3" maxlength="2000">${esc(e ? e.description : '')}</textarea></div>
      <div class="field"><span class="label">색</span><div class="swatches">${colors.map((c) => `<label style="--c:${c}"><input type="radio" name="ef-color" value="${c}" ${c === cur ? 'checked' : ''} aria-label="색 ${c}"><span></span></label>`).join('')}</div></div>
      <div class="err-box" id="ef-err" hidden></div>
    </div>
    <footer><button type="button" class="btn" data-mclose>취소</button><button class="btn primary" type="submit">${e ? '저장' : '에픽 만들기'}</button></footer>
  </form>`;
  openModal(html, (m) => {
    $('#ef-form', m).onsubmit = async (ev) => {
      ev.preventDefault();
      const body = { title: $('#ef-title', m).value.trim(), description: $('#ef-desc', m).value, color: ($('input[name="ef-color"]:checked', m) || {}).value };
      if (!body.title) { $('#ef-err', m).textContent = '에픽 이름을 입력해 주세요.'; $('#ef-err', m).hidden = false; return; }
      try {
        if (e) await api('PATCH', `/api/epics/${e.id}`, body);
        else await api('POST', '/api/epics', body);
        closeModal();
        toast(e ? '에픽을 저장했어요.' : `에픽 '${body.title}'을(를) 만들었어요.`);
        await refresh();
        onDone();
      } catch (err) { $('#ef-err', m).textContent = err.message; $('#ef-err', m).hidden = false; }
    };
  });
}

// ───────────────────────── 작업 상세 (드로어) ─────────────────────────
async function openTaskDrawer(id) {
  const root = $('#drawer-root');
  root.innerHTML = `<div class="overlay" data-close></div><aside class="drawer wide" role="dialog" aria-modal="true" aria-label="작업 상세">
    <div class="d-body"><div class="empty">불러오는 중…</div></div></aside>`;
  $$('[data-close]', root).forEach((b) => (b.onclick = closeDrawer));
  if (!has('work.view')) { $('.d-body', root).innerHTML = '<div class="empty">작업 관리를 볼 권한이 없어요.</div>'; return; }
  try {
    const t = await api('GET', `/api/tasks/${id}`);
    if (S.detail && S.detail.kind === 't' && S.detail.id === id) renderTaskDrawer(t);
  } catch (e) {
    if (S.detail && S.detail.id === id) $('.d-body', root).innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function taskGithubHtml(t) {
  const g = t.github;
  let issue;
  if (g && g.url) issue = `<div class="gh-line">이슈 <a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.repo)}#${g.number}</a><span class="muted" style="font-size:12px">· 상태·제목·댓글을 양쪽에서 맞춰요</span></div>`;
  else if (!S.meta.integrations.github) issue = '<div class="gh-line muted">GitHub 연동 전이에요. 관리자가 설정하면 작업마다 이슈가 만들어져요.</div>';
  else if (g && g.error) issue = `<div class="gh-line"><span style="color:var(--danger)">이슈를 만들지 못했어요</span>${has('work.edit') ? '<button class="btn sm" data-act="gh-retry">다시 만들기</button>' : ''}</div><small class="muted">${esc(g.error)}</small>`;
  else issue = '<div class="gh-line muted">이슈 만드는 중…</div>';
  const prs = (t.prs || []).map((p) => `<div class="gh-line"><span class="pr-state pr-${esc(p.state)}">${esc(p.state)}</span><a href="${esc(p.url)}" target="_blank" rel="noopener">#${p.number}</a><span>${esc(p.title)}</span></div>`).join('');
  return issue + (prs || `<p class="hint">PR 제목이나 본문에 <span class="key">${esc(t.key)}</span>를 적으면 여기에 연결돼요. PR이 열리면 '리뷰', 머지되면 '완료'로 바뀌어요.</p>`);
}

function renderTaskDrawer(t) {
  const root = $('#drawer-root');
  const edit = has('work.edit'), dis = edit ? '' : 'disabled';
  const req = t.requestId ? S.requests.find((r) => r.id === t.requestId) : null;
  const scrollTop = ($('.d-split > .d-body', root) || {}).scrollTop || 0;
  root.innerHTML = `<div class="overlay" data-close></div>
  <aside class="drawer wide" role="dialog" aria-modal="true" aria-label="작업 상세">
    <div class="d-head">
      <div class="row"><span class="key">${esc(t.key)}</span>
        <select class="select sm ${STATUS_CLASS[t.status]}" id="tp-status" ${dis} aria-label="상태" style="font-weight:700;border-color:transparent">${TASK_STATUSES.map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        ${t.requestId ? `<a class="key" href="#/r/${t.requestId}" title="연결된 요청">↳ REQ-${t.requestId}</a>` : ''}
        <button class="btn ghost sm close" data-close aria-label="닫기">✕ 닫기</button></div>
      <input class="title-input" id="tp-title" value="${esc(t.title)}" maxlength="200" ${dis} aria-label="작업 제목">
      <div class="sub">${esc(t.createdBy ? t.createdBy.name : '')} 님이 만듦 · <span class="mono">${fmtDateTime(t.createdAt)}</span> · 최근 변경 ${ago(t.updatedAt)}</div>
    </div>
    <div class="d-split">
      <div class="d-body">
        <section class="sec"><h3>설명</h3>
          <textarea class="textarea" id="tp-desc" rows="5" maxlength="10000" ${dis} placeholder="무엇을 하면 끝나는지 적어 주세요.">${esc(t.description)}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn sm primary" id="tp-desc-save" hidden>설명 저장</button></div></section>
        <section class="sec"><h3>GitHub</h3><div class="gh-box">${taskGithubHtml(t)}</div></section>
        ${t.requestId ? `<section class="sec"><h3>연결된 요청</h3><div class="mini-list"><a href="#/r/${t.requestId}"><span class="key">REQ-${t.requestId}</span><span class="grow">${esc(req ? req.title : '')}</span>${req ? statusBadge(req.status) : ''}</a></div></section>` : ''}
        <section class="sec"><h3>기록</h3>
          <div class="timeline">${t.timeline.map(tlItem).join('')}</div>
          <form class="comment-form" id="tc-comment">
            <textarea class="textarea" rows="2" maxlength="3000" aria-label="댓글" placeholder="댓글을 남기면 GitHub 이슈에도 함께 달려요."></textarea>
            <div class="row"><button class="btn primary sm" type="submit">댓글 남기기</button></div>
          </form>
        </section>
      </div>
      <div class="d-props">
        <label class="prop"><span>담당자</span><select class="select" data-prop="assignee" ${dis}>${userOptions(t.assignee)}</select></label>
        <label class="prop"><span>스프린트</span><select class="select" data-prop="sprintId" ${dis}>${sprintOptions(t.sprintId)}</select></label>
        <label class="prop"><span>에픽</span><select class="select" data-prop="epicId" ${dis}>${epicOptions(t.epicId)}</select></label>
        <label class="prop"><span>우선순위</span><select class="select" data-prop="priority" ${dis}>${prioOptions(t.priority)}</select></label>
        <label class="prop"><span>스토리 포인트</span><input class="input mono" type="number" min="0" max="100" step="0.5" data-prop="points" value="${t.points ?? ''}" ${dis}></label>
        <label class="prop"><span>직군</span><select class="select" data-prop="job" ${dis}>${jobOptions(t.job)}</select></label>
        <label class="prop"><span>마감일</span><input class="input" type="date" data-prop="dueDate" value="${esc(t.dueDate || '')}" ${dis}></label>
        <label class="prop"><span>라벨 (쉼표로 구분)</span><input class="input" data-prop="labels" value="${esc((t.labels || []).join(', '))}" ${dis} placeholder="예: 웹, 성능"></label>
        ${!(t.github && t.github.number) && (S.work.repos || []).length ? `<label class="prop"><span>GitHub 저장소</span><select class="select" data-prop="repo" ${dis}><option value="">기본 저장소</option>${S.work.repos.map((r) => `<option ${r === t.repo ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>` : ''}
        ${has('work.plan') ? '<div style="margin-top:auto;padding-top:12px"><button class="btn danger sm" id="tp-delete">작업 삭제</button></div>' : ''}
      </div>
    </div>
  </aside>`;
  const body = $('.d-split > .d-body', root);
  if (body) body.scrollTop = scrollTop;
  $$('[data-close]', root).forEach((b) => (b.onclick = closeDrawer));

  const save = async (patch, msg) => {
    try {
      const fresh = await api('PATCH', `/api/tasks/${t.id}`, patch);
      const local = S.work.tasks.find((x) => x.id === t.id);
      if (local) Object.assign(local, fresh);
      if (msg) toast(msg);
      if (S.detail && S.detail.kind === 't' && S.detail.id === t.id) renderTaskDrawer(fresh);
      refreshSafe();
    } catch (e) { toast(e.message, true); renderTaskDrawer(t); }
  };

  if (!edit) { bindTaskComment(t); return; }
  $('#tp-status').onchange = (e) => save({ status: e.target.value }, `상태를 '${e.target.value}'(으)로 바꿨어요.`);
  const title = $('#tp-title');
  title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
  title.onchange = () => { const v = title.value.trim(); if (v && v !== t.title) save({ title: v }, '제목을 바꿨어요.'); else title.value = t.title; };
  const desc = $('#tp-desc'), descBtn = $('#tp-desc-save');
  desc.oninput = () => { descBtn.hidden = desc.value === t.description; };
  descBtn.onclick = () => save({ description: desc.value }, '설명을 저장했어요.');
  $$('[data-prop]', root).forEach((el) => {
    el.onchange = () => {
      const k = el.dataset.prop;
      let v = el.value;
      if (k === 'labels') v = v.split(',').map((x) => x.trim()).filter(Boolean);
      else if (k === 'points') v = v === '' ? null : Number(v);
      else if (k === 'epicId' || k === 'sprintId') v = v === '' ? null : Number(v);
      else if (v === '') v = k === 'job' || k === 'repo' ? '' : null;
      save({ [k]: v });
    };
  });
  const gh = $('[data-act="gh-retry"]', root);
  if (gh) gh.onclick = async () => {
    gh.disabled = true;
    try { const fresh = await api('POST', `/api/tasks/${t.id}/github-sync`, {}); renderTaskDrawer(fresh); toast('GitHub 이슈를 다시 만들었어요.'); }
    catch (e) { toast(e.message, true); gh.disabled = false; }
  };
  const del = $('#tp-delete');
  if (del) del.onclick = () => openModal(`<header><h2>${esc(t.key)} 삭제</h2><p>삭제하면 되돌릴 수 없어요. GitHub 이슈는 '계획 안 함'으로 닫혀요.</p></header>
    <div class="m-body"><div class="mini-list"><div><span class="key">${esc(t.key)}</span><span class="grow">${esc(t.title)}</span></div></div></div>
    <footer><button class="btn" data-mclose>취소</button><button class="btn danger" id="del-ok">작업 삭제</button></footer>`, (m) => {
    $('#del-ok', m).onclick = async () => {
      try {
        await api('DELETE', `/api/tasks/${t.id}`, {});
        closeModal();
        toast(`${t.key} 작업을 삭제했어요.`);
        S.work.tasks = S.work.tasks.filter((x) => x.id !== t.id);
        closeDrawer();
      } catch (e) { toast(e.message, true); }
    };
  });
  bindTaskComment(t);
}

function bindTaskComment(t) {
  const form = $('#tc-comment');
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const ta = $('textarea', form);
    const text = ta.value.trim();
    if (!text) return;
    const btn = $('button', form);
    btn.disabled = true;
    try {
      const fresh = await api('POST', `/api/tasks/${t.id}/comments`, { text });
      toast('댓글을 남겼어요.');
      renderTaskDrawer(fresh);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}
