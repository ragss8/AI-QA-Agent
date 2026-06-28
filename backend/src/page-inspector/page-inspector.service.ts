import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright';

@Injectable()
export class PageInspectorService {
  private readonly logger = new Logger(PageInspectorService.name);

  async inspect(url: string): Promise<string> {
    this.logger.log(`Inspecting page: ${url}`);

    try {
      const response = await fetch(url);
      const html = await response.text();
      const extracted = this.extractFormHtml(html);
      if (extracted) {
        this.logger.log('Page inspected via HTTP fetch (SSR/static)');
        return extracted;
      }
    } catch (err) {
      this.logger.warn(`HTTP fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.logger.log('Falling back to Playwright for page inspection (SPA)');
    return this.inspectWithPlaywright(url);
  }

  private extractFormHtml(html: string): string | null {
    const hasInputs = /<input[\s>]/i.test(html);
    const hasForms = /<form[\s>]/i.test(html);

    if (!hasInputs && !hasForms) {
      return null;
    }

    const formMatches = html.match(/<form[\s\S]*?<\/form>/gi) ?? [];
    if (formMatches.length > 0) {
      return formMatches.join('\n').slice(0, 3000);
    }

    const inputs = html.match(/<input[^>]*>/gi) ?? [];
    const buttons = html.match(/<button[\s\S]*?<\/button>/gi) ?? [];
    const combined = [...inputs, ...buttons].join('\n');
    return combined.slice(0, 3000) || null;
  }

  private async inspectWithPlaywright(url: string): Promise<string> {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      const formHtml = await page
        .locator('form')
        .first()
        .innerHTML()
        .catch(() => null);

      if (formHtml) {
        this.logger.log('Extracted form HTML via Playwright');
        return formHtml.slice(0, 3000);
      }

      const elements = await page
        .locator('input, button, select, textarea, label')
        .evaluateAll((els) => els.map((el) => el.outerHTML).join('\n'));

      this.logger.log('Extracted individual form elements via Playwright');
      return elements.slice(0, 3000);
    } finally {
      await browser.close();
    }
  }
}
