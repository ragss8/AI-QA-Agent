/**
 * Enumeration of lifecycle states for an agent run.  A run progresses
 * sequentially through these statuses as it plans, generates and executes
 * tests.  The final status is either `DONE` or `FAILED` depending on
 * whether all stages completed successfully.
 */
export enum AgentStatus {
  UNKNOWN = 'UNKNOWN',
  CREATED = 'CREATED',
  EXPLORED = 'EXPLORED',
  PLANNED = 'PLANNED',
  INSPECTED = 'INSPECTED',
  GENERATED = 'GENERATED',
  EXECUTED = 'EXECUTED',
  ANALYZED = 'ANALYZED',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

/**
 * Test types categorise scenarios extracted from the requirement.  Happy
 * paths represent expected behaviour, negative tests cover invalid inputs
 * and edge cases explore boundary conditions.
 */
export type TestType = 'happy' | 'negative' | 'edge';

/**
 * Whether the user asked for this case, or the planner added it.
 *
 * A description like "test the estimation step" names one scenario but implies
 * many — rounding, missing inputs, permissions. Marking them keeps the planner's
 * additions reviewable instead of silently mixed in with what was requested.
 */
export type TestSource = 'stated' | 'inferred';

/** Outcome of executing a single test case. */
export type TestOutcome = 'PASSED' | 'FAILED' | 'SKIPPED' | 'PENDING';

/** Triage order for a tester working through failures. */
export type TestPriority = 'high' | 'medium' | 'low';

/**
 * A single test case as produced by the planner.  Each test case will
 * ultimately correspond to an individual Playwright `test()` call.
 */
export interface PlannedTestCase {
  /** Stable display id, `TC-01` style, used in the report and the spec title. */
  id: string;
  description: string;
  type: TestType;
  source: TestSource;
  /** What must already be true before the steps can run. */
  preconditions?: string;
  /** Ordered, human-readable actions. */
  steps?: string[];
  /** The oracle: what makes this test pass. */
  expectedResult?: string;
  priority?: TestPriority;
}

/**
 * The overall plan returned by the planner.  It contains a feature name
 * and a list of test cases.
 */
export interface TestPlan {
  feature: string;
  tests: PlannedTestCase[];
}

/** One test case joined with its execution outcome, as shown in the UI. */
export interface TestCaseResult {
  id: string;
  description: string;
  type: TestType;
  source: TestSource;
  preconditions?: string;
  steps?: string[];
  expectedResult?: string;
  priority?: TestPriority;
  outcome: TestOutcome;
  /** Why it passed or failed, in plain language. */
  reason: string;
  durationMs?: number;
}

export interface RunStatusSnapshot {
  status: AgentStatus;
  plan?: TestPlan;
  message?: string;
  provider?: string;
  model?: string;
  /** Populated once the run reaches EXECUTED. */
  results?: TestCaseResult[];
  summary?: { total: number; passed: number; failed: number; skipped: number };
  /** Values the agent invented, and what it wishes it had been told. */
  syntheticInputs?: SyntheticInput[];
  advisories?: string[];
  /** How far exploration got, so a shallow run is not mistaken for a deep one. */
  exploration?: { stepsVisited: number; reachedGoal: boolean; stoppedBecause?: string };
}

/** One observed screen from an exploration pass. */
export interface FlowStep {
  index: number;
  url: string;
  /** What the agent did to arrive here, or `start`. */
  action: string;
  /** Interactive markup of the screen, already stripped of utility classes. */
  markup: string;
  note?: string;
}

/**
 * A value the agent had to invent because the description did not supply one.
 *
 * Recorded and surfaced rather than hidden: synthetic data is the difference
 * between a test that exercised the real flow and one that stopped at a
 * validation error, so the user needs to see exactly what was used.
 */
export interface SyntheticInput {
  /** The field it filled, as a selector or label. */
  field: string;
  value: string;
  /** Why this value was chosen. */
  rationale: string;
  /** True when the value is a guess at a credential or an id that must match
   *  real data, so it was likely rejected by the application. */
  needsRealValue: boolean;
}

/** Everything the agent learned by walking the app. */
export interface FlowTrace {
  goal: string;
  steps: FlowStep[];
  reachedGoal: boolean;
  /** Why exploration stopped, when it did not reach the goal. */
  stoppedBecause?: string;
  /** Values the agent made up, for the report. */
  syntheticInputs: SyntheticInput[];
  /** Plain-language notes telling the user what input would have helped. */
  advisories: string[];
}

/** The planner's next move during exploration. */
export interface ExplorerAction {
  reasoning: string;
  action: 'fill' | 'click' | 'select' | 'press' | 'goto' | 'done' | 'blocked';
  selector?: string;
  value?: string;
  /** The model declares this rather than us inferring it from its prose. */
  valueWasInvented?: boolean;
}
