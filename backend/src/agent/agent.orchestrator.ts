import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { LlmService } from '../llm/llm.service';
import { PlaywrightRunnerService } from '../playwright/playwright-runner.service';
import { AgentStatus, RunStatusSnapshot, TestPlan } from './agent.types';

/**
 * Coordinates the execution of an agent run.  A run consists of planning
 * test cases from a requirement, generating Playwright test code, executing
 * those tests and analysing any failures.  The orchestrator persists
 * intermediate artefacts to disk so that users can inspect the plan,
 * generated code and execution reports.
 */
@Injectable()
export class AgentOrchestrator {
  private readonly runsRoot = path.join(process.cwd(), 'runs');

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
    const runDir = path.join(this.runsRoot, runId);
    await fs.mkdir(runDir, { recursive: true });
    await this.writeStatus(runDir, { status: AgentStatus.CREATED });

    try {
      const plan: TestPlan = await this.llm.generateTestPlan(prdText);
      await Promise.all([
        fs.writeFile(path.join(runDir, 'plan.json'), JSON.stringify(plan, null, 2)),
        this.writeStatus(runDir, { status: AgentStatus.PLANNED, plan }),
      ]);

      const generatedTests = await Promise.all(
        plan.tests.map((testCase) =>
          this.llm.generatePlaywrightTest(testCase, baseUrl),
        ),
      );
      const spec = this.buildSpecFile(generatedTests);

      await Promise.all([
        fs.writeFile(path.join(runDir, 'generated.spec.ts'), spec),
        this.writeStatus(runDir, { status: AgentStatus.GENERATED, plan }),
      ]);

      await this.runner.run(runId);
      await this.writeStatus(runDir, { status: AgentStatus.DONE, plan });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown agent run failure';
      await this.writeStatus(runDir, {
        status: AgentStatus.FAILED,
        message,
      });
      throw error;
    }
  }

  private buildSpecFile(generatedTests: string[]): string {
    const sections = [`import { expect, test } from '@playwright/test';`];

    for (const generatedTest of generatedTests) {
      const trimmed = generatedTest.trim();
      if (trimmed) {
        sections.push(trimmed);
      }
    }

    return `${sections.join('\n\n')}\n`;
  }

  private async writeStatus(
    runDir: string,
    snapshot: RunStatusSnapshot,
  ): Promise<void> {
    await fs.writeFile(
      path.join(runDir, 'status.json'),
      JSON.stringify(snapshot, null, 2),
    );
  }
}
