import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AgentOrchestrator } from './agent.orchestrator';
import { AgentStatus, RunStatusSnapshot } from './agent.types';

interface StartRunDto {
  prdText: string;
  baseUrl: string;
}

/**
 * REST controller exposing endpoints for starting and querying agent runs.
 */
@Controller('agent-runs')
export class AgentController {
  private readonly runsRoot = path.join(process.cwd(), 'runs');

  constructor(private readonly orchestrator: AgentOrchestrator) {}

  /**
   * POST /agent-runs
   *
   * Starts a new agent run using the provided PRD text and base URL. Returns
   * a unique run identifier. The orchestration runs asynchronously and
   * writes artefacts to the `runs/{runId}` directory.
   */
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

    // Fire and forget so the request returns immediately.
    this.orchestrator
      .run(runId, prdText, baseUrl)
      .catch((error) => console.error(error));

    return { runId };
  }

  /**
   * GET /agent-runs/:runId
   *
   * Returns the latest persisted run status for the given run identifier.
   */
  @Get(':runId')
  async getRun(@Param('runId') runId: string): Promise<RunStatusSnapshot> {
    const statusPath = path.join(this.runsRoot, runId, 'status.json');

    try {
      const statusJson = await fs.readFile(statusPath, 'utf8');
      return JSON.parse(statusJson) as RunStatusSnapshot;
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return {
          status: AgentStatus.UNKNOWN,
          message: 'Run not found',
        };
      }

      throw error;
    }
  }

  private isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }
}
