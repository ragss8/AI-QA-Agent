import { promises as fs } from 'fs';
import * as path from 'path';
import { TestPlan } from '../src/agent/agent.types';
import { AnthropicProvider } from '../src/llm/anthropic.provider';
import { LlmProvider } from '../src/llm/llm-provider';
import { OllamaProvider } from '../src/llm/ollama.provider';
import { RepairingLlmProvider } from '../src/llm/repairing.provider';
import { checkSpecCompiles, ungroundedSelectors } from '../src/llm/typescript-check';
import { CASES, EvalCase } from './cases';

/**
 * Scores a provider on the frozen cases. Objective checks only — no human and
 * no judge model:
 *
 *   +1  plan is valid and covers all three test types
 *   +2  generated spec compiles
 *   +2  spec runs in Playwright with every test passing   (--run only)
 *   -3  spec uses a selector absent from the page markup
 *
 * Usage:
 *   pnpm eval                      # local model, fast checks
 *   pnpm eval --provider anthropic # baseline
 *   pnpm eval --repair             # wrap in the compile-repair loop
 *   pnpm eval --run                # also execute the specs (slow)
 */

const PLAN_VALID = 1;
const COMPILES = 2;
const TESTS_PASS = 2;
const UNGROUNDED_PENALTY = -3;
const MAX_SCORE = PLAN_VALID + COMPILES + TESTS_PASS;

interface CaseResult {
  id: string;
  memorised: boolean;
  planValid: boolean;
  testCount: number;
  compiles: boolean;
  compileErrors: string | null;
  ungrounded: string[];
  ran: boolean;
  testsPassed: number;
  testsTotal: number;
  score: number;
  error?: string;
}

async function scoreCase(
  provider: LlmProvider,
  evalCase: EvalCase,
  options: { run: boolean },
): Promise<CaseResult> {
  const result: CaseResult = {
    id: evalCase.id,
    memorised: evalCase.memorised,
    planValid: false,
    testCount: 0,
    compiles: false,
    compileErrors: null,
    ungrounded: [],
    ran: false,
    testsPassed: 0,
    testsTotal: 0,
    score: 0,
  };

  const pageContext = await fs.readFile(
    path.join(__dirname, 'fixtures', evalCase.fixture),
    'utf8',
  );

  try {
    const plan: TestPlan = await provider.generateTestPlan(evalCase.prdText);
    result.testCount = plan.tests?.length ?? 0;
    const types = new Set((plan.tests ?? []).map((t) => t.type));
    result.planValid =
      typeof plan.feature === 'string' &&
      result.testCount > 0 &&
      ['happy', 'negative', 'edge'].every((t) => types.has(t as never));
    if (result.planValid) {
      result.score += PLAN_VALID;
    }

    const spec = await provider.generatePlaywrightSpec(
      plan.tests.slice(0, 4), // cap, so one verbose plan cannot skew runtime
      evalCase.baseUrl,
      pageContext,
    );

    result.compileErrors = await checkSpecCompiles(spec);
    result.compiles = result.compileErrors === null;
    if (result.compiles) {
      result.score += COMPILES;
    }

    result.ungrounded = ungroundedSelectors(spec, pageContext);
    if (result.ungrounded.length > 0) {
      result.score += UNGROUNDED_PENALTY;
    }

    if (options.run && result.compiles) {
      const outcome = await runSpec(evalCase.id, spec);
      result.ran = true;
      result.testsPassed = outcome.passed;
      result.testsTotal = outcome.total;
      if (outcome.total > 0 && outcome.passed === outcome.total) {
        result.score += TESTS_PASS;
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

/** Writes the spec into the backend tree and runs it, counting pass/fail. */
async function runSpec(
  caseId: string,
  spec: string,
): Promise<{ passed: number; total: number }> {
  const { spawn } = await import('child_process');
  const dir = path.join(process.cwd(), 'runs', `eval-${caseId}`);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'generated.spec.ts');
  await fs.writeFile(file, spec);

  return new Promise((resolve) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['playwright', 'test', file, '--reporter=line'],
      { cwd: process.cwd(), shell: false },
    );
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (out += c.toString()));
    child.on('error', () => resolve({ passed: 0, total: 0 }));
    child.on('close', () => {
      const passed = Number(/(\d+) passed/.exec(out)?.[1] ?? 0);
      const failed = Number(/(\d+) failed/.exec(out)?.[1] ?? 0);
      resolve({ passed, total: passed + failed });
    });
  });
}

function buildProvider(name: string, repair: boolean): LlmProvider {
  const base: LlmProvider =
    name === 'anthropic' ? new AnthropicProvider() : new OllamaProvider();
  return repair ? new RepairingLlmProvider(base) : base;
}

function pad(value: string, width: number): string {
  return value.length > width ? value.slice(0, width - 1) + '…' : value.padEnd(width);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const providerName =
    argv.includes('--provider') ? argv[argv.indexOf('--provider') + 1] : 'ollama';
  const run = argv.includes('--run');
  const repair = argv.includes('--repair');

  const provider = buildProvider(providerName, repair);
  const label = `${provider.name}${repair ? ' +repair' : ''}`;

  console.log(`\nProvider: ${label}`);
  console.log(`Model:    ${provider.model}`);
  console.log(`Checks:   plan, compile, selectors${run ? ', playwright run' : ''}\n`);

  const results: CaseResult[] = [];
  for (const evalCase of CASES) {
    process.stdout.write(`  ${pad(evalCase.id, 24)}`);
    const result = await scoreCase(provider, evalCase, { run });
    results.push(result);
    console.log(
      result.error ? `ERROR  ${result.error}` : `${result.score}/${MAX_SCORE}`,
    );
  }

  console.log('\n' + '─'.repeat(78));
  console.log(
    `${pad('case', 24)}${pad('plan', 6)}${pad('tests', 7)}${pad('compiles', 10)}${pad('ungrounded', 12)}${pad('run', 9)}score`,
  );
  console.log('─'.repeat(78));
  for (const r of results) {
    console.log(
      pad(r.id + (r.memorised ? '' : ' *'), 24) +
        pad(r.planValid ? 'ok' : 'FAIL', 6) +
        pad(String(r.testCount), 7) +
        pad(r.compiles ? 'ok' : 'FAIL', 10) +
        pad(r.ungrounded.length ? String(r.ungrounded.length) : '-', 12) +
        pad(r.ran ? `${r.testsPassed}/${r.testsTotal}` : '-', 9) +
        `${r.score}/${MAX_SCORE}`,
    );
  }
  console.log('─'.repeat(78));

  const total = results.reduce((sum, r) => sum + r.score, 0);
  const possible = results.length * MAX_SCORE;
  console.log(`TOTAL  ${total}/${possible}  (${Math.round((100 * total) / possible)}%)`);
  console.log('  * = synthetic page, cannot have been memorised\n');

  for (const r of results.filter((x) => x.ungrounded.length)) {
    console.log(`  ungrounded in ${r.id}: ${r.ungrounded.join(', ')}`);
  }
  for (const r of results.filter((x) => x.compileErrors)) {
    console.log(`  compile errors in ${r.id}:\n${r.compileErrors}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
