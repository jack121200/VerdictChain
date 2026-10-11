import { useState } from 'react';
import { getEvaluation } from '../../api/client';
import type { EvaluationResponse, EvaluationSource, Metric as MetricEnvelope, PredictedClass, VerdictClass } from '../../api/types';
import { PageState } from '../../app/PageState';
import { pageStatus, usePageData } from '../../app/use-page-data';
import { cn } from '../../lib/cn';
import { formatCount, formatPercent } from '../../lib/format';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Proof } from '../../ui/Proof';
import { Skeleton } from '../../ui/Skeleton';
import { Tabs, type TabItem } from '../../ui/Tabs';
import { VERDICT_LABEL } from '../investigations/labels';

const SOURCES: readonly TabItem<EvaluationSource>[] = [
  { id: 'model', label: 'Model runs' },
  { id: 'stub', label: 'Offline stub runs' },
  { id: 'mixed', label: 'Mixed runs' },
  { id: 'all', label: 'All runs' },
];

/** What each choice counts, in words, so a number is never read as more than it measures. */
const SOURCE_NOTE: Record<EvaluationSource, string> = {
  model: 'Counts only investigations answered by the real model. This is the one figure that measures the system.',
  stub: 'Counts only investigations answered by the offline stub. These figures measure the stub’s canned sentences, not a model.',
  mixed: 'Counts investigations answered partly by the stub and partly by the real model.',
  all: 'Counts every labelled investigation that reached a verdict, whatever answered it. Do not quote this as the system’s accuracy.',
};

const SOURCE_ICON: Record<'model' | 'stub' | 'mixed', 'bolt' | 'science' | 'sync_alt'> = {
  model: 'bolt',
  stub: 'science',
  mixed: 'sync_alt',
};

const SOURCE_NAME: Record<'model' | 'stub' | 'mixed', string> = {
  model: 'Model',
  stub: 'Offline stub',
  mixed: 'Mixed',
};

const PERCENT = (value: number) => formatPercent(value, 1);

const predictedLabel = (predicted: PredictedClass): string => (predicted === 'unclassified' ? 'Unclassified' : VERDICT_LABEL[predicted]);

/** A rate with its Proof. A null rate shows an em dash; the reason is in the Proof (a table cell stays short). */
function Rate({ metric, label }: { metric: MetricEnvelope<number>; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('font-mono text-evidence tabular-nums', metric.value === null ? 'text-on-surface-variant' : 'text-on-surface')}>
        {metric.value === null ? '—' : PERCENT(metric.value)}
      </span>
      <Proof source={metric.source} n={metric.n} asOf={metric.as_of} definition={metric.definition} reason={metric.reason} label={label} />
    </span>
  );
}

function Headline({ label, metric, count }: { label: string; metric: MetricEnvelope<number>; count?: boolean }) {
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-background p-3">
      <div className="font-mono text-[10px] uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className={cn('font-headline text-2xl font-bold tabular-nums', metric.value === null ? 'text-on-surface-variant' : 'text-on-surface')}>
          {metric.value === null ? '—' : count ? formatCount(metric.value) : PERCENT(metric.value)}
        </span>
        <Proof source={metric.source} n={metric.n} asOf={metric.as_of} definition={metric.definition} reason={metric.reason} label={label} />
      </div>
    </div>
  );
}

/** The cell of the confusion matrix: a count, tinted by whether it is a correct pair or a miss (the digit is the signal). */
function cellTone(actual: VerdictClass, predicted: PredictedClass, count: number): string {
  if (count === 0) return 'text-on-surface-variant/60';
  return actual === predicted ? 'bg-secondary/15 font-bold text-secondary' : 'bg-error-container/30 font-bold text-error';
}

function ConfusionMatrix({ data }: { data: EvaluationResponse }) {
  const matrix = data.confusion_matrix;
  const count = (actual: VerdictClass, predicted: PredictedClass): MetricEnvelope<number> | undefined =>
    matrix.cells.find((cell) => cell.actual === actual && cell.predicted === predicted)?.count;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h3 className="font-headline text-sm font-bold text-on-surface">Confusion matrix</h3>
        <Proof
          source="GET /evaluation (confusion_matrix)"
          n={data.scored.value ?? 0}
          asOf={data.generated_at}
          label="Confusion matrix"
          definition="Rows: the class the scenario label maps to. Columns: the verdict the system gave. Each cell counts scored investigations with that pair. The diagonal is a correct verdict, a cell off the diagonal is a miss, and a column Ambiguous is an abstention (never counted as correct). Insider scenarios also accept the other insider class in the acceptable and family accuracy, but this matrix shows the exact pair."
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-outline-variant/40">
        <table className="w-full min-w-[640px] border-collapse font-mono text-[11px]">
          <caption className="sr-only">Expected class by verdict given, counts of scored investigations</caption>
          <thead>
            <tr className="bg-background text-[10px] uppercase text-on-surface-variant">
              <th scope="col" className="px-2 py-2 text-left font-semibold">
                Expected ↓ · verdict →
              </th>
              {matrix.cols.map((predicted) => (
                <th key={predicted} scope="col" className="px-1.5 py-2 text-center font-semibold" title={predictedLabel(predicted)}>
                  {predicted}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20">
            {matrix.rows.map((actual) => (
              <tr key={actual}>
                <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-on-surface" title={VERDICT_LABEL[actual]}>
                  {actual}
                </th>
                {matrix.cols.map((predicted) => {
                  const metric = count(actual, predicted);
                  const value = metric?.value ?? 0;
                  return (
                    <td key={predicted} className={cn('px-1.5 py-1.5 text-center tabular-nums', cellTone(actual, predicted, value))}>
                      {formatCount(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PerClass({ data }: { data: EvaluationResponse }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h3 className="font-headline text-sm font-bold text-on-surface">Per class</h3>
        <Proof
          source="GET /evaluation (per_class)"
          n={data.scored.value ?? 0}
          asOf={data.generated_at}
          label="Per-class scores"
          definition="Precision = true positives / investigations given this verdict. Recall = true positives / investigations whose mapped class is this. F1 = 2 x TP / (predicted + expected). Each uses the primary mapping only, and a class nobody predicted or expected shows an em dash with its reason in the Proof, never 0."
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-outline-variant/40">
        <table className="w-full text-left font-mono text-[11px]">
          <caption className="sr-only">Precision, recall and F1 per verdict class</caption>
          <thead>
            <tr className="bg-background text-[10px] uppercase text-on-surface-variant">
              <th scope="col" className="px-3 py-2 font-semibold">Verdict class</th>
              <th scope="col" className="px-3 py-2 font-semibold">Precision</th>
              <th scope="col" className="px-3 py-2 font-semibold">Recall</th>
              <th scope="col" className="px-3 py-2 font-semibold">F1</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20">
            {data.per_class.map((row) => (
              <tr key={row.verdict_class}>
                <th scope="row" className="px-3 py-1.5 font-semibold text-on-surface">{VERDICT_LABEL[row.verdict_class]}</th>
                <td className="px-3 py-1.5"><Rate metric={row.precision} label={`Precision, ${VERDICT_LABEL[row.verdict_class]}`} /></td>
                <td className="px-3 py-1.5"><Rate metric={row.recall} label={`Recall, ${VERDICT_LABEL[row.verdict_class]}`} /></td>
                <td className="px-3 py-1.5"><Rate metric={row.f1} label={`F1, ${VERDICT_LABEL[row.verdict_class]}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ByNoise({ data }: { data: EvaluationResponse }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h3 className="font-headline text-sm font-bold text-on-surface">By noise level</h3>
        <Proof
          source="GET /evaluation (by_noise)"
          n={data.scored.value ?? 0}
          asOf={data.generated_at}
          label="Results by noise level"
          definition="The same four rates for the scored investigations started with 0, 15 and 30 percent benign-row dilution (the noise slider of the inject dialog). It shows how robust the verdict is when the evidence is buried in ordinary rows; it is not adversarial noise."
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-outline-variant/40">
        <table className="w-full text-left font-mono text-[11px]">
          <caption className="sr-only">Accuracy, acceptable accuracy, family accuracy and abstain rate by noise level</caption>
          <thead>
            <tr className="bg-background text-[10px] uppercase text-on-surface-variant">
              <th scope="col" className="px-3 py-2 font-semibold">Noise</th>
              <th scope="col" className="px-3 py-2 font-semibold">Accuracy</th>
              <th scope="col" className="px-3 py-2 font-semibold">Acceptable</th>
              <th scope="col" className="px-3 py-2 font-semibold">Family</th>
              <th scope="col" className="px-3 py-2 font-semibold">Abstain</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20">
            {data.by_noise.map((row) => (
              <tr key={row.noise_pct}>
                <th scope="row" className="px-3 py-1.5 font-semibold text-on-surface">{row.noise_pct} %</th>
                <td className="px-3 py-1.5"><Rate metric={row.accuracy} label={`Accuracy at ${row.noise_pct} % noise`} /></td>
                <td className="px-3 py-1.5"><Rate metric={row.acceptable_accuracy} label={`Acceptable accuracy at ${row.noise_pct} % noise`} /></td>
                <td className="px-3 py-1.5"><Rate metric={row.family_accuracy} label={`Family accuracy at ${row.noise_pct} % noise`} /></td>
                <td className="px-3 py-1.5"><Rate metric={row.abstain_rate} label={`Abstain rate at ${row.noise_pct} % noise`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Mapping({ data }: { data: EvaluationResponse }) {
  return (
    <details className="rounded-lg border border-outline-variant/40 bg-background p-3">
      <summary className="cursor-pointer font-mono text-[11px] font-semibold uppercase text-on-surface-variant">How a scenario label is scored</summary>
      <p className="mt-2 text-caption text-on-surface-variant">
        {data.mapping_status}. The label is read on the server only to score a finished run; no investigator is ever shown it.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left font-mono text-[11px]">
          <caption className="sr-only">Scenario label, the verdict class it is scored against, and the classes also accepted</caption>
          <thead>
            <tr className="text-[10px] uppercase text-on-surface-variant">
              <th scope="col" className="px-2 py-1 font-semibold">Scenario label</th>
              <th scope="col" className="px-2 py-1 font-semibold">Expected class</th>
              <th scope="col" className="px-2 py-1 font-semibold">Also accepted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/20">
            {data.mapping.map((entry) => (
              <tr key={entry.scenario_label}>
                <th scope="row" className="px-2 py-1 font-semibold text-on-surface">{entry.scenario_label}</th>
                <td className="px-2 py-1 text-on-surface">{entry.expected_class}</td>
                <td className="px-2 py-1 text-on-surface-variant">{entry.accepted_classes.length === 0 ? '—' : entry.accepted_classes.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Accuracy against labelled scenarios (GET /evaluation). Accuracy exists only here (R4). The headline counts the
 * real model by default; the offline stub's runs are one click away and always labelled as the stub.
 */
export function EvaluationPanel() {
  const [source, setSource] = useState<EvaluationSource>('model');
  const evaluation = usePageData(() => getEvaluation(source), undefined, ['investigations'], [source]);
  // A value loaded for another choice stays in the hook until the new one arrives: never show it under this tab.
  const data = evaluation.data?.source === source ? evaluation.data : undefined;
  const scored = data?.scored.value ?? 0;

  return (
    <section className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 shadow-md" aria-label="Evaluation against labelled scenarios">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="fact_check" size={20} className="text-primary" />
          <h2 className="font-headline text-base font-bold text-on-surface">Evaluation against labelled scenarios</h2>
          {data && (
            <Proof
              source={`GET /evaluation?source=${source}`}
              n={scored}
              asOf={evaluation.loadedAt}
              label="Evaluation"
              definition="Accuracy exists only here. Only investigations whose scenario label is known and that reached a verdict are scored (verdict_reached, contained or ambiguous). The label is stored on the investigation for this purpose and never reaches an agent. Exact accuracy counts a verdict only when it equals the mapped class; ambiguous counts as wrong. Agent-reported confidence elsewhere in the console is not accuracy."
            />
          )}
        </div>
        {data && (
          <span className="font-mono text-[10px] uppercase text-on-surface-variant">
            {formatCount(data.labelled.value ?? 0)} labelled · {formatCount(scored)} scored
          </span>
        )}
      </div>

      <Tabs label="Which runs to count" tabs={SOURCES} value={source} onChange={setSource} />
      <p className={cn('flex items-start gap-1.5 text-caption', source === 'model' ? 'text-on-surface-variant' : 'text-tertiary')}>
        <Icon name={source === 'model' ? 'info' : 'warning'} size={14} className="mt-0.5 shrink-0" />
        {SOURCE_NOTE[source]}
      </p>

      <PageState
        page={{ status: pageStatus({ data, error: evaluation.error }), error: evaluation.error }}
        skeleton={<Skeleton className="h-32 w-full" />}
      />

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" role="group" aria-label="Headline rates">
            <Headline label="Scored" metric={data.scored} count />
            <Headline label="Accuracy" metric={data.accuracy} />
            <Headline label="Acceptable accuracy" metric={data.acceptable_accuracy} />
            <Headline label="Family accuracy" metric={data.family_accuracy} />
            <Headline label="Abstain rate" metric={data.abstain_rate} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3" role="group" aria-label="Accuracy by source of the answers">
            {(['model', 'stub', 'mixed'] as const).map((origin) => {
              const part = data.by_source[origin];
              return (
                <div key={origin} className="flex items-center justify-between gap-2 rounded-lg border border-outline-variant/40 bg-background p-3">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase text-on-surface">
                    <Icon name={SOURCE_ICON[origin]} size={14} className="text-primary" />
                    {SOURCE_NAME[origin]}
                  </span>
                  <span className="inline-flex items-center gap-2 font-mono text-[11px] text-on-surface-variant">
                    <span>{part.scored.value === null ? '—' : formatCount(part.scored.value)} scored</span>
                    <Rate metric={part.accuracy} label={`Accuracy, ${SOURCE_NAME[origin]} runs`} />
                  </span>
                </div>
              );
            })}
          </div>

          {scored === 0 ? (
            <EmptyState
              icon="fact_check"
              title="Nothing scored for this choice yet"
              description={data.accuracy.reason ?? 'No labelled investigation has reached a verdict for this choice.'}
            />
          ) : (
            <>
              <PerClass data={data} />
              <ConfusionMatrix data={data} />
              <ByNoise data={data} />
            </>
          )}
          <Mapping data={data} />
        </>
      )}
    </section>
  );
}
