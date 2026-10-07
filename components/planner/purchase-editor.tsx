'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, LoaderCircle, ReceiptText, RotateCcw, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { PriceInput } from '@/components/planner/item-editor';
import { money } from '@/lib/planner';
import type { Item, Plan } from '@/lib/planner';

export type PurchaseMutation = { action: 'purchase'; id: string; price: number | null };
type SaveResult = { ok: boolean; error?: string; conflict?: Plan };
type Props = {
  item: Item;
  plan: Plan;
  busy: boolean;
  onSave: (mutation: PurchaseMutation, revision?: number) => Promise<SaveResult>;
  onClose: () => void;
};

export function PurchaseEditor({ item, plan, busy, onSave, onClose }: Props) {
  const [baseline, setBaseline] = useState(item);
  const [amount, setAmount] = useState<number | null>(item.purchasePrice ?? null);
  const [revision, setRevision] = useState(plan.revision);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Plan | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement);
  const locked = busy || saving;
  const purchased = baseline.purchasePrice !== null && baseline.purchasePrice !== undefined;
  const dirty = amount !== (baseline.purchasePrice ?? null) || pendingRemoval;
  const latest = conflict?.items.find(saved => saved.id === item.id);
  const shownItem = latest ?? baseline;

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  useEffect(() => { if (error || conflict) feedback.current?.scrollIntoView({ block: 'nearest' }); }, [error, conflict]);

  function requestClose() {
    if (locked || inFlight.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  }

  async function save(price: number | null, forceRevision?: number) {
    if (locked || inFlight.current) return;
    if (conflict && (!latest || !reviewed || forceRevision !== conflict.revision)) return;
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 100000000)) {
      setError('Enter an amount from $0 to $1,000,000, with up to two decimal places.');
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await onSave({ action: 'purchase', id: item.id, price }, forceRevision ?? revision);
      if (result.ok) { onClose(); return; }
      setError(result.error ?? 'Could not save your purchase. Your amount is still here.');
      if (result.conflict) {
        setConflict(result.conflict);
        setReviewed(false);
        setPendingRemoval(price === null);
        setConfirmUndo(false);
      }
    } catch {
      setError('Could not save your purchase. Check your connection and try again.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null) { setError('Enter the amount you actually paid. Enter 0 if this item was free.'); return; }
    void save(amount);
  }

  function useLatest() {
    if (!conflict || !latest) { onClose(); return; }
    setBaseline(latest);
    setAmount(latest.purchasePrice ?? null);
    setRevision(conflict.revision);
    setConflict(null);
    setError('');
    setPendingRemoval(false);
    setReviewed(false);
  }

  return <>
    <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent className="purchase-editor" showCloseButton={false} onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
        <header className="purchase-heading">
          <span className="purchase-heading-icon"><ReceiptText size={23}/></span>
          <div><p className="eyebrow">MAKING IT HOME</p><DialogTitle>{purchased ? 'Edit purchase price' : 'Mark as purchased'}</DialogTitle><DialogDescription>Keep track of what you actually spent.</DialogDescription></div>
          <button type="button" className="icon-button purchase-close" disabled={locked} onClick={requestClose} aria-label="Close purchase editor"><X size={19}/></button>
        </header>
        <form className="purchase-form" onSubmit={submit}>
          <div className="purchase-scroll">
            <div className="purchase-product"><strong>{shownItem.name}</strong><span>{shownItem.room}</span></div>
            <dl className="purchase-references"><div><dt>Budgeted amount</dt><dd>{shownItem.sale === null ? 'Not set' : money(shownItem.sale)}</dd></div><div><dt>High-end estimate</dt><dd>{shownItem.regular === null ? 'Not set' : money(shownItem.regular)}</dd></div></dl>
            <fieldset className="purchase-fields" disabled={locked || !!conflict}>
              <PriceInput id="purchase-paid-amount" label="Actual purchase price" value={amount} onChange={value => { setAmount(value); setError(''); }}/>
              <p className="purchase-help">Include tax and delivery if you want them in actual spend.</p>
              <p className="purchase-accounting"><Check size={15}/><span>This amount counts once in Actual spent. Your budgeted amount stays the same.</span></p>
            </fieldset>
            <div ref={feedback}>
              {error && !conflict && <div className="error-box" role="alert">{error}</div>}
              {conflict && <div className="purchase-conflict" role="alert">
                <strong>{latest ? 'Your shared plan changed' : 'This item was removed from the plan'}</strong>
                {latest ? <>
                  <p>Your amount is still here. Review the latest purchase record before saving.</p>
                  <div className="purchase-latest"><span>Latest saved for {latest.name}</span><strong>{latest.purchasePrice === null || latest.purchasePrice === undefined ? 'Not purchased' : `Purchased for ${money(latest.purchasePrice)}`}</strong></div>
                  <p>{pendingRemoval ? 'Your change will mark this item as not purchased and remove its price from Actual spent.' : `Your change will set its actual purchase price to ${amount === null ? 'an amount you enter' : money(amount)}.`}</p>
                  <label className="purchase-review"><input type="checkbox" checked={reviewed} disabled={locked} onChange={event => setReviewed(event.target.checked)}/>I reviewed the latest purchase record.</label>
                  <div className="purchase-conflict-actions"><button type="button" className="button secondary" disabled={locked} onClick={useLatest}>Use latest record</button><button type="button" className="button primary" disabled={locked || !reviewed || (!pendingRemoval && amount === null)} onClick={() => void save(pendingRemoval ? null : amount, conflict.revision)}>{locked ? 'Saving…' : pendingRemoval ? 'Mark as not purchased' : 'Save my purchase'}</button></div>
                  {error && <p className="purchase-retry-error">{error}</p>}
                </> : <>
                  <p>A purchase can only be recorded for an item that is still in the list. Your partner’s changes have been loaded.</p>
                  <button type="button" className="button secondary" onClick={onClose}>Close and use latest plan</button>
                </>}
              </div>}
            </div>
          </div>
          <footer className="purchase-footer">
            {purchased && <button type="button" className="text-button purchase-undo" disabled={locked || !!conflict} onClick={() => { setError(''); setConfirmUndo(true); }}><RotateCcw size={15}/>Mark as not purchased</button>}
            <div className="actions"><button type="button" className="button secondary" disabled={locked} onClick={requestClose}>Cancel</button><button type="submit" className="button primary" disabled={locked || !!conflict}>{locked ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} {locked ? 'Saving…' : 'Save purchase'}</button></div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogTitle>Discard this purchase change?</AlertDialogTitle><AlertDialogDescription>Your saved purchase record will stay as it is.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><button type="button" className="button primary" onClick={onClose}>Discard changes</button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={confirmUndo} onOpenChange={open => { if (!locked) setConfirmUndo(open); }}><AlertDialogContent><AlertDialogTitle>Mark as not purchased?</AlertDialogTitle><AlertDialogDescription>{baseline.name} will return to your shopping list as an unpurchased item. Its recorded purchase price will be removed from Actual spent. Your budgeted amount and other details will stay the same.</AlertDialogDescription>{error && <div className="error-box" role="alert">{error}</div>}<AlertDialogFooter><AlertDialogCancel disabled={locked}>Keep purchased</AlertDialogCancel><button type="button" className="button primary" disabled={locked} onClick={() => void save(null)}>{locked ? 'Saving…' : 'Mark as not purchased'}</button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
