import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { LlmService } from '../llm/llm.service';
import { PlaywrightRunnerService } from '../playwright/playwright-runner.service';
import { PlannedTestCase, TestPlan, AgentStatus } from './agent.types';

/**
 * Coordinates the execution of an agent run.  A run consists of planning
 * test cases from a requirement, generating Playwright test code, executing
 * those tests and analysing any failures.  The orchestrator persists
 * intermediate artefacts to disk so that users can inspect the plan,
 * generated code and execution reports.
 */
@Injectable()
export class AgentOrchestrator {
  constructor(
    private readonly llm: LlmService,
    private readonly runner: PlaywrightRunnerService,
  ) {}

  /**
   * Starts a new run.  The runId should be a unique identifier (UUID or
   * timestamp) supplied by the controller.  The orchestrator creates a
   * directory under `runs` to hold artefacts for this run.
   */
  async run(runId: string, prdText: string, baseUrl: string): Promise<void> {
    const runDir = path.join(process.cwd(), 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });

    // Step 1: plan tests
    const plan: TestPlan = await this.llm.generateTestPlan(prdText);
    fs.writeFileSync(
      path.join(runDir, 'plan.json'),
      JSON.stringify(plan, null, 2),
    );

    // Step 2: generate Playwright spec
    let spec = `import { test, expect } from '@playwright/test';\n`;
    for (const testCase of plan.tests) {
      const code = await this.llm.generatePlaywrightTest(testCase, baseUrl);
      spec += `\n${code}\n`;
    }
    fs.writeFileSync(path.join(runDir, 'generated.spec.ts'), spec);

    // Step 3: execute tests
    await this.runner.run(runId);

    // Step 4: analyse results
    // In this simplified POC we do not parse Playwright results.  A real
    // implementation would inspect the JSON report and call
    // this.llm.analyseFailure() for each failure.
  }
}