'use client';

import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  trailing?: ReactNode;
}

/** Labelled input with hint/error wired through aria-describedby. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, trailing, className, ...rest },
  ref,
) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(
            'min-h-12 w-full rounded-[var(--radius-control)] border bg-midnight px-4 text-base text-ink placeholder:text-ink-3',
            error ? 'border-bad' : 'border-line',
            trailing ? 'pr-24' : '',
          )}
          {...rest}
        />
        {trailing ? <div className="absolute right-1">{trailing}</div> : null}
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'trailing'> {
  revealLabel?: string;
}

/** Masked input with a labelled show/hide toggle (S01/S02). */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ revealLabel = 'password', ...rest }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <TextField
        ref={ref}
        type={visible ? 'text' : 'password'}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            className="min-h-11 rounded-[var(--radius-control)] px-3 text-sm text-ink-2 hover:text-ink"
          >
            {visible ? `Hide ${revealLabel}` : `Show ${revealLabel}`}
          </button>
        }
        {...rest}
      />
    );
  },
);
