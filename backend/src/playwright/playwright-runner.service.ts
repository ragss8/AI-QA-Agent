import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Service responsible for invoking Playwright to execute the generated test
 * suite.  It expects a `generated.spec.ts` file to be present in the run
 * directory.  Playwright will produce a report under `playwright-report`.
 */
@Injectable()
export class PlaywrightRunnerService {
  private readonly logger = new Logger(PlaywrightRunnerService.name);

  async run(runId: string): Promise<void> {
    const runDir = path.join(process.cwd(), 'runs', runId);
    const spec = path.join(runDir, 'generated.spec.ts');
    if (path.extname(spec) !== '.ts') {
      throw new Error('Generated spec not found');
    }
    await fs.access(spec);

    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const args = [
      'playwright', 'test', spec,
      '--reporter=html',
      `--output=${path.join(runDir, 'test-results')}`,
    ];

    this.logger.log(`Executing Playwright for run ${runId}`);

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CI: 'false',
          PLAYWRIGHT_HTML_REPORT: path.join(runDir, 'playwright-report'),
        },
        shell: false,
      });

      child.stdout.on('data', (chunk: Buffer | string) => {
        this.logger.log(chunk.toString().trimEnd());
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        this.logger.warn(chunk.toString().trimEnd());
      });

      child.on('error', (error) => {
        this.logger.error(`Failed to start Playwright: ${error.message}`);
        reject(error);
      });

      child.on('close', (code) => {
        // Code 1 means tests ran but some failed — that is a valid outcome, not an error.
        // Codes 2+ mean Playwright itself failed to run (bad config, missing browser, etc.).
        if (code === 0 || code === 1) {
          resolve();
          return;
        }

        reject(new Error(`Playwright exited with code ${code ?? 'unknown'}`));
      });
    });
  }
}
