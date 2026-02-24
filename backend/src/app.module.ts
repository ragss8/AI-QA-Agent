import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './agent/agent.controller';
import { AgentOrchestrator } from './agent/agent.orchestrator';
import { LlmService } from './llm/llm.service';
import { PlaywrightRunnerService } from './playwright/playwright-runner.service';

/**
 * Root module for the application.  It wires together the various
 * controllers and services used by the agent.  Additional modules can be
 * imported here as the system grows.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AgentController],
  providers: [AgentOrchestrator, LlmService, PlaywrightRunnerService],
})
export class AppModule {}