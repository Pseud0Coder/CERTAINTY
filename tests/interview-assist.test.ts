/* ADR-0024 live interview assist and voice completion: deterministic
   follow-ups, compliance detection, a scorecard, and a completion summary. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/spine/db.ts';
import { seedDemo } from '../src/spine/seed.ts';
import {
  completeVoiceSession, completionNotes, detectComplianceRisks, interviewScorecard,
  liveAssist, recommendFollowUps,
} from '../src/spine/interview-assist.ts';
import type { TranscriptTurn } from '../src/spine/types.ts';

const turn = (who: string, text: string): TranscriptTurn => ({ t: '00:10', who, text });

test('compliance-sensitive questions are flagged, statements are not', () => {
  const transcript = [
    turn('Interviewer', 'How old are you and are you planning to have children?'),
    turn('Candidate', 'I have led platform teams for six years.'),
    turn('Interviewer', 'Which religion do you practise?'),
    turn('Candidate', 'I built the billing service and cut fraud by 30 percent.'),
  ];
  const flags = detectComplianceRisks(transcript);
  const categories = flags.map(f => f.category);
  assert.ok(categories.includes('Age'));
  assert.ok(categories.includes('Family status'));
  assert.ok(categories.includes('Religion'));
  assert.equal(flags.filter(f => f.turnIndex === 1).length, 0, 'a candidate statement is not a question');
});

test('follow-ups target the weakest part of an answer, at most one each', () => {
  const transcript = [
    turn('Candidate', 'I worked on the platform and we improved things.'), // no result
    turn('Candidate', 'I reduced latency by 40 percent.'),                 // no situation
    turn('Candidate', 'At the time we had a deadline, we decided to migrate and we cut cost by 10 percent.'), // we-heavy
  ];
  const follows = recommendFollowUps(transcript, ['latency']);
  assert.equal(follows.length, 3, 'one follow-up per answer');
  assert.ok(follows.some(f => /measurable outcome/i.test(f.question)));
  assert.ok(follows.some(f => /situation and constraint/i.test(f.question)));
  assert.ok(follows.some(f => /personally own/i.test(f.question)));
});

test('the scorecard is bounded and reports competency coverage', () => {
  const transcript = [
    turn('Candidate', 'At the time we had a deadline. I designed the cache with a TTL and reduced latency by 40 percent.'),
  ];
  const score = interviewScorecard(transcript, ['latency', 'security']);
  assert.ok(score.overall >= 0 && score.overall <= 100);
  assert.deepEqual(score.coverage, [{ competency: 'latency', evidenced: true }, { competency: 'security', evidenced: false }]);
  assert.ok(score.star.S > 0 && score.star.R > 0, 'situation and result were both heard');
});

test('completion notes summarize, structure and obey the string rules', () => {
  const transcript = [
    turn('Candidate', 'I built the service, we shipped it, and it cut cost by 20 percent. So, yeah.'),
  ];
  const notes = completionNotes(transcript, ['service']);
  assert.ok(notes.summary.includes('of 100'));
  assert.ok(notes.structured.nextSteps.length > 0);
  const text = notes.summary + JSON.stringify(notes.structured);
  assert.ok(!/[\u2014\u2013]/.test(text), 'no em or en dash');
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), 'no emoji');
});

test('live assist combines the three without writing anything', () => {
  const transcript = [turn('Candidate', 'I worked on it.')];
  const assist = liveAssist(transcript, ['delivery']);
  assert.ok(Array.isArray(assist.followUps));
  assert.ok(Array.isArray(assist.compliance));
  assert.ok(typeof assist.scorecard.overall === 'number');
});

test('a voice session completes with metrics, a debrief and an audit entry', () => {
  const store = new Store(':memory:');
  const ids = seedDemo(store);
  const ctx = { tenantId: ids.tenantId };
  const result = completeVoiceSession(store, ctx, ids.sessionId, ['REST API design']);
  const session = store.session(ctx, ids.sessionId)!;
  assert.equal(session.status, 'complete');
  assert.ok(session.star);
  assert.ok(session.ownership !== null);
  assert.ok(session.debrief && session.debrief.includes('Interview scoring'));
  assert.equal(result.notes.summary, session.debrief!.split('\n\n')[0]);
  assert.ok(store.auditList(ctx).some(e => e.action === 'voice_session_completed'));
});
