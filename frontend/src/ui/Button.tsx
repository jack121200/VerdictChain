import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from './classes';
import { Icon } from './Icon';
import type { IconName } from './icon-names';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  /** Disables the button and sets aria-busy while a request is in flight. */
  busy?: boolean;
}

const BASE = 'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-primary-container text-on-primary shadow-glow-cyan hover:bg-primary',
  secondary: 'border border-outline-variant/60 bg-surface-container-high text-on-surface hover:bg-surface-bright',
  danger: 'bg-error-strong text-on-error-container hover:opacity-90',
  ghost: 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary',
};

const SIZE_CLASS = {
  sm: 'px-3 py-1.5 text-caption',
  md: 'px-4 py-2 text-body',
} as const;

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  disabled,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(BASE, FOCUS_RING, VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 16} />}
      {children}
    </button>
  );
}
