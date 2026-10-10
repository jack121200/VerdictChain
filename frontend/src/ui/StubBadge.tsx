import type { DataSource } from '../api/types';
import { Pill } from './Pill';
import { Proof } from './Proof';

const TEXT: Record<Exclude<DataSource, 'model'>, { label: string; definition: string }> = {
  stub: {
    label: 'Offline stub',
    definition:
      'Every answer in this investigation came from the offline stub (provider label stub-groq or stub-gemini), not from a real model provider. Its verdict and its accuracy say nothing about how the system performs with real models.',
  },
  mixed: {
    label: 'Stub + model',
    definition:
      'Some answers in this investigation came from the offline stub and some from a real model provider, so its verdict is not a clean measure of either.',
  },
};

/**
 * Marks an investigation that the offline stub produced (in whole or in part). Nothing is shown for an
 * investigation whose answers all came from real providers. data_source is GET /investigations[/{id}].data_source,
 * derived on the server from debate_transcripts.provider (backend/api/provenance.py).
 */
export function StubBadge({ source, className }: { source: DataSource | undefined; className?: string }) {
  if (source === undefined || source === 'model') return null;
  const text = TEXT[source];
  return (
    <span className={className ?? 'inline-flex items-center gap-1'}>
      <Pill tone="tertiary" icon="science">
        {text.label}
      </Pill>
      <Proof
        source="debate_transcripts.provider via GET /investigations"
        n={1}
        asOf={null}
        label={text.label}
        definition={text.definition}
      />
    </span>
  );
}
