import { cn } from '../lib/cn';
import type { IconName } from './icon-names';

/** Pixel size of the glyph. Any value is allowed; common ones keep a utility class. */
export type IconSize = number;

const SIZE_CLASS: Record<number, string> = {
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
  const sizeClass = SIZE_CLASS[size];
  return (
    <span
      className={cn('vc-icon', sizeClass, className)}
      style={sizeClass ? undefined : { fontSize: `${size}px` }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {name}
    </span>
  );
}
