import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Runs the same checker as `pnpm check:no-bluff`, so the no-bluff rules fail `pnpm test` too.
const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('no-bluff checker', () => {
  it('passes on the current source tree', () => {
    const output = execFileSync(process.execPath, [resolve(FRONTEND, 'scripts', 'no-bluff-check.mjs')], { encoding: 'utf8' });
    expect(output).toContain('0 violations');
  });
});
