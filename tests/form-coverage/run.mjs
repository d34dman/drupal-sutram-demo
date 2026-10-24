// Runs the form coverage tests against the demo site.
//
//   node run.mjs              all groups, at the same time
//   node run.mjs files        one group (or several: node run.mjs basic dates)
//   node run.mjs --serial     one after the other
//   node run.mjs --cleanup    only delete the test nodes left behind
//
// Each group runs in its own browser context and deletes the nodes it made
// (titles start with "[form-coverage] <group>").

import { close, cleanup } from './lib.mjs';

export const GROUPS = ['basic', 'choices', 'dates', 'references', 'files', 'media'];

const args = process.argv.slice(2);
const serial = args.includes('--serial');
if (args.includes('--cleanup')) {
  console.log(`Deleted ${cleanup()} test nodes.`);
  process.exit(0);
}
const wanted = args.filter((a) => !a.startsWith('--'));
const unknown = wanted.filter((g) => !GROUPS.includes(g));
if (unknown.length) {
  console.error(`Unknown group: ${unknown.join(', ')}. Groups: ${GROUPS.join(', ')}.`);
  process.exit(2);
}
const groups = wanted.length ? wanted : GROUPS;

const runOne = async (g) => {
  const t = Date.now();
  try {
    const { run } = await import(`./tests/${g}.mjs`);
    const failed = await run();
    console.log(`${failed ? 'FAIL' : 'ok  '} ${g} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    return failed;
  } catch (err) {
    console.log(`FAIL ${g}: ${err && (err.stack || err)}`);
    return 1;
  }
};

let failed = 0;
if (serial) for (const g of groups) failed += await runOne(g);
else failed = (await Promise.all(groups.map(runOne))).reduce((a, b) => a + b, 0);
await close();
process.exit(failed ? 1 : 0);
