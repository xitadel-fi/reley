import { cn } from './cn';

export interface SkeletonProps {
  className?: string;
  width?: number | string;
  height?: number | string;
}

export function Skeleton({ className, width, height }: SkeletonProps): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('inline-block rounded bg-surface-2 animate-pulse', className)}
      style={{ width, height }}
    />
  );
}

export interface SkeletonRowProps {
  lines?: number;
  className?: string;
}

export function SkeletonRow({ lines = 3, className }: SkeletonRowProps): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={12}
          width={i === lines - 1 ? '65%' : '100%'}
        />
      ))}
    </div>
  );
}
