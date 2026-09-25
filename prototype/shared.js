/* Certainty, Stage 1. Shared spine. All data fictional. No client-derived names.
   Internal compensation fields live ONLY in recruiter.html, never here. */

const STORE_KEY = 'certainty_stage1';
const STAGES = ['Screening','Submission draft','With client','Interview','Offer'];

const seed = {
  agency: 'Gennext Recruitments',
  candidates: [
    { id:'c1', name:'Nadia Rowe',    target:'Senior Software Engineer · FinTech', employer:'Northline QA Labs', tenure:'07/2019 - 10/2020', stage:0, parked:false, linked:'synced 12 Sep' },
    { id:'c2', name:'James Field',   target:'Product Manager · B2B SaaS',         employer:'Corvus Software',  tenure:'03/2021 - present', stage:1, parked:false, linked:'synced 10 Sep' },
    { id:'c3', name:'Ana Ortiz',     target:'Customer Success Manager',           employer:'Bellhaven Group',  tenure:'11/2018 - 05/2024', stage:2, parked:false, linked:'synced 08 Sep' },
    { id:'c4', name:'Tom Hale',      target:'Data Analyst',                       employer:'Fenwick Data',    tenure:'06/2023 - present', stage:0, parked:true,  linked:'pending' }
  ],
  sessions: [
    { id:'s1', candidate:'c1', mode:'verified', date:'12 Sep', duration:'14:02',
      star:{S:18,T:9,A:44,R:29}, targets:{S:15,T:10,A:50,R:25}, ownership:61, trailing:2,
      consent:{ id:'k1', scope:'recording and sharing', granted:'12 Sep 09:14', retention:'6 months' },
      transcript:[
        { t:'00:41', who:'Interviewer',   text:'Tell me about the accessibility automation project. What did you personally own?' },
        { t:'01:03', who:'Nadia', text:'The team ran manual WCAG audits, which took weeks. I built the assessment framework and exposed it as a REST API so the checks ran automatically.',
          annot:{ mark:'claimed', label:'Claim logged: framework ownership' } },
        { t:'02:15', who:'Interviewer',   text:'You said "coordinated four engineers". Formal team or project ownership?' },
        { t:'02:31', who:'Nadia', text:'Project ownership. They reported to my manager, but I ran the workstream day to day. After the SQL work, processing time dropped by about 30%.',
          annot:{ mark:'confirmed', label:'Metric confirmed, matches CV' } },
        { t:'04:02', who:'Interviewer',   text:'The client JD lists Kubernetes as a must-have. Where have you run it?' },
        { t:'04:10', who:'Nadia', text:'I have not, honestly. We had containerized CI, but I never owned the clusters.',
          annot:{ mark:'gap', label:'JD gap logged' } },
        { t:'04:58', who:'Nadia', text:'So that was basically it.' }
      ] }
  ],
  flags: [
    { id:'f1', candidate:'c1', type:'claim',    status:'open', title:'Claim not on CV',
      body:'Coordinated four engineers on the WCAG automation workstream. No leadership line on the CV.',
      quote:'"they reported to my manager, but I ran the workstream day to day"' },
    { id:'f2', candidate:'c1', type:'jd-gap',   status:'open', title:'JD must-have not evidenced',
      body:'Kubernetes, client JD must-have. No evidence in the CV or the interview.',
      quote:'"I have not, honestly"' },
    { id:'f3', candidate:'c1', type:'conflict', status:'open', title:'Source conflict',
      body:'LinkedIn snapshot end 10/2022 against CV 10/2020. Conservative version (10/2020) used in the draft.',
      quote:'verify with the candidate before submission' },
    { id:'f4', candidate:'c1', type:'metric',   status:'confirmed', title:'Metric confirmed',
      body:'Processing time reduced by about 30%. Stated twice, matches the CV bullet. Cleared for client-facing use.',
      quote:'"processing time dropped by about 30%"' }
  ],
  candidateTasks: [
    { id:'t1', type:'task', done:false, source:'recruiter',
      title:'Add the leadership line to your CV',
      body:'You said you coordinated four engineers on the WCAG workstream. It is not on your CV yet. Your recruiter agrees, it is earned.' },
    { id:'t2', type:'task', done:false, source:'system',
      title:'Build a Kubernetes story',
      body:'It appears in three of your target job descriptions. No story exists yet.' },
    { id:'t3', type:'warn', done:false, source:'system',
      title:'Align your end date',
      body:'Your LinkedIn snapshot says 10/2022. Your CV says 10/2020. Pick the true one and align both.' }
  ],
  audit: []
};

function loadStore() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
  return JSON.parse(JSON.stringify(seed));
}
function saveStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
function logEvent(s, actor, role, action, target) {
  s.audit.push({ actor, role, action, target, ts: new Date().toISOString() });
  saveStore(s);
}
function advanceStage(s, id) {
  const c = s.candidates.find(x => x.id === id);
  if (!c || c.parked || c.stage >= STAGES.length - 1) return null;
  c.stage += 1; saveStore(s); return c;
}
function setParked(s, id, parked) {
  const c = s.candidates.find(x => x.id === id); if (!c) return;
  c.parked = parked; saveStore(s);
}
function markTaskDone(s, id, actor, role) {
  const t = s.candidateTasks.find(x => x.id === id); if (!t) return;
  t.done = true; logEvent(s, actor, role, 'task_done', id);
}
