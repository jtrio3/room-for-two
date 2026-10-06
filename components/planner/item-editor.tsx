'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Info, Layers, Link2, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { effectivePrice, emptyItem, groupSchema, itemSchema, money, rooms } from '@/lib/planner';
import type { Group, Item, Option, Plan } from '@/lib/planner';

export type ItemSaveMutation = { action: 'save'; item: Item; newGroup?: Group };
type SaveResult = { ok: boolean; error?: string; conflict?: Plan };

export function PriceInput({ label, value, onChange, id, secondary = false }: {
  label: string; value: number | null; onChange: (n: number | null) => void; id: string; secondary?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : (value / 100).toString());
  useEffect(() => {
    if (value === null) setText('');
    else setText(old => Number(old) !== value / 100 ? (value / 100).toString() : old);
  }, [value]);
  return <label className={'field price-field' + (secondary ? ' secondary-price' : '')} htmlFor={id}>
    {label}<span className="price-input"><span>$</span>
      <input id={id} type="number" min="0" max="1000000" step="0.01" inputMode="decimal" placeholder="Not set" value={text}
        onChange={e => { setText(e.target.value); onChange(e.target.value === '' ? null : Math.round(Number(e.target.value) * 100)); }}/>
    </span>
  </label>;
}

function ProductFields({ value, onChange, prefix }: { value: Option | Item; onChange: (patch: Partial<Option>) => void; prefix: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [value.image]);
  return <>
    <label className="field" htmlFor={prefix + 'name'}>Item name <span className="required">*</span>
      <input id={prefix + 'name'} autoComplete="off" required maxLength={160} placeholder="e.g. A sofa for movie nights" value={value.name} onChange={e => onChange({ name: e.target.value })}/>
    </label>
    <div className="form-grid price-fields">
      <PriceInput id={prefix + 'expected'} label="Expected price" value={value.sale} onChange={sale => onChange({ sale })}/>
      <PriceInput id={prefix + 'current'} label="Current price" secondary value={value.regular} onChange={regular => onChange({ regular })}/>
    </div>
    <p className="price-field-help">Expected price is what you plan to spend. If it’s blank, we’ll use the current price as an estimate.</p>
    <label className="field" htmlFor={prefix + 'url'}>Purchase link<input id={prefix + 'url'} type="url" maxLength={2048} placeholder="https://store.com/item" value={value.url} onChange={e => onChange({ url: e.target.value })}/></label>
    <label className="field" htmlFor={prefix + 'image'}>Image link<input id={prefix + 'image'} type="url" maxLength={2048} placeholder="Paste a direct link to an item photo" value={value.image} onChange={e => onChange({ image: e.target.value })}/></label>
    {value.image && /^https?:\/\//i.test(value.image) && <div className="image-preview">
      {!imageFailed ? <img className="item-image" src={value.image} alt={value.name || 'Item preview'} referrerPolicy="no-referrer" onError={() => setImageFailed(true)}/> : <Info size={20}/>}
      <span>{imageFailed ? 'This photo could not load. Try a direct image link.' : 'Image preview'}</span>
    </div>}
    <label className="field" htmlFor={prefix + 'notes'}>Notes<textarea id={prefix + 'notes'} rows={3} maxLength={4000} placeholder="Dimensions, colors, delivery timing, things to compare…" value={value.notes} onChange={e => onChange({ notes: e.target.value })}/></label>
  </>;
}

export function ItemEditor({ initial, plan, busy, onSave, onClose, onDelete }: {
  initial: Item; plan: Plan; busy: boolean; onSave: (m: ItemSaveMutation, revision?: number) => Promise<SaveResult>;
  onClose: () => void; onDelete: (i: Item) => void;
}) {
  const [draft, setDraft] = useState<Item>(() => ({ ...structuredClone(initial), groupId: initial.groupId ?? null }));
  const [revision, setRevision] = useState(plan.revision);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Plan | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupId] = useState(() => crypto.randomUUID());
  const [wasExisting] = useState(() => plan.items.some(i => i.id === initial.id));
  const scroll = useRef<HTMLDivElement>(null);
  const groups = (conflict ?? plan).groups ?? [];
  const missingGroup = !creatingGroup && !!draft.groupId && !groups.some(g => g.id === draft.groupId);
  const dirty = JSON.stringify({ ...initial, groupId: initial.groupId ?? null }) !== JSON.stringify(draft) || creatingGroup || !!newGroupName;
  const requestClose = () => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } };

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  useEffect(() => { if (error || conflict) scroll.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: 'nearest' }); }, [error, conflict]);

  async function save(e?: FormEvent, forceRevision?: number) {
    e?.preventDefault();
    if (busy) return;
    if (missingGroup) { setError('This group was removed in another session. Choose another group or No group to keep your item.'); return; }
    let newGroup: Group | undefined;
    if (creatingGroup) {
      const parsedGroup = groupSchema.safeParse({ id: newGroupId, name: newGroupName, notes: '' });
      if (!parsedGroup.success) { setError(parsedGroup.error.issues[0].message); return; }
      if (groups.some(g => g.name.toLocaleLowerCase() === parsedGroup.data.name.toLocaleLowerCase())) { setError('A group with that name already exists. Choose it from Linked group.'); return; }
      newGroup = parsedGroup.data;
    }
    const parsed = itemSchema.safeParse({ ...draft, groupId: newGroup?.id ?? draft.groupId ?? null });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError('');
    const result = await onSave({ action: 'save', item: parsed.data, ...(newGroup ? { newGroup } : {}) }, forceRevision ?? revision);
    if (result.ok) onClose();
    else { setError(result.error ?? 'Could not save.'); if (result.conflict) setConflict(result.conflict); }
  }

  const latest = conflict?.items.find(i => i.id === initial.id);
  const latestGroupName = latest?.groupId ? groups.find(g => g.id === latest.groupId)?.name ?? 'Group removed' : 'No group';
  function useLatest() {
    if (!latest || !conflict) return;
    setDraft({ ...structuredClone(latest), groupId: latest.groupId ?? null }); setRevision(conflict.revision);
    setCreatingGroup(false); setNewGroupName(''); setConflict(null); setError('');
  }
  function addBackup() {
    const { id, name, url, image, regular, sale, notes } = emptyItem();
    setDraft(d => ({ ...d, backups: [...d.backups, { id, name, url, image, regular, sale, notes }] }));
    setExpanded(id);
  }

  return <>
    <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent className="editor-dialog" showCloseButton={false} onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }}>
        <div className="dialog-heading">
          <button type="button" className="icon-button editor-close" disabled={busy} onClick={requestClose} aria-label="Close item editor"><X size={18}/></button>
          <p className="eyebrow">MAKE ROOM FOR IT</p><DialogTitle>{wasExisting ? 'Edit item' : 'Add to your home'}</DialogTitle>
          <DialogDescription>Plan what you’ll spend and keep related purchases together.</DialogDescription>
        </div>
        <form onSubmit={save}>
          <div className="editor-scroll" ref={scroll}>
            <fieldset disabled={busy} className="form-fields">
              <ProductFields value={draft} prefix="main-" onChange={patch => setDraft(d => ({ ...d, ...patch }))}/>
              <div className="form-grid">
                <label className="field" htmlFor="room">Room<select id="room" value={draft.room} onChange={e => setDraft(d => ({ ...d, room: e.target.value as Item['room'] }))}>{rooms.map(r => <option key={r}>{r}</option>)}</select></label>
                <label className="field" htmlFor="need">When do we need it?<select id="need" value={draft.need} onChange={e => setDraft(d => ({ ...d, need: e.target.value as Item['need'] }))}><option value="now">Immediate need</option><option value="later">Can wait</option></select></label>
              </div>
              <div className="item-group-field">
                <label className="field" htmlFor="linked-group"><span><Link2 size={15}/> Linked group <span className="optional-label">(optional)</span></span>
                  <select id="linked-group" value={creatingGroup ? '__new__' : draft.groupId ?? ''} onChange={e => {
                    setCreatingGroup(e.target.value === '__new__');
                    if (e.target.value !== '__new__') setDraft(d => ({ ...d, groupId: e.target.value || null }));
                    setError('');
                  }}>
                    <option value="">No group</option>
                    {missingGroup && <option value={draft.groupId!} disabled>Group removed — choose another</option>}
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    {groups.length < 100 && <option value="__new__">+ Create a new group</option>}
                  </select>
                  <small>Link purchases such as a TV, wall mount, and speakers. Each counts toward your budget once.</small>
                </label>
                {creatingGroup && <label className="field" htmlFor="new-group-name">New group name<input id="new-group-name" required maxLength={60} placeholder="e.g. TV setup" value={newGroupName} onChange={e => setNewGroupName(e.target.value)}/></label>}
                {missingGroup && <p className="error-box" role="alert">Your partner removed this group. Choose another group or No group; your item draft is still here.</p>}
              </div>
              <div className="backup-heading"><div><h3><Layers size={17}/> Backup options <span className="count">{draft.backups.length}</span></h3><p>Alternatives don’t count toward your budget.</p></div>
                <button type="button" className="text-button" disabled={draft.backups.length >= 20} onClick={addBackup}><Plus size={16}/> Add option</button>
              </div>
              {draft.backups.map((b, index) => <div className="backup-form" key={b.id}>
                <div className="between"><button type="button" className="backup-toggle" aria-expanded={expanded === b.id} onClick={() => setExpanded(expanded === b.id ? null : b.id)}><span className="option-number">{index + 1}</span>{b.name || 'New backup option'}{expanded === b.id ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</button>
                  <button type="button" className="icon-button danger-text" aria-label={'Remove backup ' + (b.name || index + 1)} onClick={() => setDraft(d => ({ ...d, backups: d.backups.filter(x => x.id !== b.id) }))}><X size={16}/></button>
                </div>
                {expanded === b.id && <div className="backup-fields"><ProductFields value={b} prefix={'backup-' + b.id + '-'} onChange={patch => setDraft(d => ({ ...d, backups: d.backups.map(x => x.id === b.id ? { ...x, ...patch } : x) }))}/></div>}
              </div>)}
              <p className="form-help"><Info size={15}/> Expected prices can be your Black Friday estimates. Confirm the price before purchasing.</p>
              {error && <div role="alert" className="error-box">{error}</div>}
              {conflict && <div className="conflict-box"><strong>Your shared plan changed</strong>
                {latest ? <>
                  <p>Latest saved: {latest.name} · {effectivePrice(latest) === null ? 'Price not set' : money(effectivePrice(latest)!)} · {latest.need === 'now' ? 'Immediate need' : 'Can wait'}</p>
                  <p className="small">Linked group: {latestGroupName}</p><p className="small">{latest.notes || 'No notes'}</p>
                  <p className="small">Saving your version replaces this item’s details and group with the values in your form.</p>
                  <button type="button" className="button secondary" onClick={useLatest}>Use latest version</button>{' '}
                  <button type="button" className="button primary" disabled={busy || missingGroup} onClick={() => void save(undefined, conflict.revision)}>Save my version</button>
                </> : <>
                  <p>{wasExisting ? 'This item was deleted in another session.' : 'The list changed in another session.'} Your draft is preserved.</p>
                  <button type="button" className="button primary" disabled={busy || missingGroup} onClick={() => void save(undefined, conflict.revision)}>{wasExisting ? 'Restore my item' : 'Save my item'}</button>
                </>}
              </div>}
            </fieldset>
          </div>
          <div className="dialog-footer">
            <div>{wasExisting && <button type="button" className="text-button danger-text" disabled={busy} onClick={() => onDelete(initial)}><Trash2 size={16}/> Delete item</button>}</div>
            <div className="actions"><button type="button" className="button secondary" disabled={busy} onClick={requestClose}>Cancel</button>
              <button className="button primary" type="submit" disabled={busy || !!conflict || missingGroup}>{busy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>} {busy ? 'Saving…' : 'Save item'}</button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogTitle>Discard these changes?</AlertDialogTitle><AlertDialogDescription>Changes in this form will be lost. Your saved list will stay as it is.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><button className="button primary" onClick={onClose}>Discard changes</button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
