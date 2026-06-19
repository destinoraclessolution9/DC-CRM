import { useState, useCallback } from 'react';
import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';

/**
 * ConfirmDialog — a focused confirmation overlay built on Modal + Button.
 *
 * Composes a Modal with a single message paragraph as its body and a
 * Cancel / Confirm pair in the footer. The Confirm action awaits a
 * possibly-async `onConfirm`, showing a loading spinner while it settles,
 * then closes the dialog. The confirm button is `danger`-styled for
 * destructive flows (default) or `primary` otherwise.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onError,
  tone = 'danger',
}) {
  // Tracks the in-flight confirm so the button can show a spinner and
  // we can ignore double-clicks / Esc / overlay-close mid-await.
  const [pending, setPending] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm?.();
      onClose?.();
    } catch (e) {
      // A rejecting onConfirm (async Supabase delete/save: RLS denial /
      // "Failed to fetch") would otherwise escape as an unhandledrejection with
      // no user feedback. Surface it, keep the dialog OPEN (don't call onClose),
      // and let the user retry or cancel.
      if (typeof onError === 'function') onError(e);
      else window.UI?.toast?.error?.('Action failed. Please try again.');
    } finally {
      // Reset even if onConfirm threw, so the dialog stays usable.
      setPending(false);
    }
  }, [pending, onConfirm, onClose, onError]);

  // Don't allow dismissing (Esc / overlay) while the confirm is settling.
  const handleClose = useCallback(() => {
    if (pending) return;
    onClose?.();
  }, [pending, onClose]);

  const footer = (
    <>
      <Button variant="secondary" onClick={handleClose} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button
        variant={tone === 'danger' ? 'danger' : 'primary'}
        onClick={handleConfirm}
        loading={pending}
      >
        {confirmLabel}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={handleClose} title={title} size="sm" footer={footer}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {message}
      </p>
    </Modal>
  );
}
