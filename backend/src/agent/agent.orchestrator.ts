import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { LlmProvider } from '../llm/llm-provider';
import { FlowExplorerService } from '../page-inspector/flow-explorer.service';
import { PageInspectorService } from '../page-inspector/page-inspector.service';
import { PlaywrightRunnerService } from '../playwright/playwright-runner.service';
import { collectResults, summarise } from '../playwright/test-results';
import { PrismaService } from '../prisma/prisma.service';
import { AgentStatus, FlowTrace, TestCaseResult, TestPlan } from './agent.types';

@Injectable()
export class AgentOrchestrator {
  private readonly runsRoot = path.join(process.cwd(), 'runs');

  constructor(
    private readonly llm: LlmProvider,
    private readonly explorer: FlowExplorerService,
    private readonly inspector: PageInspectorService,
    private readonly runner: PlaywrightRunnerService,
    private readonly prisma: PrismaService,
  ) {}

  async run(runId: string, prdText: string, baseUrl: string): Promise<void> {
    const runDir = path.join(this.runsRoot, runId);
    await fs.mkdir(runDir, { recursive: true });

    await this.prisma.agentRun.create({
      data: { id: runId, prdText, baseUrl, status: AgentStatus.CREATED },
    });

    try {
      // 1. Walk the live app, so the plan and its selectors are grounded in
      //    screens that exist rather than guesses about screens past login.
      const trace = await this.explore(runId, runDir, prdText, baseUrl);

      const plan: TestPlan = await this.llm.generateTestPlan(prdText, trace);
      await Promise.all([
        fs.writeFile(path.join(runDir, 'plan.json'), JSON.stringify(plan, null, 2)),
        this.logCall(runId, 'plan', prdText, JSON.stringify(plan)),
        this.setStatus(runId, AgentStatus.PLANNED, {
          provider: this.llm.servedBy,
          model: this.llm.model,
          testPlan: plan as unknown as Prisma.InputJsonValue,
          testCases: {
            create: plan.tests.map((tc) => ({
              externalId: tc.id,
              description: tc.description,
              type: tc.type,
              status: 'PENDING',
            })),
          },
        }),
      ]);

      const pageContext = this.contextFor(trace, baseUrl);
      await this.setStatus(runId, AgentStatus.INSPECTED);

      const spec = await this.llm.generatePlaywrightSpec(plan.tests, baseUrl, pageContext);
      await Promise.all([
        fs.writeFile(path.join(runDir, 'generated.spec.ts'), spec),
        this.logCall(runId, 'spec', pageContext, spec),
        this.setStatus(runId, AgentStatus.GENERATED, {
          provider: this.llm.servedBy,
          model: this.llm.model,
        }),
      ]);

      await this.runner.run(runId, runDir);
      await this.setStatus(runId, AgentStatus.EXECUTED);

      // 2. Join the plan to what actually happened, so every case carries a
      //    pass/fail and a reason a tester can act on.
      const results = await collectResults(
        PlaywrightRunnerService.reportPath(runDir),
        plan.tests,
      );
      await this.persistResults(runId, results);

      const summary = summarise(results);
      await this.setStatus(runId, AgentStatus.DONE, {
        message: `${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.skipped} not run`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown agent run failure';
      await this.setStatus(runId, AgentStatus.FAILED, { message }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  /**
   * Explores the app, falling back to a single-page inspect when exploration
   * cannot start at all. A failed exploration must not fail the run: a shallow
   * plan, clearly labelled as such, beats no plan.
   */
  private async explore(
    runId: string,
    runDir: string,
    prdText: string,
    baseUrl: string,
  ): Promise<FlowTrace> {
    const trace = await this.explorer.explore(baseUrl, prdText);

    if (trace.steps.length === 0) {
      const markup = await this.inspector.inspect(baseUrl).catch(() => '');
      trace.steps.push({ index: 0, url: baseUrl, action: 'start', markup });
      trace.advisories.push(
        'Exploration could not drive the application; fell back to inspecting the entry page only.',
      );
    }

    await Promise.all([
      fs.writeFile(path.join(runDir, 'flow-trace.json'), JSON.stringify(trace, null, 2)),
      this.setStatus(runId, AgentStatus.EXPLORED, {
        flowTrace: trace as unknown as Prisma.InputJsonValue,
      }),
    ]);

    return trace;
  }

  /** Every observed screen, so generation can reference any of them. */
  private contextFor(trace: FlowTrace, baseUrl: string): string {
    const screens = trace.steps
      .map(
        (step) =>
          `--- Screen ${step.index} (${step.action}) at ${step.url} ---\n${step.markup}`,
      )
      .join('\n\n');

    return screens || `No markup could be captured for ${baseUrl}.`;
  }

  /** Writes outcomes back onto the TestCase rows the plan created. */
  private async persistResults(
    runId: string,
    results: TestCaseResult[],
  ): Promise<void> {
    await Promise.all(
      results.map((result) =>
        this.prisma.testCase
          .updateMany({
            where: { runId, externalId: result.id },
            data: { status: result.outcome, errorLog: result.reason },
          })
          .catch(() => undefined),
      ),
    );
  }

  /**
   * Records an accepted prompt/output pair. Best-effort: losing a corpus row
   * must never fail a run.
   */
  private logCall(runId: string, kind: string, prompt: string, output: string) {
    return this.prisma.llmCallLog
      .create({
        data: {
          runId,
          kind,
          prompt,
          output,
          provider: this.llm.servedBy,
          model: this.llm.model,
        },
      })
      .catch(() => undefined);
  }

  private setStatus(
    runId: string,
    status: AgentStatus,
    data: Omit<Prisma.AgentRunUpdateInput, 'status'> = {},
  ) {
    return this.prisma.agentRun.update({
      where: { id: runId },
      data: { ...data, status },
    });
  }
}
