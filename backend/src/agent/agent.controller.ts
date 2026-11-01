import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AgentOrchestrator } from './agent.orchestrator';
import { AgentStatus, RunStatusSnapshot, TestPlan } from './agent.types';

interface StartRunDto {
  prdText: string;
  baseUrl: string;
}

@Controller('agent-runs')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly prisma: PrismaService,
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
      this.logger.error(`Run ${runId} failed`, error instanceof Error ? error.stack : error);
    });

    return { runId };
  }

  @Get(':runId')
  async getRun(@Param('runId') runId: string): Promise<RunStatusSnapshot> {
    const run = await this.prisma.agentRun.findUnique({ where: { id: runId } });

    if (!run) {
      return { status: AgentStatus.UNKNOWN, message: 'Run not found' };
    }

    return {
      status: run.status as AgentStatus,
      plan: run.testPlan as unknown as TestPlan | undefined,
      message: run.message ?? undefined,
    };
  }
}
