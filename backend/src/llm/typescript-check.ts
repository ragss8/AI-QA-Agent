import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Type-checks a generated spec and returns the compiler's complaints, or null
 * when it compiles.
 *
 * The file must sit inside the backend package: `tsc` resolves
 * `@playwright/test` by walking up from the file's own directory, so checking a
 * spec held anywhere else fails with a misleading TS2307 "cannot find module".
 */
export async function checkSpecCompiles(specSource: string): Promise<string | null> {
  const dir = await fs.mkdtemp(path.join(process.cwd(), '.tscheck-'));
  const file = path.join(dir, 'candidate.spec.ts');

  try {
    await fs.writeFile(file, specSource);
    const errors = await runTsc(file);
    return errors;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runTsc(file: string): Promise<string | null> {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = [
    'tsc', '--noEmit',
    '--skipLibCheck',
    '--esModuleInterop',
    '--target', 'es2018',
    '--module', 'commonjs',
    '--pretty', 'false', // plain text, so the model gets parseable errors back
    file,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), shell: false });
    let out = '';

    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (out += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(null);
        return;
      }
      // Strip the temp directory prefix so errors read as line/column only.
      resolve(out.replace(new RegExp(escapeRegExp(os.tmpdir()), 'g'), '').trim() || `tsc exited ${code}`);
    });
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Selectors the spec uses that do not appear in the page markup it was given.
 * A model that invents selectors produces tests that cannot pass on a page it
 * has not memorised, so this is scored as a hard penalty.
 */
export function ungroundedSelectors(specSource: string, pageContext: string): string[] {
  const used = new Set<string>();
  // Backreference the opening quote so selectors containing the other quote
  // style, e.g. input[type="checkbox"], are captured whole rather than clipped.
  const pattern =
    /(?:fill|click|locator|check|uncheck|selectOption|type)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

  for (const match of specSource.matchAll(pattern)) {
    used.add(match[2]);
  }

  return [...used].filter((selector) => !isGrounded(selector, pageContext));
}

/**
 * Standard elements are always legitimate to select, whether or not they appear
 * in the extracted markup — the extract is only the form, so `body` and heading
 * tags are absent from it but obviously present on the page.
 */
const STANDARD_TAGS = new Set([
  'html', 'body', 'main', 'header', 'footer', 'nav', 'section', 'article', 'div',
  'span', 'p', 'a', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'form', 'input',
  'button', 'select', 'option', 'textarea', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

function isGrounded(selector: string, pageContext: string): boolean {
  const haystack = pageContext.toLowerCase();

  // Split into identifier parts: `.flash.error` -> ['flash','error'].
  // Keep the separators' meaning by checking the raw selector for #/. first.
  const identifiers = [...selector.matchAll(/[#.]([A-Za-z0-9_-]+)/g)].map((m) => m[1]);

  if (identifiers.length > 0) {
    // An id or class must actually appear in the markup.
    return identifiers.every((id) => haystack.includes(id.toLowerCase()));
  }

  // No id/class parts: attribute selectors and bare tags.
  const attrValues = [...selector.matchAll(/\[[^\]]*?=['"]?([^'"\]]+)/g)].map((m) => m[1]);
  if (attrValues.length > 0) {
    return attrValues.every((v) => haystack.includes(v.toLowerCase()));
  }

  const tag = selector.trim().split(/[\s>:]/)[0].toLowerCase();
  return STANDARD_TAGS.has(tag) || haystack.includes(tag);
}
