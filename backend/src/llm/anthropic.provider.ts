import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  ExplorerAction,
  FlowTrace,
  PlannedTestCase,
  TestPlan,
} from '../agent/agent.types';
import {
  ANALYSIS_SYSTEM_PROMPT,
  EXPLORER_ACTION_SCHEMA,
  EXPLORER_SYSTEM_PROMPT,
  FAILURE_ANALYSIS_SCHEMA,
  FailureAnalysis,
  LlmProvider,
  PLAN_SYSTEM_PROMPT,
  SPEC_SYSTEM_PROMPT,
  TEST_PLAN_SCHEMA,
  buildPlanPrompt,
  buildSpecPrompt,
} from './llm-provider';

const REASONING_MODEL = 'claude-sonnet-4-6';
const CODEGEN_MODEL = 'claude-haiku-4-5';

@Injectable()
export class AnthropicProvider extends LlmProvider {
  readonly name = 'anthropic';
  readonly model = `${REASONING_MODEL}+${CODEGEN_MODEL}`;

  private readonly client: Anthropic | null;
  private readonly logger = new Logger(AnthropicProvider.name);

  constructor() {
    super();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    // maxRetries: 0 so the router can fail over immediately instead of
    // waiting out the SDK's two backoff retries.
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 0 }) : null;
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not set; this provider will throw if used.');
    }
  }

  /** True when a key is configured at all. The router still has to try a call. */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  async generateTestPlan(prdText: string, trace?: FlowTrace): Promise<TestPlan> {
    const response = await this.requireClient().messages.create({
      model: REASONING_MODEL,
      max_tokens: 4096,
      system: PLAN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPlanPrompt(prdText, trace) }],
      tools: [
        {
          name: 'submit_test_plan',
          description: 'Submit the structured test plan extracted from the PRD.',
          input_schema: TEST_PLAN_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_test_plan' },
    });

    return this.toolInput<TestPlan>(response, 'a test plan');
  }

  async generatePlaywrightSpec(
    testCases: PlannedTestCase[],
    baseUrl: string,
    pageContext: string,
  ): Promise<string> {
    const response = await this.requireClient().messages.create({
      model: CODEGEN_MODEL,
      max_tokens: 8192,
      system: SPEC_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildSpecPrompt(testCases, baseUrl, pageContext) },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const spec = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    if (!spec) {
      throw new Error('LLM did not return a Playwright spec');
    }
    return spec;
  }

  async chooseAction(
    goal: string,
    pageMarkup: string,
    history: string[],
  ): Promise<ExplorerAction> {
    const response = await this.requireClient().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1024,
      system: EXPLORER_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Goal:\n${goal}\n\nDone so far:\n${history.join('\n') || '(nothing yet)'}\n\nCurrent screen:\n${pageMarkup}`,
        },
      ],
      tools: [
        {
          name: 'submit_action',
          description: 'Submit the next browser action.',
          input_schema: EXPLORER_ACTION_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_action' },
    });

    return this.toolInput<ExplorerAction>(response, 'an explorer action');
  }

  async analyseFailure(
    testCase: PlannedTestCase,
    errorLog: string,
  ): Promise<FailureAnalysis> {
    const response = await this.requireClient().messages.create({
      model: REASONING_MODEL,
      max_tokens: 512,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Test: ${JSON.stringify(testCase)}\n\nError log:\n${errorLog}`,
        },
      ],
      tools: [
        {
          name: 'submit_failure_analysis',
          description: 'Submit the failure classification and summary.',
          input_schema: FAILURE_ANALYSIS_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_failure_analysis' },
    });

    return this.toolInput<FailureAnalysis>(response, 'a failure analysis');
  }

  private requireClient(): Anthropic {
    if (!this.client) {
      throw new Error('LLM unavailable – ANTHROPIC_API_KEY is not configured');
    }
    return this.client;
  }

  // Every tool call here is forced via tool_choice, so the schema is the contract.
  private toolInput<T>(response: Anthropic.Message, expected: string): T {
    const block = response.content.find((b) => b.type === 'tool_use');
    if (block?.type !== 'tool_use') {
      throw new Error(`LLM did not return ${expected}`);
    }
    return block.input as T;
  }
}
