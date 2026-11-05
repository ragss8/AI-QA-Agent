import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AgentOrchestrator } from './agent.orchestrator';
import {
  AgentStatus,
  FlowTrace,
  RunStatusSnapshot,
  TestCaseResult,
  TestPlan,
  TestOutcome,
  TestType,
  TestSource,
  TestPriority,
} from './agent.types';
import { ReportService } from './report.service';

interface StartRunDto {
  /** What to test, in plain language. May also carry credentials to use. */
  prdText: string;
  baseUrl: string;
}

@Controller('agent-runs')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly prisma: PrismaService,
    private readonly report: ReportService,
  ) {}

  @Post()
  async startRun(@Body() body: StartRunDto): Promise<{ runId: string }> {
    const prdText = body.prdText?.trim();
    const baseUrl = body.baseUrl?.trim();

    if (!prdText || !baseUrl) {
      throw new HttpException(
        'Both prdText and baseUrl are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const runId = randomUUID();

    // Runs are long; the client polls GET /agent-runs/:runId for progress.
    this.orchestrator.run(runId, prdText, baseUrl).catch((error) => {
      this.logger.error(
        `Run ${runId} failed`,
        error instanceof Error ? error.stack : error,
      );
    });

    return { runId };
  }

  @Get(':runId')
  async getRun(@Param('runId') runId: string): Promise<RunStatusSnapshot> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: { testCases: true },
    });

    if (!run) {
      return { status: AgentStatus.UNKNOWN, message: 'Run not found' };
    }

    const plan = run.testPlan as unknown as TestPlan | undefined;
    const trace = run.flowTrace as unknown as FlowTrace | undefined;
    const results = this.buildResults(plan, run.testCases);

    return {
      status: run.status as AgentStatus,
      plan,
      message: run.message ?? undefined,
      provider: run.provider ?? undefined,
      model: run.model ?? undefined,
      results,
      summary: results && {
        total: results.length,
        passed: results.filter((r) => r.outcome === 'PASSED').length,
        failed: results.filter((r) => r.outcome === 'FAILED').length,
        skipped: results.filter((r) => r.outcome === 'SKIPPED').length,
      },
      syntheticInputs: trace?.syntheticInputs,
      advisories: trace?.advisories,
      exploration: trace && {
        stepsVisited: trace.steps?.length ?? 0,
        reachedGoal: trace.reachedGoal,
        stoppedBecause: trace.stoppedBecause,
      },
    };
  }

  @Get(':runId/report.xlsx')
  async downloadReport(
    @Param('runId') runId: string,
    @Res() res: Response,
  ): Promise<void> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: { testCases: true },
    });

    if (!run) {
      throw new HttpException('Run not found', HttpStatus.NOT_FOUND);
    }

    const snapshot = await this.getRun(runId);
    const buffer = await this.report.toXlsx({
      runId,
      baseUrl: run.baseUrl,
      prdText: run.prdText,
      createdAt: run.createdAt,
      snapshot,
    });

    res
      .status(HttpStatus.OK)
      .setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .setHeader(
        'Content-Disposition',
        `attachment; filename="test-report-${runId.slice(0, 8)}.xlsx"`,
      )
      .send(buffer);
  }

  /**
   * Joins the stored plan to the persisted outcomes.
   *
   * The plan holds the detail a tester reads (steps, expected result); the
   * `TestCase` rows hold the outcome and reason written back after execution.
   * Neither alone is enough for the report.
   */
  private buildResults(
    plan: TestPlan | undefined,
    rows: Array<{
      externalId: string;
      description: string;
      type: string;
      status: string;
      errorLog: string | null;
    }>,
  ): TestCaseResult[] | undefined {
    if (!plan?.tests?.length) {
      return undefined;
    }

    return plan.tests.map((testCase) => {
      const row = rows.find((r) => r.externalId === testCase.id);
      return {
        id: testCase.id,
        description: testCase.description,
        type: testCase.type as TestType,
        source: (testCase.source ?? 'stated') as TestSource,
        preconditions: testCase.preconditions,
        steps: testCase.steps,
        expectedResult: testCase.expectedResult,
        priority: testCase.priority as TestPriority | undefined,
        outcome: (row?.status ?? 'PENDING') as TestOutcome,
        reason: row?.errorLog ?? 'Not executed yet.',
      };
    });
  }
}
