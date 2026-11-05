import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './agent/agent.controller';
import { AgentOrchestrator } from './agent/agent.orchestrator';
import { ReportService } from './agent/report.service';
import { AnthropicProvider } from './llm/anthropic.provider';
import { LlmProvider } from './llm/llm-provider';
import { OllamaProvider } from './llm/ollama.provider';
import { RepairingLlmProvider } from './llm/repairing.provider';
import { RoutingLlmProvider } from './llm/routing.provider';
import { FlowExplorerService } from './page-inspector/flow-explorer.service';
import { PageInspectorService } from './page-inspector/page-inspector.service';
import { PlaywrightRunnerService } from './playwright/playwright-runner.service';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AgentController],
  providers: [
    AgentOrchestrator,
    AnthropicProvider,
    OllamaProvider,
    // Anthropic while the key works, local model otherwise, with the
    // compile-repair loop wrapping both. Repair is free when specs already
    // compile: it only re-prompts on a tsc failure.
    {
      provide: LlmProvider,
      useFactory: (anthropic: AnthropicProvider, local: OllamaProvider) =>
        new RepairingLlmProvider(new RoutingLlmProvider(anthropic, local)),
      inject: [AnthropicProvider, OllamaProvider],
    },
    FlowExplorerService,
    PageInspectorService,
    PlaywrightRunnerService,
    PrismaService,
    ReportService,
  ],
})
export class AppModule {}