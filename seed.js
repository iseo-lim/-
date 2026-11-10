'use strict';
// 테스트(mock) 모드에서 `node server.js --seed`로 실행하면 데이터가 비어 있을 때 예시 데이터를 넣어요.

const DAY = 24 * 3600e3;

const REQUESTS = [
  {
    by: 'ops1', daysAgo: 0.2, title: '키오스크 카드 결제 후 영수증이 출력되지 않음',
    platforms: ['키오스크'], type: '버그·오류', jobs: ['개발'],
    description: '강남점 2번 키오스크에서 오늘 오전부터 카드 결제는 정상 완료되는데 영수증이 나오지 않습니다. 용지는 충분합니다.',
    reproSteps: '1. 메뉴 선택 후 카드 결제\n2. 결제 완료 화면까지 정상\n3. 영수증 출력 안 됨 (오류 메시지 없음)',
    urgency: '상', urgencyReason: '영수증을 요청하는 고객에게 수기로 써드리고 있어 점심 피크(11시 30분) 전에 해결이 필요해요.',
    importance: '중', importanceReason: '현재 확인된 건 강남점 1대지만 같은 기종이 12개 매장에 있어 확산될 수 있어요.',
  },
  {
    by: 'cs1', daysAgo: 1, title: '앱 쿠폰함에 만료된 쿠폰이 계속 노출됨',
    platforms: ['앱'], type: '버그·오류', jobs: ['개발'],
    description: '유효기간이 지난 쿠폰이 쿠폰함 상단에 계속 보여서 "쿠폰이 안 써진다"는 문의가 하루 10건 이상 들어옵니다.',
    urgency: '중', urgencyReason: '당장 결제가 막히진 않지만 CS 문의가 계속 쌓이고 있어요.',
    importance: '상', importanceReason: '앱 사용자 전체에게 노출되고, 문의 응대에 CS 인력 1명이 반나절씩 쓰고 있어요.',
  },
  {
    by: 'ops1', daysAgo: 4, title: '웹·앱 메인 배너를 12월 시즌 프로모션으로 교체',
    platforms: ['웹', '앱'], type: '디자인', jobs: ['디자인', '개발'], dueDate: 14,
    description: '12월 1일부터 시작하는 시즌 프로모션 배너로 웹·앱 메인 배너 교체 요청드립니다. 문구는 마케팅팀에서 확정했습니다.',
    urgency: '중', urgencyReason: '12월 1일 프로모션 시작 전에 반영돼야 해요.',
    importance: '중', importanceReason: '시즌 매출 목표와 연결된 프로모션이라 노출이 중요해요.',
    status: '진행 중', priority: 'P1', assignees: ['design1', 'dev1'],
  },
  {
    by: 'opslead', daysAgo: 6, title: '키오스크 신메뉴 3종 이미지·가격 등록',
    platforms: ['키오스크'], type: '데이터·운영 지원', jobs: ['개발'],
    description: '다음 주 출시 신메뉴 3종의 이미지와 가격을 키오스크에 등록해 주세요. 이미지 파일은 공유 드라이브에 올려두었습니다.',
    urgency: '상', urgencyReason: '다음 주 월요일 출시라 금요일까지 반영돼야 매장 테스트가 가능해요.',
    importance: '상', importanceReason: '전 매장 동시 출시 메뉴예요.',
    status: '진행 중', priority: 'P0', assignees: ['dev2'], targetVersion: 'kiosk 3.4.0',
  },
  {
    by: 'cs1', daysAgo: 12, title: '웹 회원가입 약관 문구 수정',
    platforms: ['웹'], type: '기능 개선', jobs: ['기획', '개발'],
    description: '법무 검토 결과에 따라 개인정보 수집 동의 문구를 수정해야 합니다.',
    urgency: '하', urgencyReason: '시행일이 다음 달 말이라 여유는 있어요.',
    importance: '상', importanceReason: '법적 요건이라 반드시 반영돼야 해요.',
    status: '완료', priority: 'P2', assignees: ['plan1', 'dev2'], targetVersion: 'web 2.18.0',
  },
  {
    by: 'ops1', daysAgo: 15, title: '앱 주문내역 엑셀 다운로드 기능',
    platforms: ['앱'], type: '신규 기능', jobs: ['기획'],
    description: '매장 점주님들이 월별 주문내역을 엑셀로 받고 싶다는 요청이 있습니다.',
    urgency: '하', urgencyReason: '급하진 않아요.',
    importance: '중', importanceReason: '점주 간담회에서 여러 번 나온 요청이에요.',
    status: '보류', statusReason: '어드민 개편(내년 1분기) 때 함께 검토하기로 했어요.', priority: 'P3', assignees: ['plan1'],
  },
];

const EPICS = [
  { title: '12월 시즌 프로모션', description: '웹·앱·키오스크 시즌 프로모션 노출과 쿠폰 정비', color: '#a8456f' },
  { title: '키오스크 안정화', description: '결제·출력·메뉴 데이터 관련 장애 줄이기', color: '#2f8f83' },
  { title: '법무·약관 대응', description: '개인정보·약관 관련 필수 변경', color: '#7a5bb8' },
];

// [요청 순번(1부터, 0=없음), 에픽 순번, 스프린트('done'|'active'|'next'|null), 제목, 직군, 담당, 포인트, 상태, 우선순위, 라벨]
const TASKS = [
  [3, 1, 'active', '시즌 배너 시안 3종 제작', '디자인', 'design1', 3, '완료', 'P1', ['배너']],
  [3, 1, 'active', '웹 메인 배너 영역 교체 배포', '개발', 'dev1', 2, '리뷰', 'P1', ['웹']],
  [3, 1, 'active', '앱 메인 배너 교체 및 원격 설정 반영', '개발', 'dev1', 3, '진행 중', 'P1', ['앱']],
  [4, 2, 'active', '신메뉴 3종 메뉴 데이터 등록', '개발', 'dev2', 2, '진행 중', 'P0', ['키오스크']],
  [4, 2, 'active', '신메뉴 이미지 키오스크 해상도 맞춤 리사이즈', '디자인', 'design1', 1, '할 일', 'P0', []],
  [0, 2, 'active', '키오스크 결제 로그 수집 대시보드', '개발', 'dev2', 5, '할 일', 'P2', ['모니터링']],
  [0, 1, 'next', '프로모션 쿠폰 발급 어드민 개선 기획', '기획', 'plan1', 3, '할 일', 'P2', ['어드민']],
  [0, 2, 'next', '키오스크 프린터 드라이버 업데이트 검토', '개발', 'dev2', 2, '할 일', 'P2', []],
  [0, 0, null, '앱 홈 진입 속도 개선 조사', '개발', null, 5, '할 일', 'P3', ['성능']],
  [0, 0, null, '디자인 시스템 버튼 컴포넌트 정리', '디자인', 'design1', 3, '할 일', 'P3', ['디자인시스템']],
  [5, 3, 'done', '약관 동의 문구 기획 확정', '기획', 'plan1', 1, '완료', 'P2', ['약관']],
  [5, 3, 'done', '회원가입 약관 문구 웹 반영', '개발', 'dev2', 2, '완료', 'P2', ['웹']],
];

function run({ db, today }) {
  const ref = Date.now();
  const iso = (daysAgo) => new Date(ref - daysAgo * DAY).toISOString();
  const lead = db.users.lead1 || Object.values(db.users)[0];
  const byLead = { memberId: lead.memberId, name: lead.name };

  // 요청
  for (const s of REQUESTS) {
    const u = db.users[s.by];
    if (!u) continue;
    const created = iso(s.daysAgo);
    const r = {
      id: ++db.seq, title: s.title, platforms: s.platforms, type: s.type, jobs: s.jobs, description: s.description,
      reproSteps: s.reproSteps || '', dueDate: s.dueDate ? today(s.dueDate) : null,
      urgency: s.urgency, urgencyReason: s.urgencyReason, importance: s.importance, importanceReason: s.importanceReason,
      attachments: [], requester: { memberId: u.memberId, name: u.name, team: u.team }, requesterTeam: u.team,
      status: '접수', statusReason: '', priority: null, assignees: [], targetVersion: '', github: null,
      createdAt: created, updatedAt: created,
      timeline: [{ type: 'created', at: created, by: { memberId: u.memberId, name: u.name } }],
    };
    if (s.status) {
      const at = iso(Math.max(0.1, s.daysAgo - 1));
      r.priority = s.priority;
      r.assignees = s.assignees || [];
      r.targetVersion = s.targetVersion || '';
      r.timeline.push({ type: 'priority', from: null, to: s.priority, at, by: byLead });
      r.timeline.push({ type: 'assignees', from: [], to: r.assignees, at, by: byLead });
      r.timeline.push({ type: 'status', from: '접수', to: s.status, reason: s.statusReason || '', at, by: byLead });
      r.status = s.status;
      r.statusReason = s.statusReason || '';
      r.updatedAt = at;
    }
    db.requests.push(r);
  }

  // 에픽
  for (const e of EPICS) {
    const id = ++db.epicSeq;
    db.epics.push({ id, key: `EP-${id}`, title: e.title, description: e.description, color: e.color, status: 'open', createdAt: iso(20), createdBy: byLead });
  }

  // 스프린트: 지난 스프린트(완료) · 진행 중 · 다음
  const mk = (name, goal, start, end, state) => {
    const id = ++db.sprintSeq;
    const s = { id, name, goal, startDate: today(start), endDate: today(end), state, createdAt: iso(-start + 2), createdBy: byLead, startedAt: state !== 'planned' ? iso(-start) : null, closedAt: state === 'closed' ? iso(-end) : null, summary: null };
    db.sprints.push(s);
    return s;
  };
  const sprints = {
    done: mk('스프린트 23', '약관 변경 반영', -17, -4, 'closed'),
    active: mk('스프린트 24', '시즌 프로모션 노출 준비 + 키오스크 신메뉴 출시', -3, 10, 'active'),
    next: mk('스프린트 25', '쿠폰·키오스크 운영 개선', 11, 24, 'planned'),
  };

  // 작업
  let rank = 0;
  for (const [reqNo, epicNo, sp, title, job, assignee, points, status, priority, labels] of TASKS) {
    const id = ++db.taskSeq;
    const created = iso(5);
    const t = {
      id, key: `TASK-${id}`, title, description: '', status, assignee, points, labels, dueDate: null, priority, job,
      epicId: epicNo ? epicNo : null, sprintId: sp ? sprints[sp].id : null, requestId: reqNo || null, repo: '',
      rank: ++rank, github: null, prs: [], createdBy: byLead, createdAt: created, updatedAt: created,
      timeline: [{ type: 'created', at: created, by: byLead }],
    };
    if (status !== '할 일') t.timeline.push({ type: 'field', field: 'status', label: '상태', from: '할 일', to: status, at: iso(1), by: assignee ? { memberId: assignee, name: db.users[assignee].name } : byLead });
    db.tasks.push(t);
  }
  const closed = db.tasks.filter((t) => t.sprintId === sprints.done.id);
  sprints.done.summary = { total: closed.length, done: closed.length, points: closed.reduce((s, t) => s + t.points, 0), donePoints: closed.reduce((s, t) => s + t.points, 0) };

  console.log(`[seed] 요청 ${db.requests.length}건, 작업 ${db.tasks.length}건, 에픽 ${db.epics.length}개, 스프린트 ${db.sprints.length}개를 넣었어요.`);
}

module.exports = { run };
