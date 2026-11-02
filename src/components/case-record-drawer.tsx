'use client';

import { useEffect, useRef } from 'react';
import type { SessionState } from '@/domain/agent';
import { SharedCaseRecord } from '@/components/shared-case-record';

export function CaseRecordDrawer({ session, open, onClose, onOpenNote }: {
  session: SessionState; open: boolean; onClose: () => void; onOpenNote: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={dialogRef} className="case-record-drawer" aria-label="病例记录抽屉"
    onCancel={onClose} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    {open && <section className="workspace-panel training-record" aria-label="共享病例记录">
      <SharedCaseRecord session={session} drawer onClose={onClose} onOpenNote={() => { onClose(); onOpenNote(); }} />
    </section>}
  </dialog>;
}
