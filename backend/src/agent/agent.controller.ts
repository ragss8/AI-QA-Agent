import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { AgentOrchestrator } from './agent.orchestrator';
import { AgentStatus, RunStatusSnapshot, TestPlan } from './agent.types';

interface StartRunDto {
  prdText: string;
  baseUrl: string;
}

@Controller('agent-runs')
export class AgentController {
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

    const runId = uuidv4();

    this.orchestrator
      .run(runId, prdText, baseUrl)
      .catch((error) => console.error(error));

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
