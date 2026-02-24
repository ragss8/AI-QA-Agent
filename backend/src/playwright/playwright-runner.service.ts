import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
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
    if (!spec.endsWith('.ts')) {
      throw new Error('Generated spec not found');
    }
    return new Promise((resolve, reject) => {
      const command = `npx playwright test ${spec} --reporter=html`;
      this.logger.log(`Executing Playwright: ${command}`);
      exec(
        command,
        { cwd: runDir, env: { ...process.env, CI: 'false' } },
        (error, stdout, stderr) => {
          if (stdout) {
            this.logger.log(stdout);
          }
          if (stderr) {
            this.logger.warn(stderr);
          }
          if (error) {
            this.logger.error(`Playwright run failed: ${error.message}`);
            return reject(error);
          }
          resolve();
        },
      );
    });
  }
}