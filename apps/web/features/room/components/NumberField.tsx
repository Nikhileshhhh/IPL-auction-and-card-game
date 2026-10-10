'use client';

import { useId } from 'react';

/** Numeric input with visible label, unit and range (sliders always have numeric input, S05). */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  hint,
  error,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const id = useId();
  const outOfRange = !Number.isInteger(value) || value < min || value > max;
  const message =
    error ?? (outOfRange ? `Choose a whole number from ${min} to ${max}.` : undefined);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={Number.isNaN(value) ? '' : value}
          disabled={disabled}
          aria-invalid={message ? true : undefined}
          aria-describedby={`${id}-hint${message ? ` ${id}-error` : ''}`}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
          className={`min-h-12 w-28 rounded-[var(--radius-control)] border bg-midnight px-4 text-base tabular-nums ${message ? 'border-bad' : 'border-control'}`}
        />
        {unit ? <span className="text-sm text-ink-2">{unit}</span> : null}
      </div>
      <p id={`${id}-hint`} className="text-sm text-ink-3">
        {hint ?? `${min}–${max}${unit ? ` ${unit}` : ''}`}
      </p>
      {message ? (
        <p id={`${id}-error`} className="text-sm text-bad">
          {message}
        </p>
      ) : null}
    </div>
  );
}
