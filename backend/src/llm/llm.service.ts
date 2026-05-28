import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PlannedTestCase, TestPlan } from '../agent/agent.types';

@Injectable()
export class LlmService {
  private readonly client: Anthropic | null;
  private readonly logger = new Logger(LlmService.name);
  private readonly model = 'claude-opus-4-7';

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set. LLM functions will throw unless replaced with a local provider.',
      );
    }
  }

  async generateTestPlan(prdText: string): Promise<TestPlan> {
    if (!this.client) {
      throw new Error('LLM unavailable – ANTHROPIC_API_KEY is not configured');
    }
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system:
        'You are a senior QA engineer. Read the following product requirement and return a structured test plan with a feature name and a list of test cases. Each test case must have a unique id, a concise description, and a type (happy, negative, or edge).',
      messages: [{ role: 'user', content: prdText }],
      tools: [
        {
          name: 'submit_test_plan',
          description: 'Submit the structured test plan extracted from the PRD.',
          input_schema: {
            type: 'object' as const,
            properties: {
              feature: { type: 'string' },
              tests: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    description: { type: 'string' },
                    type: { type: 'string', enum: ['happy', 'negative', 'edge'] },
                  },
                  required: ['id', 'description', 'type'],
                },
              },
            },
            required: ['feature', 'tests'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_test_plan' },
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('LLM did not return a tool use block');
    }
    const raw = toolBlock.input as Record<string, unknown>;
    return {
      feature: raw.feature as string,
      tests: ((raw.tests ?? raw.testCases ?? raw.test_cases ?? []) as PlannedTestCase[]),
    };
  }

  async generatePlaywrightTest(
    testCase: PlannedTestCase,
    baseUrl: string,
  ): Promise<string> {
    if (!this.client) {
      throw new Error('LLM unavailable – ANTHROPIC_API_KEY is not configured');
    }
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system:
        'You are a QA automation engineer. Generate a Playwright TypeScript test using the given test case object and base URL. Use only the Playwright API (test, page, expect). Do not include backticks or markdown code fences. The result must compile as TypeScript.',
      messages: [
        {
          role: 'user',
          content: `Test case: ${JSON.stringify(testCase)}\nBase URL: ${baseUrl}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.type === 'text' ? textBlock.text.trim() : '';
  }

  async analyseFailure(
    testCase: PlannedTestCase,
    errorLog: string,
  ): Promise<{ classification: string; summary: string }> {
    if (!this.client) {
      throw new Error('LLM unavailable – ANTHROPIC_API_KEY is not configured');
    }
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system:
        'You are a QA lead. Analyse the following Playwright error log and classify the failure as APPLICATION_BUG, TEST_FLAKE, or SELECTOR_ISSUE. Provide a one-sentence summary explaining the reason.',
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
          input_schema: {
            type: 'object' as const,
            properties: {
              classification: {
                type: 'string',
                enum: ['APPLICATION_BUG', 'TEST_FLAKE', 'SELECTOR_ISSUE'],
              },
              summary: { type: 'string' },
            },
            required: ['classification', 'summary'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_failure_analysis' },
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('LLM did not return a failure analysis');
    }
    return toolBlock.input as { classification: string; summary: string };
  }
}
