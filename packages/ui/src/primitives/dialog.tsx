'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * Modal with trapped and restored focus (UI spec §3). Destructive dialogs must
 * state consequences in `description` and name the primary action precisely.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
}) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => (dismissible || next ? onOpenChange(next) : undefined)}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <RadixDialog.Content
          onEscapeKeyDown={(e) => (dismissible ? undefined : e.preventDefault())}
          onPointerDownOutside={(e) => (dismissible ? undefined : e.preventDefault())}
          className={cx(
            'fixed z-50 max-h-[100dvh] overflow-y-auto border border-line bg-overlay p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-ink shadow-[var(--shadow-overlay)] focus:outline-none sm:pb-6',
            'inset-x-0 bottom-0 rounded-t-[var(--radius-panel)] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-panel)]',
          )}
        >
          <RadixDialog.Title className="text-xl font-semibold">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="mt-2 text-ink-2">
              {description}
            </RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          {children ? <div className="mt-4">{children}</div> : null}
          {footer ? <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
