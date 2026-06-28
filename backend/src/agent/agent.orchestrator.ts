import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { LlmService } from '../llm/llm.service';
import { PageInspectorService } from '../page-inspector/page-inspector.service';
import { PlaywrightRunnerService } from '../playwright/playwright-runner.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentStatus, TestPlan } from './agent.types';

@Injectable()
export class AgentOrchestrator {
  private readonly runsRoot = path.join(process.cwd(), 'runs');

  constructor(
    private readonly llm: LlmService,
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
      const plan: TestPlan = await this.llm.generateTestPlan(prdText);
      await Promise.all([
        fs.writeFile(path.join(runDir, 'plan.json'), JSON.stringify(plan, null, 2)),
        this.prisma.agentRun.update({
          where: { id: runId },
          data: {
            status: AgentStatus.PLANNED,
            testPlan: plan as unknown as Prisma.InputJsonValue,
            testCases: {
              create: plan.tests.map((tc) => ({
                externalId: tc.id,
                description: tc.description,
                type: tc.type,
                status: 'PENDING',
              })),
            },
          },
        }),
      ]);

      const pageContext = await this.inspector.inspect(baseUrl);
      await this.prisma.agentRun.update({
        where: { id: runId },
        data: { status: AgentStatus.INSPECTED },
      });

      const spec = await this.llm.generatePlaywrightSpec(plan.tests, baseUrl, pageContext);

      await Promise.all([
        fs.writeFile(path.join(runDir, 'generated.spec.ts'), spec),
        this.prisma.agentRun.update({
          where: { id: runId },
          data: { status: AgentStatus.GENERATED },
        }),
      ]);

      await this.runner.run(runId);
      await this.prisma.agentRun.update({
        where: { id: runId },
        data: { status: AgentStatus.DONE },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown agent run failure';
      await this.prisma.agentRun
        .update({ where: { id: runId }, data: { status: AgentStatus.FAILED, message } })
        .catch(() => undefined);
      throw error;
    }
  }

}
