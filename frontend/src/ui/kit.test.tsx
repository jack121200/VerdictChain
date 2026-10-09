import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cn } from '../lib/cn';
import { AgentChip } from './AgentChip';
import { Button } from './Button';
import { Card } from './Card';
import { CopyHash } from './CopyHash';
import { EmptyState } from './EmptyState';
import { PageHeader, SectionHeader } from './Headings';
import { Icon } from './Icon';
import { Pill } from './Pill';
import { ProgressBar } from './ProgressBar';
import { Ring } from './Ring';
import { Select } from './Select';
import { Skeleton } from './Skeleton';
import { Slider } from './Slider';
import { Sparkline } from './Sparkline';
import { StatusDot } from './StatusDot';
import { Table } from './Table';
import { Tabs } from './Tabs';
import { Toggle } from './Toggle';
import { TrajectoryChart } from './TrajectoryChart';

describe('cn', () => {
  it('joins class names and skips falsy entries', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('Icon', () => {
  it('is named when given a label and hidden from assistive tech otherwise', () => {
    const { unmount } = render(<Icon name="warning" label="Below isolation threshold" />);
    expect(screen.getByRole('img', { name: 'Below isolation threshold' })).toBeTruthy();
    unmount();
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('Button', () => {
  it('runs its click handler when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables itself and marks itself busy while a request is in flight', () => {
    render(<Button busy>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});

describe('layout and labels', () => {
  it('renders card, pill and headings content', () => {
    render(
      <Card hairline>
        <Pill tone="error" icon="warning">
          Threat
        </Pill>
        <PageHeader title="Dashboard" subtitle="Live view" />
        <SectionHeader eyebrow="Panel" title="Credibility" />
      </Card>,
    );
    expect(screen.getByText('Threat')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Credibility' })).toBeTruthy();
  });

  it('shows an empty state with its reason and an optional action', () => {
    render(<EmptyState title="No investigations yet" description="Start a scenario to create one." />);
    expect(screen.getByText('No investigations yet')).toBeTruthy();
    expect(screen.getByText('Start a scenario to create one.')).toBeTruthy();
  });

  it('marks a skeleton as decorative', () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names a status dot when given a label', () => {
    render(<StatusDot tone="live" label="Feed live" />);
    expect(screen.getByRole('img', { name: 'Feed live' })).toBeTruthy();
  });
});

describe('controls', () => {
  it('moves the selected tab with the arrow keys', () => {
    const onChange = vi.fn();
    const tabs = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ] as const;
    render(<Tabs label="Views" tabs={tabs} value="a" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it('reports the next value of a toggle', () => {
    const onChange = vi.fn();
    render(<Toggle label="Pause intake" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Pause intake' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reports a numeric slider value and a typed select value', () => {
    const onSlider = vi.fn();
    const onSelect = vi.fn();
    render(
      <>
        <Slider label="Eta" value={0.15} min={0} max={1} step={0.01} format={(value) => value.toFixed(2)} onChange={onSlider} />
        <Select
          label="Noise"
          value="0"
          options={[
            { value: '0', label: 'None' },
            { value: '15', label: '15 %' },
          ]}
          onChange={onSelect}
        />
      </>,
    );
    fireEvent.change(screen.getByRole('slider', { name: 'Eta' }), { target: { value: '0.2' } });
    expect(onSlider).toHaveBeenCalledWith(0.2);
    fireEvent.change(screen.getByRole('combobox', { name: 'Noise' }), { target: { value: '15' } });
    expect(onSelect).toHaveBeenCalledWith('15');
  });

  it('copies the full value of a hash and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const full = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    render(<CopyHash value={full} label="bundle hash" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy bundle hash' }));
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(full);
  });
});

describe('CopyHash', () => {
  const uuid = '9f4d2c1a-0b3e-4c55-8a10-5e6f7a8b9c0d';

  it('shows a caller-chosen short form and still copies the full value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyHash value={uuid} display="9f4d2c1a" label="investigation id" textClassName="text-primary" />);
    const shown = screen.getByText('9f4d2c1a');
    expect(shown.getAttribute('title')).toBe(uuid);
    expect(shown.className).toContain('text-primary');
    fireEvent.click(screen.getByRole('button', { name: 'Copy investigation id' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(uuid));
  });

  it('keeps first-10 and last-6 as the default short form for a long value', () => {
    render(<CopyHash value={uuid} label="id" />);
    expect(screen.getByText('9f4d2c1a-0…8b9c0d')).toBeTruthy();
  });

  it('does not say Copied when the clipboard refuses', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyHash value="abc" label="id" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy id' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('does not trigger a click handler on the surrounding element', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <CopyHash value="abc" label="id" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy id' }));
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('measures', () => {
  it('shows a progress bar with no fill and "no data" when the value is null', () => {
    render(<ProgressBar value={null} label="Credibility, network_traffic" />);
    const bar = screen.getByRole('progressbar', { name: 'Credibility, network_traffic' });
    expect(bar.getAttribute('aria-valuetext')).toBe('no data');
  });

  it('shows the warning glyph below the isolation threshold', () => {
    render(<ProgressBar value={0.2} threshold={0.3} label="Credibility" />);
    expect(screen.getByRole('img', { name: 'Below isolation threshold' })).toBeTruthy();
  });

  it('draws the ring with a named label, and says no data when empty', () => {
    const { rerender } = render(<Ring value={null} label="Trust" />);
    expect(screen.getByRole('img', { name: 'Trust: no data' })).toBeTruthy();
    rerender(<Ring value={0.5} label="Trust" />);
    expect(screen.getByRole('img', { name: 'Trust' })).toBeTruthy();
  });

  it('labels a sparkline and says no data for an empty series', () => {
    const { rerender } = render(<Sparkline values={[]} label="Confidence by round" />);
    expect(screen.getByRole('img', { name: 'Confidence by round: no data' })).toBeTruthy();
    rerender(<Sparkline values={[0.4, 0.7, 0.6]} label="Confidence by round" />);
    expect(screen.getByRole('img', { name: 'Confidence by round' })).toBeTruthy();
  });

  it('plots real points with integer round ticks and no repeated labels', () => {
    render(
      <TrajectoryChart
        series={[{ id: 'network_traffic', label: 'Network-Traffic', tone: 'primary', points: [{ x: 1, y: 0.5 }, { x: 2, y: 0.4 }, { x: 3, y: 0.3 }] }]}
        xDomain={[1, 3]}
        threshold={{ value: 0.3, label: 'Isolation' }}
        xLabel="Round"
        yLabel="CrS"
        label="Credibility by round"
        proof={{ source: '/agents/fleet', n: 3, asOf: null, definition: 'CrS after each round' }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Credibility by round' })).toBeTruthy();
    expect(screen.getAllByText('2')).toHaveLength(1);
    expect(screen.queryByText('1.5')).toBeNull();
    expect(screen.getByRole('button', { name: 'Proof: Credibility by round' })).toBeTruthy();
  });

  it('shows the agent glyph and the name passed in from the API', () => {
    render(<AgentChip agentId="network_traffic" name="Network-Traffic" />);
    expect(screen.getByText('α')).toBeTruthy();
    expect(screen.getByText('Network-Traffic')).toBeTruthy();
  });
});

describe('Table', () => {
  const columns = [{ key: 'id', header: 'Row', cell: (row: { id: string }) => row.id, mono: true }];

  it('renders rows and falls back to the empty state', () => {
    const { rerender } = render(<Table caption="Rows" columns={columns} rows={[{ id: 'r-1' }]} rowKey={(row) => row.id} />);
    expect(screen.getByText('r-1')).toBeTruthy();
    rerender(<Table caption="Rows" columns={columns} rows={[]} rowKey={(row) => row.id} empty={<p>Nothing here</p>} />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});
