import { classify } from '../src/llm/routing.provider';

/**
 * Asserts the routing decisions that are easy to get wrong:
 * a spend-cap 429 must not be treated as transient, and a 400 must never be
 * cached as "no credits".
 */
const cases: Array<{
  label: string;
  error: unknown;
  remember: boolean;
  permanent: boolean;
}> = [
  { label: '401 bad key', error: { status: 401 }, remember: true, permanent: true },
  { label: '403 no permission', error: { status: 403 }, remember: true, permanent: true },
  { label: '402 out of credits', error: { status: 402 }, remember: true, permanent: false },
  {
    label: '429 with retry-after (throttle)',
    error: { status: 429, headers: { 'retry-after': '30' } },
    remember: false,
    permanent: false,
  },
  {
    label: '429 without retry-after (spend cap)',
    error: { status: 429, headers: {} },
    remember: true,
    permanent: false,
  },
  { label: '400 ambiguous', error: { status: 400 }, remember: false, permanent: false },
  { label: '500 server', error: { status: 500 }, remember: false, permanent: false },
  { label: 'network error', error: new Error('ECONNREFUSED'), remember: false, permanent: false },
];

let failures = 0;
for (const c of cases) {
  const got = classify(c.error);
  const ok = got.remember === c.remember && got.permanent === c.permanent;
  if (!ok) {
    failures++;
    console.log(
      `  FAIL ${c.label}: expected remember=${c.remember} permanent=${c.permanent}, ` +
        `got remember=${got.remember} permanent=${got.permanent}`,
    );
  } else {
    console.log(`  ok   ${c.label.padEnd(34)} -> ${got.reason}`);
  }
}

console.log(failures === 0 ? '\nROUTER SELF-CHECK PASS' : `\nROUTER SELF-CHECK FAIL (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
