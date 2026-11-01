import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PlannedTestCase, TestPlan } from '../agent/agent.types';

const REASONING_MODEL = 'claude-sonnet-4-6';
const CODEGEN_MODEL = 'claude-haiku-4-5';

export interface FailureAnalysis {
  classification: 'APPLICATION_BUG' | 'TEST_FLAKE' | 'SELECTOR_ISSUE';
  summary: string;
}

@Injectable()
export class LlmService {
  private readonly client: Anthropic | null;
  private readonly logger = new Logger(LlmService.name);

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
    const response = await this.requireClient().messages.create({
      model: REASONING_MODEL,
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
      system:
        "You are a QA automation engineer. Generate a complete Playwright TypeScript spec file for all the given test cases. Begin with exactly one import line: import { test, expect } from '@playwright/test'; Do not add any other imports. Write minimal, concise code with no inline comments. The file must compile as TypeScript. Do not include backticks or markdown code fences. Use only the exact selectors visible in the provided page HTML — do not guess or invent selectors.",
      messages: [
        {
          role: 'user',
          content: `Base URL: ${baseUrl}\n\nActual page HTML (use these exact selectors):\n${pageContext}\n\nTest cases:\n${JSON.stringify(testCases, null, 2)}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const spec = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    if (!spec) {
      throw new Error('LLM did not return a Playwright spec');
    }
    return spec;
  }

  async analyseFailure(
    testCase: PlannedTestCase,
    errorLog: string,
  ): Promise<FailureAnalysis> {
    const response = await this.requireClient().messages.create({
      model: REASONING_MODEL,
      max_tokens: 512,
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
