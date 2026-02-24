import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PlannedTestCase, TestPlan } from '../agent/agent.types';

/**
 * LLM service wraps calls to the language model.  It abstracts away the
 * provider and enforces that the planner returns JSON objects rather than
 * arbitrary prose.  The service relies on the `OPENAI_API_KEY` environment
 * variable when using OpenAI.  For a truly local deployment you can
 * substitute this implementation with a call to a local model served via
 * Ollama.
 */
@Injectable()
export class LlmService {
  private readonly openai: OpenAI | null;
  private readonly logger = new Logger(LlmService.name);

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY not set.  LLM functions will throw unless replaced with a local provider.',
      );
    }
  }

  /**
   * Asks the language model to read a PRD and extract a test plan.  The
   * returned string is parsed as JSON.  If the response cannot be parsed
   * then an exception is thrown.
   */
  async generateTestPlan(prdText: string): Promise<TestPlan> {
    if (!this.openai) {
      throw new Error('LLM unavailable – OPENAI_API_KEY is not configured');
    }
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a senior QA engineer.  Read the following product requirement and return a JSON object containing a feature name and a list of test cases.  Each test case should have a unique id, a concise description and a type (happy, negative or edge).  Do not include any text outside of the JSON.',
        },
        {
          role: 'user',
          content: prdText,
        },
      ],
      response_format: { type: 'json_object' },
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM returned an empty response');
    }
    return JSON.parse(content) as TestPlan;
  }

  /**
   * Converts a planned test case into Playwright TypeScript code.  The
   * language model is instructed to produce a valid async function using
   * Playwright's `test` and `expect` APIs.  The returned text is used
   * verbatim in the generated spec file.
   */
  async generatePlaywrightTest(
    testCase: PlannedTestCase,
    baseUrl: string,
  ): Promise<string> {
    if (!this.openai) {
      throw new Error('LLM unavailable – OPENAI_API_KEY is not configured');
    }
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a QA automation engineer.  Generate a Playwright TypeScript test using the given test case object and base URL.  Use only the Playwright API (test, page, expect).  Do not include backticks or markdown code fences.  The result must compile as TypeScript.',
        },
        {
          role: 'user',
          content: `Test case: ${JSON.stringify(testCase)}\nBase URL: ${baseUrl}`,
        },
      ],
    });
    const code = response.choices[0]?.message?.content || '';
    return code.trim();
  }

  /**
   * Analyses a failed Playwright test.  Given the test id, description and
   * log, the model classifies the failure.  This method is not used in the
   * current POC but is included for completeness.
   */
  async analyseFailure(
    testCase: PlannedTestCase,
    errorLog: string,
  ): Promise<{ classification: string; summary: string }> {
    if (!this.openai) {
      throw new Error('LLM unavailable – OPENAI_API_KEY is not configured');
    }
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a QA lead.  Analyse the following Playwright error log and classify the failure as APPLICATION_BUG, TEST_FLAKE or SELECTOR_ISSUE.  Provide a one sentence summary explaining the reason.',
        },
        {
          role: 'user',
          content: `Test: ${JSON.stringify(testCase)}\n\nError log:\n${errorLog}`,
        },
      ],
      response_format: { type: 'json_object' },
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM returned an empty failure analysis');
    }
    return JSON.parse(content) as { classification: string; summary: string };
  }
}