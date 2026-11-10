'use strict';
// 테스트(mock) 모드에서 `node server.js --seed`로 실행하면 데이터가 비어 있을 때 예시 데이터를 넣어요.

const DAY = 24 * 3600e3;

// [플랫폼, 버전, 상태, 예정일(오늘 기준 일수), 배포일(오늘 기준 일수), 릴리스 노트]
const VERSIONS = [
  ['앱', '2.2.1', '배포 완료', -16, -15, '고친 점\n- 주문 내역 화면 속도 개선\n- 로그인 유지 오류 수정'],
  ['앱', '2.3.0', 'QA', 5, null, ''],
  ['앱', '2.4.0', '계획', 26, null, ''],
  ['바리스온', '2026-10', '배포 완료', -12, -10, '기능 개선\n- 회원가입 약관 문구 변경 (법무 검토 반영)'],
  ['바리스온', '2026-11', '개발 중', 20, null, ''],
  ['키오스크', '1.8.8', '배포 완료', -20, -20, '고친 점\n- 카드 단말기 연결 끊김 시 재시도'],
  ['키오스크', '1.8.9', '개발 중', 3, null, ''],
];

// v: 담을 버전 ['앱 5.2.0', ...]
const REQUESTS = [
  {
    by: 'ops1', daysAgo: 0.2, title: '키오스크 카드 결제 후 영수증이 출력되지 않음',
    platforms: ['키오스크'], type: '버그', jobs: ['개발'],
    description: '강남점 2번 키오스크에서 오늘 오전부터 카드 결제는 정상 완료되는데 영수증이 나오지 않습니다. 용지는 충분합니다.',
    reproSteps: '1. 메뉴 선택 후 카드 결제\n2. 결제 완료 화면까지 정상\n3. 영수증 출력 안 됨 (오류 메시지 없음)',
    urgency: '상', urgencyReason: '영수증을 요청하는 고객에게 수기로 써드리고 있어 점심 피크(11시 30분) 전에 해결이 필요해요.',
    importance: '중', importanceReason: '현재 확인된 건 강남점 1대지만 같은 기종이 12개 매장에 있어 확산될 수 있어요.',
  },
  {
    by: 'cs1', daysAgo: 1, title: '앱 쿠폰함에 만료된 쿠폰이 계속 노출됨',
    platforms: ['앱'], type: '버그', jobs: ['개발'],
    description: '유효기간이 지난 쿠폰이 쿠폰함 상단에 계속 보여서 "쿠폰이 안 써진다"는 문의가 하루 10건 이상 들어옵니다.',
    urgency: '중', urgencyReason: '당장 결제가 막히진 않지만 CS 문의가 계속 쌓이고 있어요.',
    importance: '상', importanceReason: '앱 사용자 전체에게 노출되고, 문의 응대에 CS 인력 1명이 반나절씩 쓰고 있어요.',
  },
  {
    by: 'ops1', daysAgo: 4, title: '바리스온·앱 메인 배너를 12월 시즌 프로모션으로 교체',
    platforms: ['바리스온', '앱'], type: '기능 개선', jobs: ['디자인', '개발'], dueDate: 14,
    description: '12월 1일부터 시작하는 시즌 프로모션 배너로 바리스온·앱 메인 배너 교체 요청드립니다. 문구는 마케팅팀에서 확정했습니다.',
    urgency: '중', urgencyReason: '12월 1일 프로모션 시작 전에 반영돼야 해요.',
    importance: '중', importanceReason: '시즌 매출 목표와 연결된 프로모션이라 노출이 중요해요.',
    status: '기획·디자인', priority: 'P1', assignees: ['design1', 'dev1'], v: ['앱 2.3.0', '바리스온 2026-11'],
  },
  {
    by: 'opslead', daysAgo: 6, title: '키오스크 신메뉴 3종 이미지·가격 등록',
    platforms: ['키오스크'], type: '운영 지원', jobs: ['개발'],
    description: '다음 주 출시 신메뉴 3종의 이미지와 가격을 키오스크에 등록해 주세요. 이미지 파일은 공유 드라이브에 올려두었습니다.',
    urgency: '상', urgencyReason: '다음 주 월요일 출시라 금요일까지 반영돼야 매장 테스트가 가능해요.',
    importance: '상', importanceReason: '전 매장 동시 출시 메뉴예요.',
    status: '개발', priority: 'P0', assignees: ['dev2'], v: ['키오스크 1.8.9'],
  },
  {
    by: 'cs1', daysAgo: 12, title: '바리스온 회원가입 약관 문구 수정',
    platforms: ['바리스온'], type: '기능 개선', jobs: ['기획', '개발'],
    description: '법무 검토 결과에 따라 개인정보 수집 동의 문구를 수정해야 합니다.',
    urgency: '하', urgencyReason: '시행일이 다음 달 말이라 여유는 있어요.',
    importance: '상', importanceReason: '법적 요건이라 반드시 반영돼야 해요.',
    status: '완료', statusReason: '바리스온 2026-10 배포', priority: 'P2', assignees: ['plan1', 'dev2'], v: ['바리스온 2026-10'],
  },
  {
    by: 'ops1', daysAgo: 15, title: '앱 주문내역 엑셀 다운로드 기능',
    platforms: ['앱'], type: '신규 기능', jobs: ['기획'],
    description: '매장 점주님들이 월별 주문내역을 엑셀로 받고 싶다는 요청이 있습니다.',
    urgency: '하', urgencyReason: '급하진 않아요.',
    importance: '중', importanceReason: '점주 간담회에서 여러 번 나온 요청이에요.',
    status: '보류', statusReason: '어드민 개편(내년 1분기) 때 함께 검토하기로 했어요.', priority: 'P3', assignees: ['plan1'],
  },
  {
    by: 'cs1', daysAgo: 7, title: '앱 푸시 알림 수신 설정이 저장되지 않음',
    platforms: ['앱'], type: '버그', jobs: ['개발'],
    description: '마케팅 푸시 수신을 끄고 앱을 다시 열면 다시 켜져 있다는 문의가 있습니다.',
    urgency: '중', urgencyReason: '수신 거부를 했는데 푸시가 온다는 민원으로 이어질 수 있어요.',
    importance: '상', importanceReason: '정보통신망법 관련 이슈가 될 수 있어요.',
    status: 'QA', priority: 'P1', assignees: ['dev1'], v: ['앱 2.3.0'],
  },
];

function run({ db, today }) {
  const ref = Date.now();
  const iso = (daysAgo) => new Date(ref - daysAgo * DAY).toISOString();
  const lead = db.users.lead1 || Object.values(db.users)[0];
  const byLead = { memberId: lead.memberId, name: lead.name };
  const dev = db.users.dev2 || lead;
  const byDev = { memberId: dev.memberId, name: dev.name };

  const versionId = {};
  for (const [platform, version, status, planned, released, notes] of VERSIONS) {
    const id = ++db.versionSeq;
    const created = iso(30);
    db.versions.push({
      id, platform, version, status, plannedDate: today(planned), releasedDate: released === null ? null : today(released), notes,
      createdBy: byDev, createdAt: created, updatedAt: created,
      timeline: [{ type: 'created', at: created, by: byDev }].concat(status !== '계획' ? [{ type: 'field', field: 'status', label: '상태', from: '계획', to: status, at: iso(Math.max(1, -planned)), by: byDev }] : []),
    });
    versionId[`${platform} ${version}`] = id;
  }

  for (const s of REQUESTS) {
    const u = db.users[s.by];
    if (!u) continue;
    const created = iso(s.daysAgo);
    const r = {
      id: ++db.seq, title: s.title, platforms: s.platforms, type: s.type, jobs: s.jobs, description: s.description,
      reproSteps: s.reproSteps || '', dueDate: s.dueDate ? today(s.dueDate) : null,
      urgency: s.urgency, urgencyReason: s.urgencyReason, importance: s.importance, importanceReason: s.importanceReason,
      attachments: [], requester: { memberId: u.memberId, name: u.name, team: u.team }, requesterTeam: u.team,
      status: '접수', statusReason: '', priority: null, assignees: [], versionIds: [], github: null,
      createdAt: created, updatedAt: created,
      timeline: [{ type: 'created', at: created, by: { memberId: u.memberId, name: u.name } }],
    };
    if (s.status) {
      const at = iso(Math.max(0.1, s.daysAgo - 1));
      r.priority = s.priority;
      r.assignees = s.assignees || [];
      r.timeline.push({ type: 'priority', from: null, to: s.priority, at, by: byLead });
      r.timeline.push({ type: 'assignees', from: [], to: r.assignees, at, by: byLead });
      if (s.v) {
        r.versionIds = s.v.map((k) => versionId[k]);
        r.timeline.push({ type: 'versions', from: [], to: s.v, at, by: byLead });
      }
      r.timeline.push({ type: 'status', from: '접수', to: s.status, reason: s.statusReason || '', at, by: byLead });
      r.status = s.status;
      r.statusReason = s.statusReason || '';
      r.updatedAt = at;
    }
    db.requests.push(r);
  }
  console.log(`[seed] 요청 ${db.requests.length}건, 버전 ${db.versions.length}개를 넣었어요.`);
}

module.exports = { run };
