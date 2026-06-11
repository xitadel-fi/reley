import type { ReactNode } from 'react';
import { Dialog, DialogContent } from '../ui';

export function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" className="max-w-fit">
        {children}
      </DialogContent>
    </Dialog>
  );
}
