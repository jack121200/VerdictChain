import { getRbacMatrix } from '../api/client';
import { buildRoute } from '../app/router';
import { useAsync } from '../app/use-async';
import { ROLE_LABEL } from '../lib/labels';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Proof } from '../ui/Proof';
import { useScenarioModal } from './scenario-modal';

/** Which roles hold inject_scenario, read from the live capability matrix. Only mounted for a role that lacks it. */
function RolesThatCanInject() {
  const matrix = useAsync(getRbacMatrix);
  const roles = matrix.data?.capabilities.inject_scenario ?? null;
  return (
    <p role="note" className="flex max-w-md flex-wrap items-center justify-center gap-1.5 text-caption text-on-surface-variant">
      <Icon name="info" size={12} className="shrink-0" />
      <span>
        Your role does not hold the inject_scenario capability, so it cannot run a scenario.{' '}
        {roles !== null && roles.length > 0
          ? `Roles that can: ${roles.map((role) => ROLE_LABEL[role]).join(', ')}.`
          : matrix.error !== null
            ? 'Ask an analyst whose role holds it.'
            : 'Loading the roles that can…'}{' '}
        <a href={buildRoute({ name: 'access' })} className="text-primary underline">
          See the capability matrix
        </a>
        .
      </span>
      <Proof
        source="GET /rbac/matrix (capabilities.inject_scenario) · GET /auth/me (capabilities)"
        n={roles?.length ?? 0}
        asOf={matrix.loadedAt}
        label="Who can run a scenario"
        definition="The roles listed come from the read-only RBAC matrix. Whether your own role is among them comes from the capabilities of GET /auth/me. The server enforces it as well: injection without the capability is rejected with 403."
      />
    </p>
  );
}

export interface RunScenarioActionProps {
  /** Button text. "Run first scenario" fits an empty page; "Run a scenario" fits a page that already has data. */
  label?: string;
}

/**
 * The action for an empty state. With the inject_scenario capability it opens the shell's scenario modal; without
 * it, it says which roles can. Outside the signed-in shell there is no modal to open, so it renders nothing.
 */
export function RunScenarioAction({ label = 'Run first scenario' }: RunScenarioActionProps) {
  const scenario = useScenarioModal();
  if (scenario === null) return null;
  if (scenario.canInject === false) return <RolesThatCanInject />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button variant="primary" icon="play_circle" disabled={scenario.canInject === null} onClick={() => scenario.open()}>
        {label}
      </Button>
      <Proof
        source="shell: scenario modal · POST /investigations/simulate (wait=false)"
        n={1}
        asOf={null}
        label={label}
        definition="Opens the scenario modal. Authorizing there starts a simulated investigation from a real scenario and opens its debate room. It needs the inject_scenario capability from GET /auth/me; the button stays disabled until that has loaded."
      />
    </span>
  );
}
