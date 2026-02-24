import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { AgentOrchestrator } from './agent.orchestrator';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

interface StartRunDto {
  prdText: string;
  baseUrl: string;
}

interface RunStatusResponse {
  status: string;
  plan?: unknown;
  message?: string;
}

/**
 * REST controller exposing endpoints for starting and querying agent runs.
 */
@Controller('agent-runs')
export class AgentController {
  constructor(private readonly orchestrator: AgentOrchestrator) {}

  /**
   * POST /agent-runs
   *
   * Starts a new agent run using the provided PRD text and base URL.  Returns
   * a unique run identifier.  The orchestration runs asynchronously and
   * writes artefacts to the `runs/{runId}` directory.
   */
  @Post()
  async startRun(@Body() body: StartRunDto): Promise<{ runId: string }> {
    const runId = uuidv4();
    // Fire and forget – do not block the HTTP request while the run
    // progresses.  If needed, this could be converted to a job queue.
    this.orchestrator
      .run(runId, body.prdText, body.baseUrl)
      .catch((err) => console.error(err));
    return { runId };
  }

  /**
   * GET /agent-runs/:runId
   *
   * Returns a simple status object for the given run.  If the plan file
   * exists then the run has completed planning.  If the Playwright report
   * exists then the run has finished executing.  This endpoint can be
   * extended to include detailed results, bug classifications and more.
   */
  @Get(':runId')
  getRun(@Param('runId') runId: string): RunStatusResponse {
    const runDir = path.join(process.cwd(), 'runs', runId);
    if (!fs.existsSync(runDir)) {
      return { status: 'UNKNOWN', message: 'Run not found' };
    }
    const planPath = path.join(runDir, 'plan.json');
    const reportPath = path.join(runDir, 'playwright-report');
    const status: RunStatusResponse = { status: 'CREATED' };
    if (fs.existsSync(planPath)) {
      status.status = 'PLANNED';
      status.plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    }
    if (fs.existsSync(reportPath)) {
      status.status = 'DONE';
    }
    return status;
  }
}