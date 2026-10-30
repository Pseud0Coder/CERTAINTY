/* The golden set as a test (ADR-0029). Bands, not exact scores: see
   golden-data.ts. A failure names the case and what moved. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screen, relevanceGate, isEntryLevel, type Criterion } from '../src/spine/screening.ts';
import { isLogistics, requirementShare, canon } from '../src/spine/terms.ts';
import { GOLDEN } from './golden-data.ts';

for (const c of GOLDEN) {
  test(`golden: ${c.title} (${c.id})`, async () => {
    const r = await screen({ cvText: c.cv, jdText: c.jd });
    const e = c.expect;
    assert.ok(e.recommendation.includes(r.recommendation), `recommendation ${r.recommendation}, accepted ${e.recommendation.join(' or ')}`);
    assert.ok(r.overall >= e.overall[0] && r.overall <= e.overall[1], `overall ${r.overall} outside ${e.overall.join('-')}`);
    if (e.minYears !== undefined) assert.equal(r.facts.minYears, e.minYears, 'minimum years read from the JD');
    if (e.years) assert.ok(r.facts.years !== null && r.facts.years >= e.years[0] && r.facts.years <= e.years[1], `years ${r.facts.years} outside ${e.years.join('-')}`);
    if (e.stated !== undefined) { assert.equal(r.facts.years, null); assert.equal(r.facts.statedYears, e.stated); }
    for (const s of e.skillsFound ?? []) assert.ok(r.facts.skillsFound.includes(s), `skill ${s} should be found; found ${r.facts.skillsFound.join(', ')}`);
    for (const s of e.skillsMissing ?? []) assert.ok(r.facts.skillsMissing.includes(s), `skill ${s} should be missing; missing ${r.facts.skillsMissing.join(', ')}`);
    if (e.skillsMissing && e.skillsMissing.length === 0) assert.deepEqual(r.facts.skillsMissing, []);
    for (const frag of e.missing ?? []) {
      const gap = r.criteria.some(k => k.grade === 1 && `${k.title} ${k.requirement}`.toLowerCase().includes(frag))
        || r.otherRequirements.some(o => o.status === 'missing' && o.requirement.toLowerCase().includes(frag));
      assert.ok(gap, `"${frag}" should be reported as a gap`);
    }
    /* Whatever the case, the same inputs give the same scorecard. */
    assert.deepEqual(await screen({ cvText: c.cv, jdText: c.jd }), r);
  });
}

test('a choice of skills is met by any one of them', () => {
  const req = 'Experience building CI/CD pipelines with Jenkins or GitHub Actions';
  assert.ok(requirementShare(req, canon('Built Jenkins pipelines for 25 services')) >= 0.8);
  assert.ok(requirementShare('Experience with Jenkins and GitHub', canon('Built Jenkins pipelines')) < 0.8, 'an "and" needs both');
  assert.ok(requirementShare('Using a CRM such as HubSpot or Salesforce', canon('Maintained pipeline in Salesforce')) >= 0.8);
});

test('lines a CV cannot show are confirmed with the candidate, not graded against the CV', async () => {
  assert.ok(isLogistics('Comfortable with a rotational shift'));
  assert.ok(isLogistics('Willing to relocate to Pune'));
  assert.ok(isLogistics('Notice period of 30 days or less'));
  assert.ok(!isLogistics('Experience with Kubernetes'));
  const c = GOLDEN.find(x => x.id === 'bpo-fresher-ok')!;
  const r = await screen({ cvText: c.cv, jdText: c.jd });
  assert.ok(r.confirm.some(l => /rotational shift/i.test(l)));
  assert.ok(!r.criteria.some(k => /shift/i.test(k.requirement)), 'not a tile');
  assert.ok(!r.otherRequirements.some(o => /shift/i.test(o.requirement)), 'not an other requirement');
  assert.ok(r.nextSteps.recruiter.some(s => /Confirm with the candidate: .*shift/i.test(s.text)));
  assert.ok(r.nextSteps.candidate.some(s => /Be ready to confirm: .*shift/i.test(s.text)));
});

test('a JD that welcomes freshers does not penalise a short career', async () => {
  assert.ok(isEntryLevel('0-2 years of experience, freshers welcome'));
  assert.ok(isEntryLevel('Entry level role'));
  assert.ok(!isEntryLevel('5+ years of experience'));
  const c = GOLDEN.find(x => x.id === 'bpo-fresher-ok')!;
  const r = await screen({ cvText: c.cv, jdText: c.jd });
  const exp = r.criteria.find(k => k.id === 'experience')!;
  assert.equal(exp.priority, 'nice');
  assert.ok(exp.grade >= 3);
  assert.ok(!r.nextSteps.recruiter.some(s => /experience/i.test(s.criterion ?? '')), 'no step chases experience');
});

test('years in another field are not counted in full', () => {
  const mk = (id: string, grade: number): Criterion => ({ id, category: 'universal', title: id, requirement: id, priority: 'must', weight: 2, grade, label: '', rationale: 'r', evidence: null, gradedBy: 'code' });
  const rubric = { skills: ['java', 'spring', 'kafka'] } as Parameters<typeof relevanceGate>[1];
  const gated = relevanceGate([mk('skills', 1), mk('experience', 5)], rubric);
  assert.equal(gated.find(c => c.id === 'experience')!.grade, 2);
  const kept = relevanceGate([mk('skills', 3), mk('experience', 5)], rubric);
  assert.equal(kept.find(c => c.id === 'experience')!.grade, 5, 'a partial skills match keeps its years');
  const few = relevanceGate([mk('skills', 1), mk('experience', 5)], { skills: ['java'] } as Parameters<typeof relevanceGate>[1]);
  assert.equal(few.find(c => c.id === 'experience')!.grade, 5, 'too few listed skills to judge relevance');
});

test('"advanced Excel" in a JD is met by "MS Excel" in a CV, and "excel at" is still not a skill', async () => {
  const c = GOLDEN.find(x => x.id === 'accounts-good')!;
  const r = await screen({ cvText: c.cv, jdText: c.jd });
  assert.ok(r.facts.skillsFound.includes('advanced excel'));
  assert.ok(!r.facts.skillsRequired.includes('excel'));
});

test('skills written with punctuation (CI/CD, C++, Node.js) are matched, not lost to the word splitter', async () => {
  const c = GOLDEN.find(x => x.id === 'undated-cv')!;
  const r = await screen({ cvText: c.cv, jdText: c.jd });
  const ci = r.criteria.find(k => /ci\/cd/i.test(k.requirement));
  assert.ok(ci && ci.grade >= 3, `CI/CD requirement graded ${ci?.grade}`);
  const cpp = await screen({ cvText: c.cv.replace('Selenium and Java framework', 'C++ and Node.js framework'), jdText: 'Systems Engineer\nWhat we are looking for:\n- 3+ years of experience writing C++ services\n- Experience with Node.js tooling\n- Strong debugging skills' });
  assert.ok(cpp.facts.skillsFound.includes('c++') && cpp.facts.skillsFound.includes('node.js'));
});
