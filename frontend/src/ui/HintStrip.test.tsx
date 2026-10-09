import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HintStrip } from './HintStrip';

const SENTENCES = ['The list shows saved cases.', 'Counts come from GET /stats.'] as const;

describe('HintStrip', () => {
  it('shows the how-to-read sentences', () => {
    render(<HintStrip pageId="demo" sentences={SENTENCES} />);
    expect(screen.getByText('How to read this page')).toBeTruthy();
    expect(screen.getByText('The list shows saved cases. Counts come from GET /stats.')).toBeTruthy();
  });

  it('is hidden once dismissed and stays hidden after a remount', () => {
    const first = render(<HintStrip pageId="demo" sentences={SENTENCES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss how-to-read hint' }));
    expect(screen.queryByText('How to read this page')).toBeNull();
    expect(window.localStorage.getItem('vc-hint-dismissed:demo')).toBe('1');
    first.unmount();

    render(<HintStrip pageId="demo" sentences={SENTENCES} />);
    expect(screen.queryByText('How to read this page')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show how to read this page' })).toBeTruthy();
  });

  it('remembers the choice per page', () => {
    window.localStorage.setItem('vc-hint-dismissed:other', '1');
    render(<HintStrip pageId="demo" sentences={SENTENCES} />);
    expect(screen.getByText('How to read this page')).toBeTruthy();
  });

  it('brings the hint back and forgets the dismissal', () => {
    window.localStorage.setItem('vc-hint-dismissed:demo', '1');
    render(<HintStrip pageId="demo" sentences={SENTENCES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show how to read this page' }));
    expect(screen.getByText('How to read this page')).toBeTruthy();
    expect(window.localStorage.getItem('vc-hint-dismissed:demo')).toBeNull();
  });

  it('renders and dismisses for the session when storage is blocked', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<HintStrip pageId="demo" sentences={SENTENCES} />);
    expect(screen.getByText('How to read this page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss how-to-read hint' }));
    expect(screen.queryByText('How to read this page')).toBeNull();
  });
});
