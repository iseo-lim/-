'use strict';
/* 버전 관리: 플랫폼별 배포 레인 · 버전 상세 · 버전 만들기 · 배포 완료 */

const byPlanned = (a, b) => (a.plannedDate || '9999').localeCompare(b.plannedDate || '9999') || a.id - b.id;
const byReleased = (a, b) => (b.releasedDate || b.updatedAt || '').localeCompare(a.releasedDate || a.updatedAt || '') || b.id - a.id;
const HISTORY_LIMIT = 4;
const expanded = new Set();

function vDateLine(v) {
  if (v.status === '배포 완료') return v.releasedDate ? `<span class="mono">${fmtDay(v.releasedDate)}</span> 배포` : '배포 완료';
  if (v.status === '취소') return '취소됨';
  if (!v.plannedDate) return '배포일 미정';
  const d = daysLeft(v.plannedDate);
  return `<span class="mono">${fmtDay(v.plannedDate)}</span> 예정 · <b class="${d < 0 ? 'late' : ''}">${dueText(v.plannedDate)}</b>`;
}

function vCard(v) {
  const reqs = v.requests || [];
  const shown = reqs.slice(0, 3);
  return `<a class="vcard${v.status === '배포 완료' ? ' shipped' : ''}${v.status === '취소' ? ' cancelled' : ''}" href="#/v/${v.id}">
    <span class="node" aria-hidden="true"></span>
    <div class="vtop"><span class="vnum">${esc(vName(v.version))}</span>${statusBadge(v.status)}</div>
    <div class="vdate">${vDateLine(v)}</div>
    ${reqs.length ? `${reqMeter(reqs, { legend: false })}
      <ul class="vreqs">${shown.map((r) => `<li><span class="key">REQ-${r.id}</span><span class="t">${esc(r.title)}</span></li>`).join('')}</ul>
      ${reqs.length > shown.length ? `<div class="more">외 ${reqs.length - shown.length}건</div>` : ''}` : '<div class="vempty">담긴 요청이 없어요</div>'}
  </a>`;
}

function viewVersions(main) {
  const manage = has('version.manage');
  const P = S.meta.enums.versionPlatforms;
  main.innerHTML = `
    <div class="page-head">
      <div><div class="crumb">배포 / 버전 관리</div><h1>버전 관리</h1>
        <p>앱·바리스온·키오스크 버전마다 어떤 요청이 담겨 언제 배포되는지 봐요. 배포 완료로 바꾸면 담긴 요청이 완료되고 요청자에게 알림이 가요.</p></div>
      ${manage ? '<div class="toolbar"><button class="btn primary" id="v-new">+ 버전 만들기</button></div>' : ''}
    </div>
    <div class="lanes">${P.map((p) => {
      const list = S.versions.filter((v) => v.platform === p);
      const upcoming = list.filter((v) => UPCOMING.includes(v.status)).sort(byPlanned);
      const history = list.filter((v) => !UPCOMING.includes(v.status)).sort(byReleased);
      const live = history.find((v) => v.status === '배포 완료');
      const hist = expanded.has(p) ? history : history.slice(0, HISTORY_LIMIT);
      return `<section class="lane panel">
        <header>
          <h2>${esc(p)}</h2>
          ${live ? `<a class="live" href="#/v/${live.id}" title="지금 운영 중인 버전"><i></i>운영 중 <b>${esc(vName(live.version))}</b></a>` : '<span class="live none">운영 버전 없음</span>'}
          ${manage ? `<button class="btn sm ghost" data-new-in="${esc(p)}" aria-label="${esc(p)} 버전 만들기">+ 버전</button>` : ''}
        </header>
        <div class="rail">
          <div class="rail-h">다가오는 배포 <span>${upcoming.length}</span></div>
          ${upcoming.map(vCard).join('') || `<div class="rail-empty">${manage ? '예정된 버전이 없어요. 위 + 버전으로 만들어 주세요.' : '예정된 버전이 없어요.'}</div>`}
          <div class="rail-h past">배포 기록 <span>${history.length}</span></div>
          ${hist.map(vCard).join('') || '<div class="rail-empty">아직 배포 기록이 없어요.</div>'}
          ${history.length > HISTORY_LIMIT ? `<button class="btn sm ghost more-btn" data-more="${esc(p)}">${expanded.has(p) ? '접기' : `이전 버전 ${history.length - HISTORY_LIMIT}개 더 보기`}</button>` : ''}
        </div>
      </section>`;
    }).join('')}</div>`;

  const nb = $('#v-new');
  if (nb) nb.onclick = () => openVersionCreate();
  $$('[data-new-in]', main).forEach((b) => (b.onclick = () => openVersionCreate(b.dataset.newIn)));
  $$('[data-more]', main).forEach((b) => (b.onclick = () => {
    const p = b.dataset.more;
    if (expanded.has(p)) expanded.delete(p); else expanded.add(p);
    viewVersions(main);
  }));
}

// 다음 버전 번호 추천: 마지막 버전의 가운데 자리를 하나 올림 (2.3.0 → 2.4.0)
// 월 단위 버전(바리스온 2026-11)은 다음 달로 (회사 규칙: 배포 산출물이 없는 프로젝트는 월 트레인)
function suggestVersion(platform) {
  const list = S.versions.filter((v) => v.platform === platform && v.status !== '취소').map((v) => v.version);
  const months = list.filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();
  if (months.length) {
    const [y, m] = months[months.length - 1].split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  }
  const nums = list.map((s) => s.split('.').map((x) => parseInt(x, 10))).filter((a) => a.every((n) => Number.isFinite(n)));
  if (!nums.length) return '';
  nums.sort((a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; });
  const top = nums[nums.length - 1];
  const next = [top[0], (top[1] || 0) + 1, ...top.slice(2).map(() => 0)];
  return next.join('.');
}

function openVersionCreate(platform = '') {
  const P = S.meta.enums.versionPlatforms;
  const sel = platform || P[0];
  const html = `<form id="vc-form">
    <header><h2>버전 만들기</h2><p>요청을 담을 다음 배포 버전을 만들어요.</p></header>
    <div class="m-body">
      <div class="field"><span class="label">플랫폼<span class="req">*</span></span><div class="chips">${P.map((p) =>
        `<label class="chip"><input type="radio" name="vc-platform" value="${esc(p)}" ${p === sel ? 'checked' : ''}><span>${esc(p)}</span></label>`).join('')}</div></div>
      <div class="grid-2">
        <div class="field"><label class="label" for="vc-version">버전<span class="req">*</span></label><input class="input mono" id="vc-version" maxlength="30" placeholder="5.2.0" value="${esc(suggestVersion(sel))}"></div>
        <div class="field"><label class="label" for="vc-date">배포 예정일</label><input class="input" type="date" id="vc-date"></div>
      </div>
      <div class="field"><label class="label" for="vc-status">상태</label><select class="select" id="vc-status">${['계획', '개발 중', 'QA'].map((s) => `<option>${s}</option>`).join('')}</select></div>
      <div class="err-box" id="vc-err" hidden></div>
    </div>
    <footer><button type="button" class="btn" data-mclose>취소</button><button class="btn primary" type="submit">버전 만들기</button></footer>
  </form>`;
  openModal(html, (m) => {
    $$('input[name="vc-platform"]', m).forEach((i) => (i.onchange = () => { $('#vc-version', m).value = suggestVersion(i.value); }));
    setTimeout(() => $('#vc-version', m).select(), 0);
    $('#vc-form', m).onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        platform: ($('input[name="vc-platform"]:checked', m) || {}).value,
        version: $('#vc-version', m).value.trim(), plannedDate: $('#vc-date', m).value || null, status: $('#vc-status', m).value,
      };
      if (!body.version) { $('#vc-err', m).textContent = '버전을 입력해 주세요. 예: 5.2.0'; $('#vc-err', m).hidden = false; return; }
      try {
        const v = await api('POST', '/api/versions', body);
        closeModal();
        toast(`${vLabel(v)} 버전을 만들었어요.`);
        S.lastView = 'versions';
        location.hash = '#/v/' + v.id;
      } catch (err) { $('#vc-err', m).textContent = err.message; $('#vc-err', m).hidden = false; }
    };
  });
}

// ───────────────────────── 버전 상세 (드로어) ─────────────────────────
async function openVersionDrawer(id) {
  const root = $('#drawer-root');
  root.innerHTML = `<div class="overlay" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="버전 상세">
    <div class="d-body"><div class="empty">불러오는 중…</div></div></aside>`;
  $$('[data-close]', root).forEach((b) => (b.onclick = closeDrawer));
  try {
    const v = await api('GET', `/api/versions/${id}`);
    if (S.detail && S.detail.kind === 'v' && S.detail.id === id) renderVersionDrawer(v);
  } catch (e) {
    if (S.detail && S.detail.id === id) $('.d-body', root).innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// 담긴 요청으로 릴리스 노트 초안 만들기
function draftNotes(v) {
  const reqs = v.requests;
  const fixes = reqs.filter((r) => r.type === '버그·오류');
  const rest = reqs.filter((r) => r.type !== '버그·오류');
  const line = (r) => `- ${r.title} (REQ-${r.id})`;
  return [
    ...(rest.length ? ['새로워진 점', ...rest.map(line)] : []),
    ...(rest.length && fixes.length ? [''] : []),
    ...(fixes.length ? ['고친 점', ...fixes.map(line)] : []),
  ].join('\n');
}

function renderVersionDrawer(v) {
  const root = $('#drawer-root');
  const manage = has('version.manage');
  const shipped = v.status === '배포 완료';
  const inIds = new Set(v.requests.map((r) => r.id));
  // 담을 수 있는 요청: 같은 플랫폼 · 끝나지 않음 · 아직 이 버전에 없음
  const candidates = S.requests.filter((r) => !r.restricted && r.platforms.includes(v.platform) && !inIds.has(r.id) && !['완료', '반려'].includes(r.status)).sort(byPriority);
  const statusOpts = S.meta.enums.versionStatuses;

  root.innerHTML = `<div class="overlay" data-close></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-label="버전 상세">
    <div class="d-head">
      <div class="row"><span class="tag">${esc(v.platform)}</span>${statusBadge(v.status)}<button class="btn ghost sm close" data-close aria-label="닫기">✕ 닫기</button></div>
      <h2 class="vtitle"><span class="p">${esc(v.platform)}</span> ${esc(vName(v.version))}</h2>
      <div class="sub">${vDateLine(v)} · ${esc(v.createdBy ? v.createdBy.name : '')} 님이 만듦</div>
    </div>
    <div class="d-body">
      ${manage && UPCOMING.includes(v.status) ? `<div class="release-bar"><div><b>배포가 끝났나요?</b><span>담긴 요청 ${v.requests.length}건이 완료되고 요청자에게 슬랙 알림이 가요.</span></div><button class="btn primary" id="v-release">배포 완료로 표시</button></div>` : ''}
      ${manage ? `<section class="manage"><h3>버전 정보</h3>
        <div class="grid-2">
          <div class="field"><label class="label" for="vf-version">버전</label><input class="input mono" id="vf-version" maxlength="30" value="${esc(v.version)}"></div>
          <div class="field"><label class="label" for="vf-status">상태</label><select class="select" id="vf-status">${statusOpts.map((s) => `<option ${s === v.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label class="label" for="vf-planned">배포 예정일</label><input class="input" type="date" id="vf-planned" value="${esc(v.plannedDate || '')}"></div>
          <div class="field"><label class="label" for="vf-released">배포일</label><input class="input" type="date" id="vf-released" value="${esc(v.releasedDate || '')}" ${shipped ? '' : 'disabled title="배포 완료 후에 적어요"'}></div>
        </div>
        <div><button class="btn" id="vf-save">버전 정보 저장</button></div>
      </section>` : `<dl class="kv">
        <div><dt>상태</dt><dd>${esc(v.status)}</dd></div>
        <div><dt>배포 예정일</dt><dd>${v.plannedDate ? `<span class="mono">${fmtDay(v.plannedDate)}</span>` : '-'}</dd></div>
        <div><dt>배포일</dt><dd>${v.releasedDate ? `<span class="mono">${fmtDay(v.releasedDate)}</span>` : '-'}</dd></div>
      </dl>`}

      <section class="sec"><h3>담긴 요청 <span class="muted mono" style="font-weight:400">${v.requests.length}</span></h3>
        ${v.requests.length ? `${reqMeter(v.requests)}<div class="mini-list" style="margin-top:10px">${v.requests.map((r) => {
          const inner = `<span class="key">REQ-${r.id}</span><span class="grow">${esc(r.title)}</span>${prioBadge(r.priority)}${statusBadge(r.status)}`;
          const rm = manage ? `<button class="btn ghost sm" data-rm="${r.id}" aria-label="REQ-${r.id} 빼기" title="이 버전에서 빼기">빼기</button>` : '';
          return r.restricted ? `<div title="다른 팀 요청">${inner}<small class="muted">${esc(r.requesterTeam)}</small></div>` : `<div class="row-link"><a href="#/r/${r.id}">${inner}</a>${rm}</div>`;
        }).join('')}</div>` : '<p class="muted" style="font-size:13px">아직 담긴 요청이 없어요.</p>'}
        ${manage && v.status !== '취소' ? `<div class="add-req">
          <select class="select" id="v-add-sel" aria-label="담을 요청" ${candidates.length ? '' : 'disabled'}>
            ${candidates.length ? `<option value="">${esc(v.platform)} 요청 중에서 고르기 (${candidates.length}건)</option>${candidates.map((r) => `<option value="${r.id}">REQ-${r.id} · ${r.priority || '–'} · ${esc(r.title)}${r.versions.some((x) => x.platform === v.platform) ? ` (지금 ${esc(vName(r.versions.find((x) => x.platform === v.platform).version))})` : ''}</option>`).join('')}` : `<option>담을 수 있는 ${esc(v.platform)} 요청이 없어요</option>`}
          </select>
          <button class="btn" id="v-add" ${candidates.length ? '' : 'disabled'}>담기</button>
        </div>` : ''}
      </section>

      <section class="sec"><h3>릴리스 노트 ${manage && v.requests.length ? '<button class="btn sm ghost right" id="vn-draft">담긴 요청으로 초안 만들기</button>' : ''}</h3>
        ${manage ? `<textarea class="textarea" id="vn-text" rows="6" maxlength="5000" placeholder="이 버전에서 무엇이 바뀌었는지 적어 주세요.">${esc(v.notes)}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn sm primary" id="vn-save" hidden>노트 저장</button></div>`
          : `<div class="body notes">${v.notes ? esc(v.notes) : '<span class="muted">아직 릴리스 노트가 없어요.</span>'}</div>`}
      </section>

      <section class="sec"><h3>기록</h3><div class="timeline">${(v.timeline || []).map((t) => t.type === 'created'
        ? `<div class="tl"><span class="ic">+</span><span><b>${esc(t.by.name)}</b> 님이 만들었어요</span><span class="when" title="${fmtDateTime(t.at)}">${ago(t.at)}</span></div>`
        : tlItem(t)).join('')}</div></section>
    </div>
  </aside>`;

  $$('[data-close]', root).forEach((b) => (b.onclick = closeDrawer));
  const reload = async (msg) => {
    if (msg) toast(msg);
    const fresh = await api('GET', `/api/versions/${v.id}`);
    await refresh().catch(() => {});
    if (S.detail && S.detail.kind === 'v' && S.detail.id === v.id) renderVersionDrawer(fresh);
    if (S.lastView === 'versions') renderView('versions');
  };
  if (!manage) return;

  const patch = async (body, msg, btn) => {
    if (btn) btn.disabled = true;
    try { await api('PATCH', `/api/versions/${v.id}`, body); await reload(msg); }
    catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
  };

  $('#vf-save').onclick = (e) => {
    const status = $('#vf-status').value;
    if (status === '배포 완료' && !shipped) return openReleaseConfirm(v, () => reload());
    patch({ version: $('#vf-version').value.trim(), status, plannedDate: $('#vf-planned').value || null, releasedDate: $('#vf-released').disabled ? undefined : $('#vf-released').value || null }, '버전 정보를 저장했어요.', e.target);
  };
  const rel = $('#v-release');
  if (rel) rel.onclick = () => openReleaseConfirm(v, () => reload());

  const notes = $('#vn-text'), notesBtn = $('#vn-save');
  notes.oninput = () => { notesBtn.hidden = notes.value === v.notes; };
  notesBtn.onclick = (e) => patch({ notes: notes.value }, '릴리스 노트를 저장했어요.', e.target);
  const draft = $('#vn-draft');
  if (draft) draft.onclick = () => {
    if (notes.value.trim() && !confirm('지금 적힌 노트를 초안으로 바꿀까요?')) return;
    notes.value = draftNotes(v);
    notesBtn.hidden = false;
    notes.focus();
  };

  const add = $('#v-add');
  if (add) add.onclick = async () => {
    const id = Number($('#v-add-sel').value);
    if (!id) return toast('담을 요청을 골라 주세요.', true);
    add.disabled = true;
    try { await api('POST', `/api/versions/${v.id}/requests`, { add: id }); await reload(`REQ-${id}을(를) ${vLabel(v)}에 담았어요.`); }
    catch (e) { toast(e.message, true); add.disabled = false; }
  };
  $$('[data-rm]', root).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api('POST', `/api/versions/${v.id}/requests`, { remove: Number(b.dataset.rm) }); await reload(`REQ-${b.dataset.rm}을(를) 이 버전에서 뺐어요.`); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

function openReleaseConfirm(v, onDone) {
  // 다른 플랫폼 버전이 아직 배포 전이면 이번 배포로는 완료되지 않아요
  const othersShipped = (r) => ((S.requests.find((x) => x.id === r.id) || {}).versions || [])
    .filter((x) => x.id !== v.id).every((x) => x.status === '배포 완료');
  const open = v.requests.filter((r) => !['완료', '반려', '보류'].includes(r.status) && othersShipped(r));
  const html = `<header><h2>${esc(vLabel(v))} 배포 완료</h2><p>배포일은 오늘(${fmtDay(today())})로 기록돼요. 나중에 버전 정보에서 고칠 수 있어요.</p></header>
    <div class="m-body">
      ${v.requests.length ? `<div class="note">담긴 요청 ${v.requests.length}건의 요청자에게 '반영돼 배포됐어요' 슬랙 알림이 가요.${open.length ? ` 그중 ${open.length}건은 '완료'로 바뀌어요.` : ''}</div>
        <div class="mini-list">${v.requests.map((r) => `<div><span class="key">REQ-${r.id}</span><span class="grow">${esc(r.title)}</span>${statusBadge(r.status)}${open.includes(r) ? '<span class="muted" style="font-size:12px">→ 완료</span>' : !othersShipped(r) ? '<span class="muted" style="font-size:12px">다른 플랫폼 배포 대기</span>' : ''}</div>`).join('')}</div>
        <p class="hint">여러 플랫폼에 걸친 요청은 다른 플랫폼 버전까지 모두 배포돼야 완료로 바뀌어요.</p>`
        : '<div class="note">담긴 요청이 없어요. 배포 기록만 남아요.</div>'}
    </div>
    <footer><button class="btn" data-mclose>취소</button><button class="btn primary" id="rel-ok">배포 완료로 표시</button></footer>`;
  openModal(html, (m) => {
    $('#rel-ok', m).onclick = async (e) => {
      e.target.disabled = true;
      try {
        await api('PATCH', `/api/versions/${v.id}`, { status: '배포 완료' });
        closeModal();
        toast(`${vLabel(v)} 배포 완료로 표시했어요. 요청자에게 알림을 보냈어요.`);
        onDone();
      } catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
  });
}
