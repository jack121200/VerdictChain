import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open scenario
      </button>
      <Modal
        open={open}
        title="Inject scenario"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button type="button">Run</button>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('moves focus into the dialog when it opens', () => {
    render(<Harness onClose={() => undefined} />);
    const opener = screen.getByRole('button', { name: 'Open scenario' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Inject scenario' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and returns focus to the opener', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open scenario' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the dialog', () => {
    render(<Harness onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open scenario' }));
    const close = screen.getByRole('button', { name: 'Close dialog' });
    const run = screen.getByRole('button', { name: 'Run' });
    run.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('has a palette variant with no title bar and no close button, still named and closable with Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open variant="palette" title="Command palette" onClose={onClose}>
        <input aria-label="Search" />
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(screen.queryByRole('button', { name: 'Close dialog' })).toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Search'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
