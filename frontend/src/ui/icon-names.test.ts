import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from './icon-names';

describe('ICON_NAMES', () => {
  it('has no duplicate: Google Fonts refuses a repeated icon_names entry (HTTP 400) and every icon then shows as plain text', () => {
    const repeated = ICON_NAMES.filter((name, index) => ICON_NAMES.indexOf(name) !== index);
    expect(repeated).toEqual([]);
  });

  it('only holds Material Symbols names: lowercase letters, digits and underscores', () => {
    for (const name of ICON_NAMES) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
