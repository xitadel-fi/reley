import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type ReactNode } from 'react';
import { cn } from './cn';

export interface VirtualListProps<T> {
  items: T[];
  estimateSize: number;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  /** Container height. Default 400. */
  height?: number | string;
  overscan?: number;
  /** Stable key function. Required for variable-height items + reordering. */
  getKey?: (item: T, index: number) => string | number;
}

export function VirtualList<T>({
  items,
  estimateSize,
  renderItem,
  className,
  height = 400,
  overscan = 8,
  getKey,
}: VirtualListProps<T>): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);

  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    ...(getKey && {
      getItemKey: (idx: number) => {
        const it = items[idx];
        return it != null ? getKey(it, idx) : idx;
      },
    }),
  });

  return (
    <div
      ref={parentRef}
      className={cn('overflow-auto', className)}
      style={{ height }}
    >
      <div
        style={{
          height: v.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {v.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (item == null) return null;
          return (
            <div
              key={row.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
              }}
              data-index={row.index}
              ref={v.measureElement}
            >
              {renderItem(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
