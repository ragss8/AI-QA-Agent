import { Logger } from '@nestjs/common';
import {
  ExplorerAction,
  FlowTrace,
  PlannedTestCase,
  TestPlan,
} from '../agent/agent.types';
import { FailureAnalysis, LlmProvider } from './llm-provider';
import { checkSpecCompiles } from './typescript-check';

const MAX_ATTEMPTS = 3; // the first generation plus two repairs

/**
 * Wraps another provider and retries spec generation when the output does not
 * compile, feeding the compiler's own errors back as the next prompt.
 *
 * Small models fail mostly at syntax and selector discipline, which is exactly
 * what `tsc` reports precisely — so this recovers far more than its size
 * suggests. It cannot catch logically wrong assertions: a test that compiles
 * and runs but asserts impossible behaviour is still wrong, and only executing
 * it reveals that.
 */
export class RepairingLlmProvider extends LlmProvider {
  readonly name: string;

  private readonly logger = new Logger(RepairingLlmProvider.name);

  constructor(private readonly inner: LlmProvider) {
    super();
    this.name = `${inner.name}+repair`;
  }

  // Getters, not fields: behind a router these change per call.
  get model(): string {
    return this.inner.model;
  }

  get servedBy(): string {
    return this.inner.servedBy;
  }

  generateTestPlan(prdText: string, trace?: FlowTrace): Promise<TestPlan> {
    return this.inner.generateTestPlan(prdText, trace);
  }

  chooseAction(goal: string, pageMarkup: string, history: string[]): Promise<ExplorerAction> {
    return this.inner.chooseAction(goal, pageMarkup, history);
  }

  analyseFailure(testCase: PlannedTestCase, errorLog: string): Promise<FailureAnalysis> {
    return this.inner.analyseFailure(testCase, errorLog);
  }

  async generatePlaywrightSpec(
    testCases: PlannedTestCase[],
    baseUrl: string,
    pageContext: string,
  ): Promise<string> {
    let lastSpec = '';
    let lastErrors: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const context =
        lastErrors === null
          ? pageContext
          : `${pageContext}\n\nYour previous answer did not compile. Fix these TypeScript errors and return the corrected file only:\n${lastErrors}\n\nPrevious answer:\n${lastSpec}`;

      lastSpec = await this.inner.generatePlaywrightSpec(testCases, baseUrl, context);
      lastErrors = await checkSpecCompiles(lastSpec);

      if (lastErrors === null) {
        if (attempt > 1) {
          this.logger.log(`Spec compiled after ${attempt} attempts`);
        }
        return lastSpec;
      }

      this.logger.warn(`Attempt ${attempt}/${MAX_ATTEMPTS} did not compile`);
    }

    // Return the last attempt rather than throwing: a spec that does not
    // compile still fails loudly in the runner, and the run keeps its artifacts.
    this.logger.error(`Spec still failing to compile after ${MAX_ATTEMPTS} attempts`);
    return lastSpec;
  }
}
