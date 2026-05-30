import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './agent/agent.controller';
import { AgentOrchestrator } from './agent/agent.orchestrator';
import { LlmService } from './llm/llm.service';
import { PlaywrightRunnerService } from './playwright/playwright-runner.service';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AgentController],
  providers: [AgentOrchestrator, LlmService, PlaywrightRunnerService, PrismaService],
})
export class AppModule {}