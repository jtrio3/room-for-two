'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Info, Link2, LoaderCircle, Search, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { effectivePrice, money } from '@/lib/planner';
import type { Group, Item, Plan } from '@/lib/planner';
import { membershipChanges, rebaseGroupSelection } from '@/lib/groups';

export type GroupMutation =
  | { action: 'saveGroup'; group: Group; itemIds: string[] }
  | { action: 'removeGroup'; id: string };
export type SaveResult = { ok: boolean; error?: string; conflict?: Plan };

type Props = {
  initial: Group | null;
  plan: Plan;
  busy: boolean;
  onSave: (mutation: GroupMutation, revision?: number) => Promise<SaveResult>;
  onClose: () => void;
};

const members = (plan: Plan, groupId: string) => plan.items.filter(item => item.groupId === groupId).map(item => item.id);
const sameSelection = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
const itemNames = (items: Item[]) => items.map(item => item.name).join(', ');

export function GroupEditor({ initial, plan, busy, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Group>(() => initial ? { ...initial } : { id: crypto.randomUUID(), name: '', notes: '' });
  const [baseline, setBaseline] = useState<Plan>(() => structuredClone(plan));
  const [baselineGroup, setBaselineGroup] = useState<Group | null>(() => initial ? { ...initial } : null);
  const [selected, setSelected] = useState<string[]>(() => initial ? members(plan, initial.id) : []);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Plan | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [removing, setRemoving] = useState(false);
  const opener = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement);
  const errorRef = useRef<HTMLDivElement>(null);
  const idPrefix = useId();
  const baselineIds = baselineGroup ? members(baseline, baselineGroup.id) : [];
  const dirty = draft.name !== (baselineGroup?.name ?? '') || draft.notes !== (baselineGroup?.notes ?? '') || !sameSelection(selected, baselineIds);
  const workingPlan = conflict ?? baseline;
  const selectedItems = workingPlan.items.filter(item => selected.includes(item.id));
  const total = selectedItems.reduce((sum, item) => sum + (effectivePrice(item) ?? 0), 0);
  const unknown = selectedItems.filter(item => effectivePrice(item) === null).length;
  const highEndFallback = selectedItems.filter(item => item.sale === null && item.regular !== null).length;
  const otherGroup = (item: Item) => (workingPlan.groups ?? []).find(group => group.id === item.groupId && group.id !== draft.id);
  const movingItems = selectedItems.filter(item => !!otherGroup(item));
  const search = query.trim().toLocaleLowerCase();
  const filtered = workingPlan.items.filter(item => [item.name, item.room, (workingPlan.groups ?? []).find(group => group.id === item.groupId)?.name ?? ''].some(text => text.toLocaleLowerCase().includes(search))).sort((a, b) => a.priority - b.priority);
  const latestGroup = conflict?.groups?.find(group => group.id === draft.id);
  const deletedGroup = !!conflict && !!baselineGroup && !latestGroup;
  const changes = conflict ? membershipChanges(baseline.items, conflict.items, draft.id, selected) : null;
  const remoteCandidates = changes?.touched ?? [];

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  useEffect(() => { if (error || conflict) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [error, conflict]);

  function requestClose() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }

  function report(result: SaveResult) {
    setError(result.error ?? 'Could not confirm your save. Your changes are still here.');
    if (result.conflict) {
      setConflict(result.conflict);
      setReviewConfirmed(false);
      setReviewRequired(false);
      setRemoving(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || conflict || (reviewRequired && !reviewConfirmed)) return;
    const name = draft.name.trim();
    if (!name || name.length > 60) { setError('Give this group a name from 1 to 60 characters.'); return; }
    if ((baseline.groups ?? []).some(group => group.id !== draft.id && group.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) { setError('A group already has that name. Choose a different name.'); return; }
    setError('');
    const result = await onSave({ action: 'saveGroup', group: { ...draft, name }, itemIds: selected }, baseline.revision);
    if (result.ok) onClose();
    else report(result);
  }

  function useLatest() {
    if (!conflict) return;
    if (!baselineGroup || !latestGroup) { onClose(); return; }
    setBaseline(structuredClone(conflict));
    setBaselineGroup(latestGroup ? { ...latestGroup } : null);
    if (latestGroup) setDraft({ ...latestGroup });
    setSelected(latestGroup ? members(conflict, latestGroup.id) : []);
    setConflict(null);
    setError('');
    setReviewRequired(false);
    setReviewConfirmed(false);
  }

  function reviewChanges(recreate = false) {
    if (!conflict || (deletedGroup && !recreate)) return;
    const nextId = recreate ? crypto.randomUUID() : draft.id;
    const nextSelection = rebaseGroupSelection(baselineIds, selected, conflict.items, draft.id);
    // Recreating is a separate, explicit action and still requires reviewing the
    // retained selections (including moves) before the new group can be saved.
    const recreatedSelection = recreate ? selected.filter(id => conflict.items.some(item => item.id === id)) : nextSelection;
    setDraft({
      id: nextId,
      name: baselineGroup && draft.name === baselineGroup.name && latestGroup ? latestGroup.name : draft.name,
      notes: baselineGroup && draft.notes === baselineGroup.notes && latestGroup ? latestGroup.notes : draft.notes,
    });
    setSelected(recreatedSelection);
    setBaseline(structuredClone(conflict));
    setBaselineGroup(recreate ? null : latestGroup ? { ...latestGroup } : null);
    setConflict(null);
    setError('');
    setReviewRequired(true);
    setReviewConfirmed(false);
  }

  async function remove() {
    if (busy || conflict || !baselineGroup) return;
    setError('');
    const result = await onSave({ action: 'removeGroup', id: draft.id }, baseline.revision);
    if (result.ok) onClose();
    else report(result);
  }

  return <>
    <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent className="gp-editor" showCloseButton={false} onInteractOutside={event => event.preventDefault()} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
        <header className="gp-heading">
          <div className="gp-heading-icon"><Link2 size={22} /></div>
          <div><p className="eyebrow">BETTER TOGETHER</p><DialogTitle>{baselineGroup ? 'Manage your group' : 'Create a group'}</DialogTitle><DialogDescription>Link purchases that go together. Every item keeps its own details.</DialogDescription></div>
          <button type="button" className="icon-button gp-close" disabled={busy} aria-label="Close group editor" onClick={requestClose}><X size={20} /></button>
        </header>
        <form onSubmit={save} className="gp-form">
          <div className="gp-scroll">
            <fieldset disabled={busy || !!conflict} className="gp-fields">
              <div className="gp-editor-grid">
                <section className="gp-details" aria-label="Group details">
                  <label className="field" htmlFor={idPrefix + '-name'}>Group name <input id={idPrefix + '-name'} autoComplete="off" required maxLength={60} placeholder="e.g. TV setup" value={draft.name} onChange={event => setDraft(group => ({ ...group, name: event.target.value }))} /></label>
                  <label className="field" htmlFor={idPrefix + '-notes'}>Shared note <span className="gp-optional">Optional</span><textarea id={idPrefix + '-notes'} rows={4} maxLength={1000} placeholder="Dimensions, matching finishes, things to check together…" value={draft.notes} onChange={event => setDraft(group => ({ ...group, notes: event.target.value }))} /></label>
                  <div className="gp-total" aria-live="polite" aria-atomic="true"><span>Budgeted group total</span><strong>{money(total)}</strong><p>{selectedItems.length} linked item{selectedItems.length === 1 ? '' : 's'}{unknown ? ` · ${unknown} missing a price` : ''}</p>{highEndFallback > 0 && <small>Uses high-end estimates for {highEndFallback} item{highEndFallback === 1 ? '' : 's'} without a budgeted amount.</small>}{unknown > 0 && <small className="gp-incomplete">This total is incomplete.</small>}</div>
                  <p className="gp-help"><Info size={16} />These items already count in your plan. Linking them never adds to your budget.</p>
                </section>
                <section className="gp-members" aria-labelledby={idPrefix + '-items'}>
                  <div className="gp-members-heading"><h3 id={idPrefix + '-items'}>Link existing items</h3><span>{selected.length} selected</span></div>
                  <label className="gp-search" htmlFor={idPrefix + '-search'}><Search size={17} /><span className="sr-only">Search items, rooms, or groups</span><input id={idPrefix + '-search'} type="search" placeholder="Search items, rooms, or groups" value={query} onChange={event => setQuery(event.target.value)} /></label>
                  <div className="gp-choices">
                    {filtered.length ? filtered.map(item => { const checked = selected.includes(item.id); const previousGroup = otherGroup(item); return <label key={item.id} className={'gp-choice' + (checked ? ' gp-choice-selected' : '')}>
                      <input type="checkbox" checked={checked} onChange={event => { setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id)); if (reviewRequired) setReviewConfirmed(false); }} />
                      <span className="gp-choice-info"><strong>{item.name}</strong><span>{item.room} · {item.need === 'now' ? 'Immediate need' : 'Can wait'}</span>{previousGroup && <small><Link2 size={12} />{checked ? 'Moves from ' : ''}{previousGroup.name}</small>}</span>
                      <span className="gp-choice-price"><strong>{effectivePrice(item) === null ? 'Price TBD' : money(effectivePrice(item)!)}</strong><small>{item.sale !== null ? 'Budgeted' : item.regular !== null ? 'High-end estimate' : 'Not set'}</small></span>
                    </label>; }) : <div className="gp-no-items"><Link2 size={25} /><strong>{plan.items.length ? 'No matching items' : 'A little room to grow'}</strong><p>{plan.items.length ? 'Try another item, room, or group name.' : 'Save an empty group, then add your first item to it.'}</p></div>}
                  </div>
                  <p className="gp-selection-help">Uncheck an item to unlink it. Its details and place in the shopping list stay the same.</p>
                </section>
              </div>
              {movingItems.length > 0 && <div className="gp-move-note" role="status"><Link2 size={17} /><p><strong>{movingItems.length} item{movingItems.length === 1 ? ' will move' : 's will move'} from another group.</strong> {movingItems.map(item => `${item.name} (${otherGroup(item)?.name})`).join(', ')}. Each item belongs to one group.</p></div>}
              {reviewRequired && <div className="gp-review"><strong>Review the updated selections</strong><p>Your selection changes have been applied to the latest plan. Check the group name, linked items, and any moves above before saving.</p><label><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} />I have reviewed these changes.</label></div>}
            </fieldset>
            <div ref={errorRef}>
              {error && !conflict && <div className="error-box" role="alert">{error}</div>}
              {conflict && <div className="gp-conflict" role="alert"><strong>{deletedGroup ? 'Your partner removed this group.' : 'Your partner updated the plan.'}</strong><p>Your draft is safe. Review the latest changes before saving.</p>
                {latestGroup && baselineGroup && (latestGroup.name !== baselineGroup.name || latestGroup.notes !== baselineGroup.notes) && <p>The group name or shared note changed.</p>}
                {!!changes?.added.length && <p><b>Linked:</b> {itemNames(changes.added)}</p>}
                {!!changes?.removed.length && <p><b>Unlinked:</b> {itemNames(changes.removed)}</p>}
                {!!changes?.moved.length && <p><b>Moved to another group:</b> {itemNames(changes.moved)}</p>}
                {!!changes?.deleted.length && <p><b>Removed from the plan:</b> {itemNames(changes.deleted)}</p>}
                {!!remoteCandidates.length && <p><b>Other selected items changed groups or were removed:</b> {itemNames(remoteCandidates)}</p>}
                {!changes?.added.length && !changes?.removed.length && !changes?.moved.length && !changes?.deleted.length && !remoteCandidates.length && !deletedGroup && <p>Membership is unchanged. Other plan details may have changed.</p>}
                <div className="gp-conflict-actions"><button type="button" className="button secondary" onClick={useLatest}>{deletedGroup || !baselineGroup ? 'Close and use latest plan' : 'Use latest group'}</button><button type="button" className="button primary" onClick={() => reviewChanges(deletedGroup)}>{deletedGroup ? 'Review as a new group' : 'Review my changes'}</button></div>
              </div>}
            </div>
          </div>
          <footer className="gp-footer">
            {baselineGroup ? <button type="button" className="text-button danger-text gp-remove" disabled={busy || !!conflict} onClick={() => setRemoving(true)}><Trash2 size={16} />Remove group</button> : <span className="gp-footer-hint"><Link2 size={15} />One plan, connected purchases</span>}
            <div className="actions"><button type="button" className="button secondary" disabled={busy} onClick={requestClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !!conflict || (reviewRequired && !reviewConfirmed)}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? 'Saving…' : 'Save group'}</button></div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogTitle>Leave these group changes?</AlertDialogTitle><AlertDialogDescription>Your unsaved group changes will be discarded. Your saved items stay as they are.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><button type="button" className="button danger" onClick={onClose}>Discard changes</button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={removing} onOpenChange={open => { if (!busy) setRemoving(open); }}><AlertDialogContent><AlertDialogTitle>Remove {baselineGroup?.name}?</AlertDialogTitle><AlertDialogDescription>Your items will stay in the shopping list. This only removes the group and its shared note.</AlertDialogDescription>{error && <div className="error-box" role="alert">{error}</div>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep group</AlertDialogCancel><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Remove group'}</button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
