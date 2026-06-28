/**
 * Enumeration of lifecycle states for an agent run.  A run progresses
 * sequentially through these statuses as it plans, generates and executes
 * tests.  The final status is either `DONE` or `FAILED` depending on
 * whether all stages completed successfully.
 */
export enum AgentStatus {
  UNKNOWN = 'UNKNOWN',
  CREATED = 'CREATED',
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
 * A single test case as produced by the planner.  Each test case will
 * ultimately correspond to an individual Playwright `test()` call.
 */
export interface PlannedTestCase {
  id: string;
  description: string;
  type: TestType;
}

/**
 * The overall plan returned by the planner.  It contains a feature name
 * and a list of test cases.
 */
export interface TestPlan {
  feature: string;
  tests: PlannedTestCase[];
}

export interface RunStatusSnapshot {
  status: AgentStatus;
  plan?: TestPlan;
  message?: string;
}
