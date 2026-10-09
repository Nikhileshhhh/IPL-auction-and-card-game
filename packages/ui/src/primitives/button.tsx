import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'auction' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'touch' | 'normal' | 'key';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the pending label and blocks repeat submission (UI spec §3). */
  pending?: boolean;
  pendingLabel?: ReactNode;
  icon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-card text-midnight hover:brightness-110',
  auction: 'bg-auction text-midnight hover:brightness-110',
  secondary: 'bg-raised text-ink border border-line hover:bg-overlay',
  tertiary: 'bg-transparent text-ink-2 hover:text-ink hover:bg-raised',
  danger: 'bg-[#3a1a22] text-bad border border-bad/50 hover:bg-[#4a2029]',
};

const SIZES: Record<ButtonSize, string> = {
  touch: 'min-h-11 px-4 text-sm',
  normal: 'min-h-12 px-5 text-base',
  key: 'min-h-14 px-6 text-lg',
};

/** 44/48/56px targets; pending keeps width stable and is announced via aria-busy. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'normal',
    pending = false,
    pendingLabel,
    icon,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold transition-[filter,background-color,color] duration-100',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{pending ? (pendingLabel ?? children) : children}</span>
    </button>
  );
});
