/**
 * The printable case report (#/report/<id>): a designed A4 document for one finished investigation. The page reads
 * the same endpoints as the dossier, builds the document from those fields only, and the Download PDF button opens
 * the browser's print dialog (Save as PDF), so no PDF library is involved and the text stays selectable.
 */
import { buildRoute } from '../../app/router';
import { formatTimestamp, shortId } from '../../lib/format';
import { EmptyState } from '../../ui/EmptyState';
import { Skeleton } from '../../ui/Skeleton';
import type { PageProps } from '../index';
import { containmentGate } from '../debate/gate';
import { healingStatus, playbook } from '../investigations/healing';
import { containmentLatency } from '../investigations/derive';
import { buildStoryline } from '../investigations/storyline';
import { caseTimeline } from '../investigations/timeline';
import { useCitedRows } from '../investigations/useCitedRows';
import { ReportCover } from './Cover';
import { Sheet } from './paper';
import { AutomationSection, EvidenceSection, HealingSection, IntegritySection, InvestigatorsSection, RoundsSection, StorylineSection, SummarySection, VotesSection } from './Sections';
import { executiveSummary } from './summary';
import { useCaseDocument } from './useCaseDocument';
import { useVerification } from './useVerification';

export default function ReportPage({ id }: PageProps) {
  const caseId = id ?? '';
  const doc = useCaseDocument(caseId);
  const verification = useVerification(doc.bundle, doc.chain, doc.status === 'ready');
  const citations = doc.citations?.citations;
  const rowIds = doc.status === 'ready' && citations ? citations.map((citation) => citation.row_id) : [];
  const cited = useCitedRows(rowIds);
  const backHref = buildRoute({ name: 'investigation', id: caseId });
  const sheet = { backHref, backLabel: 'Back to the investigation' };

  if (id === undefined) {
    return (
      <Sheet {...sheet} fileName="VerdictChain-report" ready={false}>
        <EmptyState title="No investigation chosen" description="Open a report from an investigation's dossier." />
      </Sheet>
    );
  }
  if (doc.status === 'loading') {
    return (
      <Sheet {...sheet} fileName="VerdictChain-report" ready={false}>
        <Skeleton className="h-40 w-full" />
      </Sheet>
    );
  }
  const detail = doc.detail;
  if (doc.status === 'failed' || detail === undefined) {
    return (
      <Sheet {...sheet} fileName="VerdictChain-report" ready={false}>
        <EmptyState title="The report could not be built" description={doc.error ?? 'The investigation could not be read.'} icon="warning" />
      </Sheet>
    );
  }

  const name = (agentId: string) => doc.fleet?.find((entry) => entry.agent_id === agentId)?.display_name ?? agentId;
  const domain = (agentId: string) => doc.fleet?.find((entry) => entry.agent_id === agentId)?.domain ?? null;
  const timeline = doc.audit ? caseTimeline(doc.audit.entries, detail.trigger_type) : null;
  const verdictAt = doc.audit ? containmentLatency(doc.audit.entries).verdictAt : null;
  const steps = playbook(detail.actions, verdictAt);
  const gate = containmentGate({
    status: detail.status,
    verdictClass: detail.verdict_class,
    verdictConfidence: detail.verdict_confidence,
    floor: doc.settings?.verdict_confidence_threshold ?? null,
    credibilityFloor: doc.settings?.starting_crs ?? null,
    votes: detail.votes,
    credibility: detail.credibility,
    actions: detail.actions,
    agentName: name,
  });
  const standing = healingStatus(gate, detail.status, detail.verdict_class, steps);
  const rounds = doc.settings?.debate_rounds ?? null;
  const sentences = executiveSummary({ detail, timeline, rounds, healing: standing, steps });
  const story = buildStoryline(cited.rows, citations ?? []);
  const generatedAt = doc.generatedAt ?? new Date().toISOString();
  const missing = Object.entries(doc.missing);

  return (
    <Sheet {...sheet} fileName={`VerdictChain-report-${shortId(detail.id)}`} ready={verification.settled && (rowIds.length === 0 || cited.status === 'ready')}>
      <ReportCover detail={detail} generatedAt={generatedAt} generatedBy={doc.me?.username ?? null} />

      {missing.length > 0 && (
        <p role="note" className="mt-3 rounded border border-paper-tertiary/40 bg-paper-tertiary/10 px-2 py-1 text-[10px] text-paper-tertiary">
          Some parts could not be read and are marked where they belong: {missing.map(([part, reason]) => `${part} (${reason})`).join('; ')}.
        </p>
      )}

      <SummarySection sentences={sentences} detail={detail} timeline={timeline} rounds={rounds} actionCount={steps.filter((step) => !step.released).length} />
      <AutomationSection timeline={timeline} />
      <InvestigatorsSection detail={detail} citations={citations ?? []} name={name} domain={domain} />
      <RoundsSection detail={detail} name={name} />
      <VotesSection detail={detail} name={name} />
      <EvidenceSection citations={citations} missing={doc.missing.citations} />
      <StorylineSection story={story} cited={cited} hasCitations={(citations?.length ?? 0) > 0} />
      <HealingSection gate={gate} standing={standing} steps={steps} />
      <IntegritySection
        sha256={doc.bundle?.bundle_sha256 ?? null}
        verification={verification}
        caseDigest={doc.chain?.case_digest ?? null}
        entries={doc.chain ? doc.chain.entries.length : null}
        chainTotal={doc.chain?.chain.total ?? null}
        chainValid={doc.chain?.chain.valid ?? doc.audit?.chain.valid ?? null}
      />

      <footer className="mt-6 border-t border-paper-rule pt-2 text-[9px] leading-snug text-ink-muted">
        Generated {formatTimestamp(generatedAt)}
        {doc.me ? ` by ${doc.me.username}` : ''} from the live API. Every figure is an API field or is derived from API fields as each section says; nothing was typed in. Sources: GET /investigations/{'{id}'} · /citations · /evidence-bundle · /audit-chain · /audit-trail · /settings · /raw-logs/{'{row_id}'}.
      </footer>
    </Sheet>
  );
}
