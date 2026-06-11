import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

export interface PubkeyProps {
  value: string;
  /** Display label override (e.g. "USDC"). Falls back to truncated address. */
  label?: ReactNode;
  /** Characters to keep on each side when truncating. Default 4. */
  truncate?: number;
  /** Disable copy-on-click. */
  noCopy?: boolean;
  /** Show full pubkey (no truncation). */
  full?: boolean;
  className?: string;
}

export function Pubkey({
  value,
  label,
  truncate = 4,
  noCopy,
  full,
  className,
}: PubkeyProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const display = label != null
    ? label
    : full || value.length <= truncate * 2 + 1
      ? value
      : `${value.slice(0, truncate)}…${value.slice(-truncate)}`;

  const handleCopy = async (e: React.MouseEvent): Promise<void> => {
    if (noCopy) return;
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const tipText = copied ? 'Copied!' : value;

  return (
    <Tooltip content={tipText} side="top">
      <span
        role={noCopy ? undefined : 'button'}
        tabIndex={noCopy ? -1 : 0}
        onClick={noCopy ? undefined : handleCopy}
        onKeyDown={
          noCopy
            ? undefined
            : (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handleCopy(e as unknown as React.MouseEvent);
                }
              }
        }
        className={cn(
          'inline-flex items-center gap-1 font-mono text-2xs',
          'rounded px-1 py-0.5 -mx-1',
          !noCopy && 'cursor-pointer hover:bg-surface-2/60 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
          className,
        )}
      >
        <span className="truncate">{display}</span>
        {!noCopy && (
          <span
            className={cn(
              'shrink-0 transition-colors',
              copied ? 'text-success' : 'text-text-subtle opacity-0 group-hover:opacity-100',
            )}
            aria-hidden
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </span>
        )}
      </span>
    </Tooltip>
  );
}
