import { AGENT_VISUALS, type AgentTone, type AgentVisualId } from '../lib/agents';
import { cn } from '../lib/cn';

/** Chip colours from SKILL-design-system section 5. The name is passed in from the API. */
const CHIP_CLASS: Record<AgentTone, string> = {
  primary: 'border-primary bg-primary/10 text-primary',
  secondary: 'border-secondary bg-secondary/10 text-secondary',
  tertiary: 'border-tertiary bg-tertiary/10 text-tertiary',
  'primary-container': 'border-primary-container bg-on-primary-container text-primary-container',
  error: 'border-error/40 bg-error-container/30 text-error',
};

export interface AgentChipProps {
  agentId: AgentVisualId;
  /** Display name from GET /agents/fleet (or a fixed project label for Watchdog and Self-Healing). */
  name: string;
  className?: string;
}

/** Glyph, name and token colour. The chip holds no data of its own. */
export function AgentChip({ agentId, name, className }: AgentChipProps) {
  const visual = AGENT_VISUALS[agentId];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-caption font-semibold',
        CHIP_CLASS[visual.tone],
        className,
      )}
    >
      <span aria-hidden="true" className="font-mono">
        {visual.glyph}
      </span>
      <span>{name}</span>
    </span>
  );
}
