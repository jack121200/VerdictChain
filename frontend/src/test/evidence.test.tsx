import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { evidenceOutsideMono } from './evidence';

const UUID = 'e4c7c25e-02ff-44f4-aac1-530598a934cd';
const DIGEST = 'a1b2c3d4'.repeat(8);

describe('evidenceOutsideMono', () => {
  it('finds an id, a digest and a short id that sit outside the evidence font', () => {
    const { container } = render(
      <div>
        <span>{UUID}</span>
        <p>{DIGEST}</p>
        <b>e4c7c25e</b>
      </div>,
    );

    expect(evidenceOutsideMono(container)).toEqual([UUID, DIGEST, 'e4c7c25e']);
  });

  it('accepts the same texts inside a font-mono element, on itself or on an ancestor', () => {
    const { container } = render(
      <div>
        <span className="font-mono">{UUID}</span>
        <section className="font-mono">
          <p>
            <em>{DIGEST}</em>
          </p>
        </section>
      </div>,
    );

    expect(evidenceOutsideMono(container)).toEqual([]);
  });

  it('ignores ordinary words and numbers', () => {
    const { container } = render(<p>The deadline is in 12345678 days; cafe and deadbeef stay words in prose.</p>);

    expect(evidenceOutsideMono(container)).toEqual([]);
  });
});
