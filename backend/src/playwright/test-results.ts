import { promises as fs } from 'fs';
import { PlannedTestCase, TestCaseResult, TestOutcome } from '../agent/agent.types';

/** The slice of Playwright's JSON report this needs. */
interface PlaywrightReport {
  suites?: ReportSuite[];
}
interface ReportSuite {
  suites?: ReportSuite[];
  specs?: ReportSpec[];
}
interface ReportSpec {
  title: string;
  tests?: Array<{
    results?: Array<{
      status?: string;
      duration?: number;
      error?: { message?: string };
      errors?: Array<{ message?: string }>;
    }>;
  }>;
}

interface RawOutcome {
  title: string;
  status: string;
  durationMs: number;
  errorMessage?: string;
}

/**
 * Joins the plan to what Playwright actually did, so every planned case gets a
 * row even if it never ran.
 *
 * Matching is by the `TC-nn` id in the test title, because the generator is
 * instructed to prefix each `test()` with it. A plan case with no matching
 * result is reported as SKIPPED rather than silently dropped — a test that did
 * not run is information a tester needs.
 */
export async function collectResults(
  reportPath: string,
  plan: PlannedTestCase[],
): Promise<TestCaseResult[]> {
  const outcomes = await readReport(reportPath);

  return plan.map((testCase) => {
    const match = outcomes.find((o) => mentionsId(o.title, testCase.id));
    const outcome = toOutcome(match?.status);

    return {
      id: testCase.id,
      description: testCase.description,
      type: testCase.type,
      source: testCase.source,
      preconditions: testCase.preconditions,
      steps: testCase.steps,
      expectedResult: testCase.expectedResult,
      priority: testCase.priority,
      outcome,
      reason: explain(outcome, testCase, match),
      durationMs: match?.durationMs,
    };
  });
}

async function readReport(reportPath: string): Promise<RawOutcome[]> {
  let parsed: PlaywrightReport;
  try {
    parsed = JSON.parse(await fs.readFile(reportPath, 'utf8')) as PlaywrightReport;
  } catch {
    return []; // no report: every case reports as SKIPPED with a reason
  }

  const found: RawOutcome[] = [];

  const walk = (suites: ReportSuite[] = []): void => {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        const result = spec.tests?.[0]?.results?.[0];
        const errorMessage =
          result?.error?.message ?? result?.errors?.[0]?.message ?? undefined;
        found.push({
          title: spec.title,
          status: result?.status ?? 'unknown',
          durationMs: result?.duration ?? 0,
          errorMessage,
        });
      }
      walk(suite.suites);
    }
  };

  walk(parsed.suites);
  return found;
}

/** Word-boundary match so TC-01 does not also match TC-010. */
function mentionsId(title: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9-])${escaped}([^A-Za-z0-9-]|$)`, 'i').test(title);
}

function toOutcome(status?: string): TestOutcome {
  switch (status) {
    case 'passed':
      return 'PASSED';
    case 'failed':
    case 'timedOut':
    case 'interrupted':
      return 'FAILED';
    case 'skipped':
      return 'SKIPPED';
    default:
      return 'SKIPPED';
  }
}

/**
 * The "reason" column. A tester reading a failure needs the cause, not a stack
 * trace, so Playwright's message is trimmed to its informative first lines and
 * the common causes are named explicitly.
 */
function explain(
  outcome: TestOutcome,
  testCase: PlannedTestCase,
  match?: RawOutcome,
): string {
  if (outcome === 'PASSED') {
    return testCase.expectedResult
      ? `Expected behaviour confirmed: ${testCase.expectedResult}`
      : 'Ran to completion with all assertions satisfied.';
  }

  if (outcome === 'SKIPPED') {
    return match
      ? 'Playwright reported this test as skipped.'
      : 'No generated test corresponded to this planned case, so it was never executed.';
  }

  const raw = (match?.errorMessage ?? '').replace(/\u001b\[\d+m/g, '').trim();
  if (!raw) {
    return 'Failed, but Playwright reported no error message.';
  }

  const headline = raw.split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ').trim();

  if (/strict mode violation/i.test(raw)) {
    return `Selector matched more than one element, so the step was ambiguous. ${headline}`;
  }
  if (/Timeout.*exceeded|waiting for locator|locator.*not (visible|found)/i.test(raw)) {
    return `A selector never appeared, so the element is missing, renamed, or the previous step did not complete. ${headline}`;
  }
  if (/net::ERR|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i.test(raw)) {
    return `The page could not be loaded at all — check the URL and network. ${headline}`;
  }
  if (/expect\(.*\)\.(toHave|toBe|toContain)/i.test(raw) || /Received:/i.test(raw)) {
    return `The application behaved differently from the expectation. ${headline}`;
  }

  return headline.slice(0, 400);
}

export function summarise(results: TestCaseResult[]) {
  return {
    total: results.length,
    passed: results.filter((r) => r.outcome === 'PASSED').length,
    failed: results.filter((r) => r.outcome === 'FAILED').length,
    skipped: results.filter((r) => r.outcome === 'SKIPPED').length,
  };
}
