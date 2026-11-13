/* Prints the golden set: what the engine says about each case, next to the
   band a careful recruiter would accept. Run: node scripts/golden-report.ts */
import { screen } from '../src/spine/screening.ts';
import { GOLDEN } from '../tests/golden-data.ts';

let outside = 0;
for (const c of GOLDEN) {
  const r = await screen({ cvText: c.cv, jdText: c.jd });
  const [lo, hi] = c.expect.overall;
  const ok = c.expect.recommendation.includes(r.recommendation) && r.overall >= lo && r.overall <= hi;
  if (!ok) outside++;
  const gaps = r.otherRequirements.filter(o => o.status === 'missing').length;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.id.padEnd(20)} ${r.overall.toFixed(1)}  ${r.recommendation.padEnd(15)} band ${lo}-${hi}  years ${r.facts.years ?? (r.facts.statedYears ? `${r.facts.statedYears} stated` : 'none')}  gaps ${gaps}${r.capReason ? '  CAPPED' : ''}`);
}
console.log(`\n${GOLDEN.length - outside} of ${GOLDEN.length} inside their band`);
process.exitCode = outside ? 1 : 0;
