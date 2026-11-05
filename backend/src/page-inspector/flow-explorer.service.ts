import { Injectable, Logger } from '@nestjs/common';
import { Browser, Page, chromium } from 'playwright';
import {
  ExplorerAction,
  FlowStep,
  FlowTrace,
  SyntheticInput,
} from '../agent/agent.types';
import { LlmProvider } from '../llm/llm-provider';

const MAX_STEPS = 10;
/** Stalls tolerated before concluding the app genuinely rejected the input. */
const MAX_STALLS = 2;
const STEP_TIMEOUT_MS = 20_000;
const MARKUP_BUDGET = 2500;

/**
 * Walks a live application toward a described goal, recording the markup of
 * every screen it reaches.
 *
 * Tests written from a single landing page invent selectors for every screen
 * past the first, which is the dominant failure mode on multi-step flows. By
 * driving a real browser and capturing each screen, generation can be grounded
 * in markup that actually exists.
 *
 * Exploration is deliberately bounded: at most `MAX_STEPS` actions, and it
 * stops as soon as the model reports the goal reached or itself blocked. A
 * credential or record id that must match real data cannot be guessed, so the
 * model is instructed to try once and then report blocked rather than looping.
 */
@Injectable()
export class FlowExplorerService {
  private readonly logger = new Logger(FlowExplorerService.name);

  constructor(private readonly llm: LlmProvider) {}

  async explore(startUrl: string, goal: string): Promise<FlowTrace> {
    const trace: FlowTrace = {
      goal,
      steps: [],
      reachedGoal: false,
      syntheticInputs: [],
      advisories: [],
    };

    let browser: Browser | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(startUrl, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT_MS });

      trace.steps.push({
        index: 0,
        url: page.url(),
        action: 'start',
        markup: await this.captureMarkup(page),
      });

      const history: string[] = [];
      let stalls = 0;

      for (let step = 1; step <= MAX_STEPS; step++) {
        const current = trace.steps[trace.steps.length - 1];
        const decision = await this.llm.chooseAction(goal, current.markup, history);

        if (decision.action === 'done') {
          trace.reachedGoal = true;
          this.logger.log(`Reached goal in ${step - 1} actions`);
          break;
        }

        if (decision.action === 'blocked') {
          trace.stoppedBecause = decision.reasoning;
          trace.advisories.push(
            `Exploration stopped before the goal: ${decision.reasoning}`,
          );
          this.logger.warn(`Blocked: ${decision.reasoning}`);
          break;
        }

        const applied = await this.apply(page, decision);
        history.push(`${step}. ${applied}`);
        this.recordSynthetic(trace, decision);

        await page
          .waitForLoadState('networkidle', { timeout: STEP_TIMEOUT_MS })
          .catch(() => undefined);

        const markup = await this.captureMarkup(page);
        const previous = current.markup;

        trace.steps.push({
          index: step,
          url: page.url(),
          action: applied,
          markup,
          note: decision.reasoning,
        });

        // Only submitting actions are expected to move the app on. Typing into a
        // field leaves the markup identical, so treating that as a stall would
        // abandon the flow one action after it started.
        const shouldHaveAdvanced = ['click', 'press', 'goto'].includes(decision.action);

        if (shouldHaveAdvanced && markup === previous && page.url() === current.url) {
          stalls++;
          // Tell the model its action did nothing and let it try once more. A
          // small model sometimes picks a nonsense action (clicking a text
          // input); one correction recovers the flow, repeated stalls mean the
          // application genuinely rejected the input.
          history.push(`   ^ that had NO effect on the screen — try something else`);
          this.logger.warn(`Stall ${stalls}/${MAX_STALLS} after: ${applied}`);

          if (stalls >= MAX_STALLS) {
            trace.stoppedBecause = `screen did not change after: ${applied}`;
            trace.advisories.push(
              `The application did not respond to "${applied}". If this is a login or a lookup, the value used was almost certainly rejected.`,
            );
            break;
          }
        }

        if (step === MAX_STEPS) {
          trace.stoppedBecause = `step budget of ${MAX_STEPS} actions exhausted`;
        }
      }
    } catch (error) {
      trace.stoppedBecause =
        error instanceof Error ? error.message : 'exploration failed';
      this.logger.error(`Exploration failed: ${trace.stoppedBecause}`);
    } finally {
      await browser?.close().catch(() => undefined);
    }

    this.addAdvisories(trace);
    return trace;
  }

  /** Executes one decided action and returns a human-readable description. */
  private async apply(page: Page, decision: ExplorerAction): Promise<string> {
    const { action, selector = '', value = '' } = decision;
    const target = page.locator(selector).first();

    switch (action) {
      case 'fill':
        await target.fill(value, { timeout: STEP_TIMEOUT_MS });
        return `fill ${selector} with "${value}"`;
      case 'click':
        await target.click({ timeout: STEP_TIMEOUT_MS });
        return `click ${selector}`;
      case 'select':
        await target.selectOption(value, { timeout: STEP_TIMEOUT_MS });
        return `select "${value}" in ${selector}`;
      case 'press':
        await target.press(value || 'Enter', { timeout: STEP_TIMEOUT_MS });
        return `press ${value || 'Enter'} on ${selector}`;
      case 'goto':
        await page.goto(value, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT_MS });
        return `navigate to ${value}`;
      default:
        return `no-op (${action})`;
    }
  }

  /**
   * Captures the interactive parts of the current screen, plus any visible
   * status or error text, which is what assertions need to reference.
   */
  private async captureMarkup(page: Page): Promise<string> {
    const raw = await page
      .locator(
        'input, button, select, textarea, label, a[href], [role="alert"], [role="status"], h1, h2, [class*="error"], [id*="error"], [class*="flash"], [id*="flash"]',
      )
      .evaluateAll((els) => els.map((el) => el.outerHTML).join('\n'))
      .catch(() => '');

    return stripNoise(raw).slice(0, MARKUP_BUDGET);
  }

  /** Notes any value that did not come from the user, for the report. */
  private recordSynthetic(trace: FlowTrace, decision: ExplorerAction): void {
    if (decision.action !== 'fill' && decision.action !== 'select') {
      return;
    }
    if (!decision.value) {
      return;
    }

    // Decided here rather than trusting the model: a value the goal never
    // mentioned must have been invented. Asking the model to self-declare was
    // tried first and a 7B simply omitted the optional field.
    const inGoal = trace.goal.toLowerCase().includes(decision.value.toLowerCase());
    if (inGoal && !decision.valueWasInvented) {
      return;
    }

    const field = decision.selector ?? '(unknown field)';
    const needsRealValue =
      /password|credential|employee|user ?id|account|otp|token|pin|reference|invoice|customer ?id/i.test(
        `${field} ${decision.reasoning}`,
      );

    trace.syntheticInputs.push({
      field,
      value: decision.value,
      rationale: decision.reasoning,
      needsRealValue,
    });
  }

  /** Turns what happened into advice the tester can act on. */
  private addAdvisories(trace: FlowTrace): void {
    const mustBeReal = trace.syntheticInputs.filter((i) => i.needsRealValue);

    if (mustBeReal.length > 0) {
      trace.advisories.push(
        `The agent had to invent ${mustBeReal.length} value(s) that must match real records to work: ${mustBeReal
          .map((i) => `${i.field}="${i.value}"`)
          .join(', ')}. Supplying real ones in the description would let the run reach further into the flow.`,
      );
    }

    if (!trace.reachedGoal && trace.steps.length <= 1) {
      trace.advisories.push(
        'Exploration never progressed past the entry screen, so every test case below is inferred from the description rather than from observed screens. Treat the selectors as unverified.',
      );
    } else if (!trace.reachedGoal) {
      trace.advisories.push(
        `Only ${trace.steps.length} screen(s) were observed. Cases covering anything deeper are inferred and may reference selectors that do not exist.`,
      );
    }
  }
}

/**
 * Utility-CSS frameworks put enormous class strings on every element; measured
 * on a real shadcn app, 76% of captured markup was class attributes. Dropping
 * the long ones keeps the budget for selectors that matter. Also drops inline
 * SVG, which is pure noise here.
 */
export function stripNoise(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/\sclass="([^"]*)"/g, (match, value: string) =>
      value.length > 40 ? '' : match,
    )
    .replace(/\sstyle="[^"]*"/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
