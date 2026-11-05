import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlannedTestCase } from '../src/agent/agent.types';
import { ReportService } from '../src/agent/report.service';
import { collectResults, summarise } from '../src/playwright/test-results';

/** Asserts the result-joining rules and that a workbook actually builds. */

const plan: PlannedTestCase[] = [
  { id: 'TC-01', description: 'logs in', type: 'happy', source: 'stated', expectedResult: 'lands on dashboard', priority: 'high' },
  { id: 'TC-02', description: 'rejects bad password', type: 'negative', source: 'stated', priority: 'medium' },
  { id: 'TC-03', description: 'rejects empty id', type: 'negative', source: 'inferred', priority: 'low' },
  { id: 'TC-10', description: 'never generated', type: 'edge', source: 'inferred', priority: 'low' },
];

const report = {
  suites: [
    {
      specs: [
        { title: 'TC-01: logs in', tests: [{ results: [{ status: 'passed', duration: 1200 }] }] },
        {
          title: 'TC-02: rejects bad password',
          tests: [{ results: [{ status: 'failed', duration: 800, error: { message: 'Timeout 5000ms exceeded.\nwaiting for locator(\'.flash\')' } }] }],
        },
      ],
      suites: [
        {
          specs: [
            { title: 'TC-03: rejects empty id', tests: [{ results: [{ status: 'skipped', duration: 0 }] }] },
          ],
        },
      ],
    },
  ],
};

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok   ${label}`);
  }
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-check-'));
  const reportPath = path.join(dir, 'results.json');
  await fs.writeFile(reportPath, JSON.stringify(report));

  const results = await collectResults(reportPath, plan);

  check('every planned case gets a row', results.length, 4);
  check('TC-01 passed', results[0].outcome, 'PASSED');
  check('TC-02 failed', results[1].outcome, 'FAILED');
  check('TC-03 found in a nested suite', results[2].outcome, 'SKIPPED');
  check('TC-10 with no result is SKIPPED, not dropped', results[3].outcome, 'SKIPPED');
  check(
    'TC-10 reason explains it never ran',
    results[3].reason.includes('never executed'),
    true,
  );
  check(
    'a timeout is explained as a missing selector',
    results[1].reason.includes('never appeared'),
    true,
  );
  check('pass reason cites the expected result', results[0].reason.includes('lands on dashboard'), true);
  check('inferred origin survives the join', results[2].source, 'inferred');
  check('summary counts', summarise(results), { total: 4, passed: 1, failed: 1, skipped: 2 });

  // TC-01 must not swallow TC-10's row via substring matching.
  const idMatch = await collectResults(
    reportPath,
    [{ id: 'TC-0', description: 'prefix trap', type: 'edge', source: 'inferred' }],
  );
  check('TC-0 does not match TC-01', idMatch[0].outcome, 'SKIPPED');

  // A workbook must build, with the four sheets, and be a real xlsx.
  const buffer = await new ReportService().toXlsx({
    runId: 'abc12345-0000',
    baseUrl: 'https://example.com/',
    prdText: 'test the thing',
    snapshot: {
      status: 'DONE' as never,
      results,
      summary: summarise(results),
      provider: 'ollama',
      model: 'qwen2.5-coder',
      advisories: ['exploration stopped early'],
      syntheticInputs: [
        { field: '#employee_id', value: '12345', rationale: 'none supplied', needsRealValue: true },
      ],
      exploration: { stepsVisited: 3, reachedGoal: false, stoppedBecause: 'login rejected' },
    },
  });

  check('xlsx is non-trivial in size', buffer.length > 5000, true);
  check('xlsx has the zip magic bytes', buffer.subarray(0, 2).toString(), 'PK');

  await fs.rm(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nREPORT SELF-CHECK PASS' : `\nREPORT SELF-CHECK FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
