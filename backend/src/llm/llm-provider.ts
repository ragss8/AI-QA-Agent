import {
  ExplorerAction,
  FlowTrace,
  PlannedTestCase,
  TestPlan,
} from '../agent/agent.types';

export interface FailureAnalysis {
  classification: 'APPLICATION_BUG' | 'TEST_FLAKE' | 'SELECTOR_ISSUE';
  summary: string;
}

/**
 * The contract every LLM backend implements. Declared as an abstract class
 * rather than an interface because Nest needs a value to use as an injection
 * token, and interfaces do not survive compilation.
 *
 * Structured calls are expressed as "return data matching this schema" so that
 * a hosted model (via forced tool use) and a local one (via schema-constrained
 * decoding) can satisfy the same contract.
 */
export abstract class LlmProvider {
  /** Identifies which backend served a run; persisted on AgentRun. */
  abstract readonly name: string;
  abstract readonly model: string;

  /**
   * The concrete backend that served the most recent call. Wrappers (routing,
   * repair) override this to report what is underneath rather than themselves.
   */
  get servedBy(): string {
    return this.name;
  }

  /**
   * @param trace what exploring the live app actually found, when available.
   *   Supplying it keeps the plan grounded in real screens rather than guesses.
   */
  abstract generateTestPlan(prdText: string, trace?: FlowTrace): Promise<TestPlan>;

  /** Chooses the next browser action while walking the app toward a goal. */
  abstract chooseAction(
    goal: string,
    pageMarkup: string,
    history: string[],
  ): Promise<ExplorerAction>;

  abstract generatePlaywrightSpec(
    testCases: PlannedTestCase[],
    baseUrl: string,
    pageContext: string,
  ): Promise<string>;

  abstract analyseFailure(
    testCase: PlannedTestCase,
    errorLog: string,
  ): Promise<FailureAnalysis>;
}

/** Shared JSON schemas, so both providers constrain output identically. */
export const TEST_PLAN_SCHEMA = {
  type: 'object' as const,
  properties: {
    feature: { type: 'string' },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'TC-01, TC-02, … in order' },
          description: { type: 'string' },
          type: { type: 'string', enum: ['happy', 'negative', 'edge'] },
          source: {
            type: 'string',
            enum: ['stated', 'inferred'],
            description: 'stated if the user asked for it, inferred if you added it',
          },
          preconditions: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          expectedResult: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: [
          'id', 'description', 'type', 'source',
          'preconditions', 'steps', 'expectedResult', 'priority',
        ],
      },
    },
  },
  required: ['feature', 'tests'],
};

export const EXPLORER_ACTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    reasoning: { type: 'string' },
    action: {
      type: 'string',
      enum: ['fill', 'click', 'select', 'press', 'goto', 'done', 'blocked'],
    },
    selector: { type: 'string' },
    value: { type: 'string' },
    valueWasInvented: {
      type: 'boolean',
      description:
        'true when the goal did not supply this value and you made it up',
    },
  },
  required: ['reasoning', 'action'],
};

export const FAILURE_ANALYSIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    classification: {
      type: 'string',
      enum: ['APPLICATION_BUG', 'TEST_FLAKE', 'SELECTOR_ISSUE'],
    },
    summary: { type: 'string' },
  },
  required: ['classification', 'summary'],
};

export const PLAN_SYSTEM_PROMPT = [
  'You are a senior QA engineer writing a test plan another tester will execute.',
  '',
  'Number cases TC-01, TC-02 and so on. For each, give concise steps, the',
  'preconditions that must already hold, and an expected result specific enough',
  'to decide pass or fail without asking anyone.',
  '',
  'Cover what the user asked for, then add the cases they did not think to ask',
  'for. Mark the first group source="stated" and the second source="inferred".',
  'A request names one scenario but a real feature implies many, so consider:',
  '  - required-field validation, and each field left empty in turn',
  '  - boundaries: zero, negative, maximum, one past maximum, very long input',
  '  - number handling: decimal precision, rounding, currency and unit display',
  '  - wrong or stale state: navigating away and back, double submission,',
  '    the session expiring, a value changing underneath the user',
  '  - permissions: a role that should not reach this at all',
  '  - alternative paths the same screen supports, and cancelling partway',
  'Only add cases the described feature could plausibly support. Do not invent',
  'functionality that is not implied by the requirement or the observed screens.',
  '',
  'Set priority by user impact: high for anything blocking the main task or',
  'risking wrong data, low for cosmetic or rare paths.',
].join('\n');

/** Prepends what exploring the live app actually observed. */
export function buildPlanPrompt(prdText: string, trace?: FlowTrace): string {
  if (!trace || trace.steps.length === 0) {
    return prdText;
  }

  const screens = trace.steps
    .map((s) => `### Step ${s.index} — ${s.action}\nURL: ${s.url}\n${s.markup}`)
    .join('\n\n');

  const caveat = trace.reachedGoal
    ? ''
    : `\n\nNOTE: exploration did not fully reach the goal (${trace.stoppedBecause ?? 'unknown'}). Base cases on the screens below and mark anything beyond them as inferred.`;

  return [
    `Requirement:\n${prdText}`,
    `\nScreens actually observed while walking the application (use these exact selectors; do not invent others):\n\n${screens}${caveat}`,
  ].join('\n');
}

export const EXPLORER_SYSTEM_PROMPT = [
  'You are driving a real browser to reach a goal inside a web application, so',
  'that tests can afterwards be written against screens you have actually seen.',
  '',
  'You are given the goal, the interactive markup of the current screen, and',
  'what you have already done. Return exactly one next action.',
  '',
  'Rules:',
  '  - Use only selectors present in the given markup. Prefer #id, then',
  '    [name=…], then a visible-text match. Never guess a selector.',
  '  - Reply action="done" once the goal screen is visible.',
  '  - Reply action="blocked" if you cannot progress — for example a login',
  '    rejects the credentials, or no element on screen leads onward. Say why',
  '    in reasoning. Do not loop on a screen that is not changing.',
  '  - If a required field has no value supplied in the goal, invent a',
  '    realistic one and set valueWasInvented=true. Credentials, account numbers and',
  '    ids that must match existing records cannot be invented successfully:',
  '    attempt them once, then report blocked rather than retrying variations.',
  '  - Prefer the shortest route to the goal. Do not explore unrelated areas.',
].join('\n');

export const SPEC_SYSTEM_PROMPT = [
  'You are a QA automation engineer. Generate a complete Playwright TypeScript',
  'spec file covering all the given test cases.',
  '',
  "Begin with exactly one import line: import { test, expect } from '@playwright/test';",
  'Add no other imports. Write minimal, concise code with no inline comments.',
  'The file must compile as TypeScript. Do not emit backticks or markdown fences.',
  '',
  'Start every test title with the case id exactly as given, then a colon:',
  "  test('TC-01: logs in with valid credentials', async ({ page }) => {",
  'The id is how each result is matched back to its planned case, so a missing',
  'or altered id makes the result unreportable.',
  '',
  'Use only selectors that appear in the provided page markup. Never guess or',
  'invent a selector, including for error or status messages: if the markup does',
  'not show an element, assert on visible text with getByText instead.',
].join('\n');

export const ANALYSIS_SYSTEM_PROMPT =
  'You are a QA lead. Analyse the following Playwright error log and classify the failure as APPLICATION_BUG, TEST_FLAKE, or SELECTOR_ISSUE. Provide a one-sentence summary explaining the reason.';

/** The user-turn content for a spec generation request. */
export function buildSpecPrompt(
  testCases: PlannedTestCase[],
  baseUrl: string,
  pageContext: string,
): string {
  return `Base URL: ${baseUrl}\n\nActual page HTML (use these exact selectors):\n${pageContext}\n\nTest cases:\n${JSON.stringify(testCases, null, 2)}`;
}
