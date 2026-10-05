import { cn } from '../lib/cn';
import type { IconName } from './icon-names';

export type IconSize = 12 | 16 | 20;

const SIZE_CLASS: Record<IconSize, string> = {
  12: 'vc-icon-12',
  16: 'vc-icon-16',
  20: 'vc-icon-20',
};

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** Accessible name. Without it the glyph is decorative and hidden from assistive tech. */
  label?: string;
  className?: string;
}

/** Material Symbols Outlined glyph. Render icons through this component, not raw spans. */
export function Icon({ name, size = 16, label, className }: IconProps) {
  return (
    <span
      className={cn('vc-icon', SIZE_CLASS[size], className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {name}
    </span>
  );
}
