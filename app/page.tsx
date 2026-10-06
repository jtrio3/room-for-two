'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { House, Plus, Heart, Gift, CalendarDays, Link2, CloudCheck, CloudOff, GripVertical, Pencil, Layers, Tag, RefreshCw, Copy, LoaderCircle, Info, ListOrdered } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { rooms, metrics, money, effectivePrice, emptyItem, settingsSchema, moveItem, promote } from '@/lib/planner';
import type { Group, Item, Plan } from '@/lib/planner';
import { PlanSession, resolvePlanAccess, accessStorageKey, pendingStorageKey } from '@/lib/client';
import type { PlanAccess, PlanSessionId } from '@/lib/client';
import { ItemEditor, PriceInput } from '@/components/planner/item-editor';
import type { ItemSaveMutation } from '@/components/planner/item-editor';
import { GroupEditor } from '@/components/planner/group-editor';
import type { GroupMutation } from '@/components/planner/group-editor';
import { ShoppingList } from '@/components/planner/shopping-list';
type SaveResult = {
    ok: boolean;
    error?: string;
    conflict?: Plan;
};
type Mutation = ItemSaveMutation | GroupMutation | { action: 'delete'; id: string } | { action: 'reorder'; ids: string[] } | { action: 'settings'; settings: { personal: number; gift: number; moveMonth: string } };
const defaultPlan: Plan = { id: '', revision: 0, personal: 1000000, gift: 200000, moveMonth: '2026-11', updatedAt: 0, items: [], groups: [] };
const monthLabel = (month: string) => new Date(month + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';
function Choice({ label, value, onChange, options, id, disabled = false }: {
    label: string;
    value: string;
    onChange: (s: string) => void;
    options: {
        value: string;
        label: string;
    }[];
    id?: string;
    disabled?: boolean;
}) { return <Select disabled={disabled} value={value} onValueChange={onChange}><SelectTrigger id={id} className="choice" aria-label={label}><SelectValue /></SelectTrigger><SelectContent className="choice-menu">{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>; }
function BudgetEditor({ plan, busy, onSave, onClose }: {
    plan: Plan;
    busy: boolean;
    onSave: (m: Mutation, revision?: number) => Promise<SaveResult>;
    onClose: () => void;
}) { const [personal, setPersonal] = useState<number | null>(plan.personal); const [gift, setGift] = useState<number | null>(plan.gift); const [month, setMonth] = useState(plan.moveMonth); const [revision, setRevision] = useState(plan.revision); const [error, setError] = useState(''); const [conflict, setConflict] = useState(false); return <Dialog open onOpenChange={o => !o && !busy && onClose()}><DialogContent className="budget-dialog" onInteractOutside={e => e.preventDefault()}><DialogTitle>Make room in the budget</DialogTitle><DialogDescription>Adjust your contributions as your plans take shape.</DialogDescription><form onSubmit={async (e) => { e.preventDefault(); const settings = settingsSchema.safeParse({ personal: personal ?? 0, gift: gift ?? 0, moveMonth: month }); if (!settings.success) {
    setError(settings.error.issues[0].message);
    return;
} const r = await onSave({ action: 'settings', settings: settings.data }, revision); if (r.ok)
    onClose();
else {
    setError(r.error ?? 'Could not save.');
    if (r.conflict) {
        setRevision(r.conflict.revision);
        setConflict(true);
    }
} }}><fieldset disabled={busy} className="form-fields"><PriceInput id="personal" label="Our contribution" value={personal} onChange={setPersonal}/><PriceInput id="gift" label="Family gift" value={gift} onChange={setGift}/><label className="field" htmlFor="moveMonth">Move-in month<input id="moveMonth" type="month" value={month} required onChange={e => setMonth(e.target.value)}/></label><div className="budget-total between"><span>Total budget</span><strong>{money((personal ?? 0) + (gift ?? 0))}</strong></div>{error && <div className="error-box" role="alert">{error}{conflict && <p>Current budget: {money(plan.personal + plan.gift)}. Save again to apply your amounts.</p>}</div>}<div className="actions end"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving…' : conflict ? 'Save my amounts' : 'Save budget'}</button></div></fieldset></form></DialogContent></Dialog>; }
export default function Home() {
    const [plan, setPlan] = useState<Plan | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [syncError, setSyncError] = useState('');
    const [busy, setBusy] = useState(false);
    const [editor, setEditor] = useState<Item | null>(null);
    const [groupEditor, setGroupEditor] = useState<{group:Group|null}|null>(null);
    const [view, setView] = useState<'items'|'groups'>('items');
    const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
    const [budgetOpen, setBudgetOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [deleting, setDeleting] = useState<Item | null>(null);
    const [deleteError, setDeleteError] = useState('');
    const [filter, setFilter] = useState('all');
    const [sort, setSort] = useState('priority');
    const [expanded, setExpanded] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [shareLink, setShareLink] = useState('');
    const [announce, setAnnounce] = useState('');
    const [session] = useState(() => new PlanSession());
    const access = useRef<PlanAccess | null>(null);
    const current = useRef<Plan | null>(null);
    const busyRef = useRef(false);
    const loadingRef = useRef(true);
    const editingRef = useRef(false);
    editingRef.current = !!editor || budgetOpen || !!deleting || !!groupEditor;
    const initPromise = useRef<Promise<void> | null>(null);
    const dragCleanup = useRef<(() => void) | null>(null);
    const applyPlan = useCallback((identity: PlanSessionId, next: Plan) => { if (!session.accept(identity, next))
        return false; current.current = next; setPlan(next); return true; }, [session]);
    const initialize = useCallback(async () => {
        loadingRef.current = true;
        setLoading(true);
        setLoadError('');
        let next: PlanAccess;
        try {
            const hash = new URLSearchParams(window.location.hash.slice(1)).get('plan');
            let remembered = '', pending = '';
            try {
                remembered = localStorage.getItem(accessStorageKey) ?? '';
                pending = localStorage.getItem(pendingStorageKey) ?? '';
            }
            catch { }
            next = resolvePlanAccess(hash, remembered, pending, access.current, () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''));
        }
        catch (e) {
            session.begin('');
            access.current = null;
            current.current = null;
            busyRef.current = false;
            editingRef.current = false;
            dragCleanup.current?.();
            setPlan(null);
            setEditor(null);
            setGroupEditor(null);
            setBudgetOpen(false);
            setDeleting(null);
            setShareOpen(false);
            setShareLink('');
            setBusy(false);
            setSyncError('');
            setLoadError(errorText(e));
            loadingRef.current = false;
            setLoading(false);
            return;
        }
        const switched = session.identity.key !== next.key;
        const identity = session.begin(next.key);
        access.current = next;
        current.current = session.plan;
        if (switched) {
            dragCleanup.current?.();
            editingRef.current = false;
            setPlan(null);
            setEditor(null);
            setGroupEditor(null);
            setBudgetOpen(false);
            setDeleting(null);
            setDeleteError('');
            setShareOpen(false);
            setShareLink('');
            setExpanded(null);
            setSyncError('');
        }
        busyRef.current = false;
        setBusy(false);
        if (next.creating) {
            try {
                localStorage.setItem(accessStorageKey, next.key);
                localStorage.setItem(pendingStorageKey, next.key);
            }
            catch { }
        }
        try {
            const { response, data } = await session.request(identity, next.creating ? 'POST' : 'GET');
            if (!response.ok)
                throw new Error(data.error ?? 'Could not open your plan.');
            if (!session.isActive(identity))
                return;
            applyPlan(identity, data);
            access.current = { key: next.key, creating: false };
            setSyncError('');
            try {
                localStorage.setItem(accessStorageKey, next.key);
                if (localStorage.getItem(pendingStorageKey) === next.key)
                    localStorage.removeItem(pendingStorageKey);
            }
            catch { }
            history.replaceState(null, '', location.pathname + location.search + '#plan=' + next.key);
            setShareLink(location.href);
        }
        catch (e) {
            if (session.isActive(identity))
                setLoadError(errorText(e));
        }
        finally {
            if (session.isActive(identity)) {
                loadingRef.current = false;
                setLoading(false);
            }
        }
    }, [session, applyPlan]);
    useEffect(() => { if (!initPromise.current)
        initPromise.current = initialize(); const change = () => { initPromise.current = initialize(); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, [initialize]);
    useEffect(() => {
        const refresh = async () => {
            if (loadingRef.current || !current.current || busyRef.current || editingRef.current || dragCleanup.current || document.hidden)
                return;
            const identity = session.identity;
            const revision = current.current.revision;
            try {
                const { response, data } = await session.request(identity);
                if (!response.ok)
                    throw new Error(data.error);
                if (loadingRef.current || busyRef.current || editingRef.current || dragCleanup.current)
                    return;
                if (applyPlan(identity, data))
                    setSyncError('');
            }
            catch {
                if (session.isActive(identity) && !busyRef.current && current.current?.revision === revision)
                    setSyncError('Cloud sync paused. Check your connection.');
            }
        };
        const interval = setInterval(refresh, 10000);
        window.addEventListener('focus', refresh);
        window.addEventListener('online', refresh);
        return () => { clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
    }, [session, applyPlan]);
    const mutate = useCallback(async (m: Mutation, revision?: number): Promise<SaveResult> => {
        if (loadingRef.current || !current.current)
            return { ok: false, error: 'Wait for your plan to finish opening.' };
        if (busyRef.current)
            return { ok: false, error: 'Please wait for the current save.' };
        const identity = session.identity;
        busyRef.current = true;
        setBusy(true);
        try {
            const { response, data } = await session.request(identity, 'PATCH', { ...m, revision: revision ?? current.current.revision });
            if (!session.isActive(identity))
                return { ok: false, error: 'The open plan changed. Reopen the previous plan to check your save.' };
            if (!response.ok) {
                if (data.plan)
                    applyPlan(identity, data.plan);
                if (response.status >= 500)
                    setSyncError('The last save could not be confirmed. Check your connection and try again.');
                return { ok: false, error: response.status >= 500 ? 'Could not confirm your save. Your draft is still here; please try again.' : data.error ?? 'Could not save. Please try again.', conflict: response.status === 409 ? (session.plan ?? data.plan) : undefined };
            }
            applyPlan(identity, data);
            setSyncError('');
            setAnnounce('Changes saved to your shared plan.');
            return { ok: true };
        }
        catch {
            if (!session.isActive(identity))
                return { ok: false, error: 'The open plan changed. Reopen the previous plan to check your save.' };
            setSyncError('The last save could not be confirmed. Check your connection and try again.');
            return { ok: false, error: 'Could not confirm your save. Your draft is still here; check your connection and try again.' };
        }
        finally {
            if (session.isActive(identity)) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    }, [session, applyPlan]);
    const openNew = (groupId: string|null = null) => { if (!plan || loadingRef.current || busyRef.current)
        return; setEditor({ ...emptyItem(), priority: plan.items.length + 1, groupId }); };
    const reorder = async (id: string, rank: number) => { const p = current.current; if (!p)
        return; const ordered = moveItem(p.items, id, rank); if (ordered.every((x, i) => x.id === p.items[i].id))
        return; const r = await mutate({ action: 'reorder', ids: ordered.map(i => i.id) }); if (!r.ok)
        toast.error(r.error);
    else {
        setAnnounce('Item moved to position ' + rank + ' in your list.');
        toast.success('List order updated');
    } };
    function startDrag(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
        if (view !== 'items' || sort !== 'priority' || filter !== 'all' || busyRef.current || loadingRef.current || !e.isPrimary || e.button !== 0)
            return;
        dragCleanup.current?.();
        e.preventDefault();
        e.currentTarget.focus();
        const identity = session.identity;
        const target = e.currentTarget;
        const pointerId = e.pointerId;
        target.setPointerCapture(pointerId);
        setDragging(id);
        let targetId: string | null = null;
        const move = (ev: PointerEvent) => { if (ev.pointerId !== pointerId)
            return; targetId = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-item-id]') as HTMLElement | null)?.dataset.itemId ?? null; setDropTarget(targetId); if (ev.clientY < 90)
            window.scrollBy(0, -12);
        else if (ev.clientY > window.innerHeight - 90)
            window.scrollBy(0, 12); };
        const cleanup = () => { dragCleanup.current = null; setDragging(null); setDropTarget(null); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', cancel); target.removeEventListener('lostpointercapture', cancel); if (target.hasPointerCapture(pointerId))
            target.releasePointerCapture(pointerId); };
        const cancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId)
            cleanup(); };
        const up = (ev: PointerEvent) => { if (ev.pointerId !== pointerId)
            return; cleanup(); if (session.isActive(identity) && targetId && targetId !== id) {
            const rank = current.current?.items.find(i => i.id === targetId)?.priority;
            if (rank)
                void reorder(id, rank);
        } };
        dragCleanup.current = cleanup;
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', cancel);
        target.addEventListener('lostpointercapture', cancel);
    }
    useEffect(() => () => dragCleanup.current?.(), []);
    useEffect(() => { const context = (document as Document & {
        modelContext?: {
            registerTool: (t: unknown, o: {
                signal: AbortSignal;
            }) => void;
        };
    }).modelContext; if (!context?.registerTool)
        return; const lifecycle = new AbortController(); try {
        context.registerTool({ name: 'read_home_shopping_plan', title: 'Read home shopping plan', description: 'Read the open shopping plan, its items and calculated budget. Does not expose its shared edit key.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input: unknown) { if (!input || typeof input !== 'object' || Object.keys(input).length)
                throw new Error('Expected an empty object'); if (!current.current)
                throw new Error('The plan is not loaded'); return { ...current.current, budget: metrics(current.current) }; } }, { signal: lifecycle.signal });
        context.registerTool({ name: 'start_shopping_item', title: 'Start adding a shopping item', description: 'Open the add-item form with a name. This stages a draft; the user must save it.', inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 160 } }, required: ['name'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input: unknown) { const x = input as {
                name?: unknown;
            }; if (!x || typeof x.name !== 'string' || !x.name.trim() || x.name.length > 160 || Object.keys(x).some(k => k !== 'name'))
                throw new Error('Provide an item name from 1 to 160 characters'); if (!current.current || editingRef.current)
                throw new Error('Finish the current form first'); setEditor({ ...emptyItem(), name: x.name, priority: current.current.items.length + 1 }); return { staged: true, name: x.name }; } }, { signal: lifecycle.signal });
    }
    catch { } return () => lifecycle.abort(); }, []);
    useEffect(() => {
        if (!plan?.id) return;
        try {
            const saved = JSON.parse(localStorage.getItem('room-for-two-view:' + plan.id) ?? '{}');
            setView(saved.view === 'groups' ? 'groups' : 'items');
            setCollapsedGroups(Array.isArray(saved.collapsed) ? saved.collapsed.filter((id: unknown) => typeof id === 'string').slice(0, 100) : []);
        } catch { setView('items'); setCollapsedGroups([]); }
    }, [plan?.id]);
    function rememberView(nextView: 'items'|'groups', collapsed = collapsedGroups) {
        setView(nextView); setCollapsedGroups(collapsed);
        if (plan) { try { localStorage.setItem('room-for-two-view:' + plan.id, JSON.stringify({view:nextView,collapsed})); } catch {} }
    }
    const data = plan ?? defaultPlan;
    const m = metrics(data);
    const activeSort = view === 'groups' ? 'priority' : sort;
    const visible = data.items.filter(i => filter === 'all' || i.need === filter).sort((a, b) =>
        activeSort === 'price-high' ? (effectivePrice(b) ?? -1) - (effectivePrice(a) ?? -1) :
        activeSort === 'price-low' ? (effectivePrice(a) ?? Infinity) - (effectivePrice(b) ?? Infinity) :
        activeSort === 'name' ? a.name.localeCompare(b.name) : a.priority - b.priority);
    const now = data.items.filter(i => i.need === 'now').length;
    const preview = !plan;
    const remainingText = m.remaining < 0 ? money(-m.remaining) + ' over budget' : money(m.remaining) + ' left';
    const canShowList = visible.length > 0 || (view === 'groups' && (data.groups?.length ?? 0) > 0);
    const reorderEnabled = view === 'items' && filter === 'all' && sort === 'priority' && !loading;
    const itemList = canShowList ? <ShoppingList
        plan={data} visible={visible} groupView={view === 'groups'} filter={filter} busy={busy || loading}
        reorderEnabled={reorderEnabled} expanded={expanded} dragging={dragging} dropTarget={dropTarget} collapsed={collapsedGroups}
        onToggleBackup={id => setExpanded(expanded === id ? null : id)} onEdit={setEditor}
        onGroup={group => setGroupEditor({ group })} onStartDrag={startDrag}
        onMove={(item, offset) => { if (reorderEnabled) void reorder(item.id, item.priority + offset); }}
        onToggleGroup={id => rememberView(view, collapsedGroups.includes(id) ? collapsedGroups.filter(g => g !== id) : [...collapsedGroups, id])}
        onAddToGroup={id => openNew(id)} onClearFilter={() => setFilter('all')}
        onPromote={async (item, optionId) => {
            const result = await mutate({ action: 'save', item: promote(item, optionId) });
            if (!result.ok) toast.error(result.error);
            else toast.success('Main choice updated. Your previous choice is now a backup.');
        }}
    /> : <Empty className="empty-state"><EmptyHeader>
        <EmptyMedia className="empty-icon"><House size={32}/></EmptyMedia>
        <EmptyTitle>{loading ? 'Opening your shared plan…' : loadError ? 'Let’s reconnect your plan.' : filter !== 'all' ? 'Nothing with this timing yet.' : 'Every home starts somewhere.'}</EmptyTitle>
        <EmptyDescription>{loading ? 'Your list and budget will be ready in a moment.' : loadError || (filter !== 'all' ? 'Change an item’s timing or add something new.' : 'Add the first thing you need for your new space. Compare options and work out the details together.')}</EmptyDescription>
    </EmptyHeader>{loadError ? <button className="button secondary" onClick={() => void initialize()}><RefreshCw size={16}/> Try again</button> :
        !loading && <button className="button primary" onClick={() => openNew()}><Plus size={17}/> Add your first item</button>}</Empty>;
    return <>
        <Toaster position="bottom-center" theme="light" richColors className={editor || groupEditor || budgetOpen || deleting ? 'toaster-suspended' : 'toaster'}/>
        <header className="topbar">
            <div className="brand"><span className="brand-mark"><House size={23}/></span>room for two<span className="brand-dot">.</span></div>
            <span className="top-note">A little planning. A lot of home.</span>
            <div className="header-actions">
                <span className={'sync-state ' + (syncError ? 'sync-warning' : '')}>{busy ? <LoaderCircle className="spin" size={15}/> : syncError ? <CloudOff size={16}/> : <CloudCheck size={16}/>}<span>{busy ? 'Saving…' : syncError ? 'Sync paused' : plan ? 'Cloud saved' : 'Connecting…'}</span></span>
                <button className="button secondary" disabled={!plan || loading} onClick={() => setShareOpen(true)}><Link2 size={16}/> Share plan</button>
            </div>
        </header>
        <main className="workspace">
            <div className="page-heading"><div><p className="eyebrow">OUR NEXT CHAPTER</p><h1>Our home shopping plan</h1><p className="muted">The essentials, the wish list, and everything that goes together.</p></div>
                <button className="move-pill" disabled={!plan || busy || loading} onClick={() => setBudgetOpen(true)}><CalendarDays size={18}/> Moving in {monthLabel(data.moveMonth)}</button>
            </div>
            {syncError && <div className="error-box sync-banner" role="status">{syncError} Your saved list is still here.<button className="text-button" disabled={busy || loading} onClick={() => void initialize()}>Reconnect</button></div>}
            <section className="overview" aria-label="Budget summary">
                <div className={'budget-card ' + (m.remaining < 0 ? 'over-budget' : '')}>
                    <div className="between"><span>Total budget</span><button className="budget-edit" disabled={preview || busy || loading} aria-label="Edit budget" onClick={() => setBudgetOpen(true)}><Pencil size={15}/><span>Edit</span></button></div>
                    <strong>{money(m.total)}<span>{m.total % 100 === 0 ? '.00' : ''}</span></strong>
                    <div className="budget-sources"><span>{money(data.personal)} personal</span><span><Gift size={14}/> {money(data.gift)} family gift</span></div>
                    <Progress className="budget-track" value={Math.min(100, m.allocated ?? 0)} aria-label="Budget allocated at expected prices"/>
                    <div className="between small"><span>{m.allocated === null ? 'No budget set' : m.allocated.toFixed(1) + '% allocated'}</span><span>{remainingText}</span></div>
                </div>
                <div className="metrics">
                    <div className="expected-metric"><span>Expected spend</span><strong className="blue-text">{money(m.expected)}</strong><small>Current prices: {money(m.current)}{m.unknownCurrent ? ' · ' + m.unknownCurrent + ' unset' : ''}</small></div>
                    <div><span>{m.remaining < 0 ? 'Over budget' : 'Remaining budget'}</span><strong>{money(Math.abs(m.remaining))}</strong><small>Based on expected spend</small></div>
                    <div><span><Tag size={13}/> Potential savings</span><strong>{money(m.savings)}</strong><small>{m.overage > 0 ? money(m.overage) + ' expected above current on other items' : 'Expected versus current prices'}</small></div>
                    <div><span>Immediate needs</span><strong>{money(m.immediate)}</strong><small>{now} item{now === 1 ? '' : 's'} at expected prices</small></div>
                </div>
            </section>
            {(m.unknown > 0 || m.usingCurrent > 0) && <div className="price-warning"><Info size={16}/><div>
                {m.unknown > 0 && <p>{m.unknown} item{m.unknown === 1 ? ' is' : 's are'} missing both prices. Budget totals are incomplete.</p>}
                {m.usingCurrent > 0 && <p>{m.usingCurrent} item{m.usingCurrent === 1 ? ' uses its' : 's use their'} current price as an estimate until you add an expected price.</p>}
            </div></div>}
            <div className="main-grid">
                <section className="shopping">
                    <div className="between list-heading"><div><h2>The shopping list <span className="count">{data.items.length}</span></h2><p className="muted small">Plan each purchase. Link what goes together.</p></div>
                        <div className="list-add-actions"><button className="button secondary" disabled={preview || busy || loading || (data.groups?.length ?? 0) >= 100} onClick={() => setGroupEditor({ group: null })}><Link2 size={16}/> New group</button>
                            <button className="button primary" disabled={preview || busy || loading || data.items.length >= 300} onClick={() => openNew()}><Plus size={18}/> Add item</button></div>
                    </div>
                    <div className="view-controls"><div className="view-switch" aria-label="Shopping list view">
                        <button type="button" aria-pressed={view === 'items'} onClick={() => rememberView('items')}><ListOrdered size={16}/> Items</button>
                        <button type="button" aria-pressed={view === 'groups'} onClick={() => rememberView('groups')}><Layers size={16}/> Groups</button>
                    </div><span className="muted small">{view === 'groups' ? 'Related purchases, counted once.' : 'Drag to arrange your list.'}</span></div>
                    <Tabs value={filter} onValueChange={setFilter}>
                        <div className="list-toolbar">
                            <TabsList className="filter-tabs" aria-label="Shopping timing"><TabsTrigger value="all">All items <span>{data.items.length}</span></TabsTrigger><TabsTrigger value="now">Immediate <span>{now}</span></TabsTrigger><TabsTrigger value="later">Can wait <span>{data.items.length - now}</span></TabsTrigger></TabsList>
                            {view === 'items' ? <Choice label="Sort items" value={sort} onChange={setSort} options={[{ value: 'priority', label: 'Manual order' }, { value: 'price-high', label: 'Expected: high to low' }, { value: 'price-low', label: 'Expected: low to high' }, { value: 'name', label: 'Name: A to Z' }]}/> : <span className="muted small group-order-hint">Groups follow your manual order</span>}
                        </div>
                        {['all', 'now', 'later'].map(tab => <TabsContent key={tab} value={tab}>{itemList}</TabsContent>)}
                    </Tabs>
                    {data.items.length > 0 && <div className="list-foot"><span><GripVertical size={14}/>{reorderEnabled ? 'Drag the handles to arrange your list. Arrow keys work too.' : 'Choose Items, All items, and Manual order to rearrange.'}</span><span>Estimates exclude tax & delivery.</span></div>}
                </section>
                <aside>
                    <div className="home-card"><img src="https://images.unsplash.com/photo-1713283391486-b92cda2562e8?auto=format&fit=crop&w=1000&q=85" alt="A sunlit living room with a blue sofa" referrerPolicy="no-referrer"/><div><p className="eyebrow">MAKING IT OURS</p><h2>A place for us.</h2><p>{monthLabel(data.moveMonth)} <Heart size={15}/></p></div></div>
                    {data.items.length > 0 && <div className="room-breakdown"><h3>Expected spend by room</h3>{rooms.map(room => {
                        const items = data.items.filter(i => i.room === room);
                        if (!items.length) return null;
                        const cost = items.reduce((sum, item) => sum + (effectivePrice(item) ?? 0), 0);
                        return <div key={room}><div className="between"><span>{room}</span><strong>{money(cost)}</strong></div><Progress value={m.expected ? cost / m.expected * 100 : 0} aria-label={room + ' share of expected spend'}/></div>;
                    })}</div>}
                    <div className="note-card"><span className="eyebrow">BLACK FRIDAY GAME PLAN</span><h3>Know your must-haves.</h3><p>Plan for the full setup, then leave a little room for the deals worth waiting for.</p><span className="tag">Plan now. Compare before you buy.</span></div>
                </aside>
            </div>
            <footer className="page-footer"><span>Made for the home you’re building together.</span><span><CloudCheck size={14}/> Saved across your devices</span></footer>
        </main>
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
        {editor && plan && <ItemEditor key={editor.id} initial={editor} plan={plan} busy={busy} onSave={async (mutation, revision) => {
            const result = await mutate(mutation, revision);
            if (result.ok) toast.success('Item saved');
            return result;
        }} onClose={() => setEditor(null)} onDelete={item => { setDeleteError(''); setDeleting(item); }}/>}
        {groupEditor && plan && <GroupEditor key={groupEditor.group?.id ?? 'new-group'} initial={groupEditor.group} plan={plan} busy={busy} onSave={async (mutation, revision) => {
            const result = await mutate(mutation, revision);
            if (result.ok) {
                toast.success(mutation.action === 'removeGroup' ? 'Group removed. Your items are still in the list.' : 'Group saved');
                rememberView('groups', collapsedGroups.filter(id => id !== (mutation.action === 'saveGroup' ? mutation.group.id : mutation.id)));
            }
            return result;
        }} onClose={() => setGroupEditor(null)}/>}
        {budgetOpen && plan && <BudgetEditor plan={plan} busy={busy} onSave={mutate} onClose={() => setBudgetOpen(false)}/>}
 <Dialog open={shareOpen} onOpenChange={setShareOpen}><DialogContent className="share-dialog"><span className="share-icon"><Link2 size={24}/></span><DialogTitle>A plan for the two of you.</DialogTitle><DialogDescription>Send this link to your partner or open it on another device. No account needed.</DialogDescription><label className="field" htmlFor="share-link">Your shared edit link<input id="share-link" readOnly value={shareLink} onFocus={e => e.target.select()}/></label><button className="button primary" onClick={async () => { try {
        await navigator.clipboard.writeText(shareLink);
        toast.success('Shared link copied');
    }
    catch {
        const input = document.getElementById('share-link') as HTMLInputElement;
        input.focus();
        input.select();
        toast.info('Select and copy the link above.');
    } }}><Copy size={16}/> Copy shared link</button><p className="form-help"><Info size={15}/> Anyone with this link can view and edit the plan. Keep a copy to reopen it if you clear your browser data.</p></DialogContent></Dialog>
 <AlertDialog open={!!deleting} onOpenChange={o => !o && !busy && setDeleting(null)}><AlertDialogContent><AlertDialogTitle>Remove {deleting?.name}?</AlertDialogTitle><AlertDialogDescription>This removes the item and all its backup options from your shared plan.</AlertDialogDescription>{deleteError && <div className="error-box" role="alert">{deleteError}</div>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep item</AlertDialogCancel><button className="button danger" disabled={busy} onClick={async () => { if (!deleting)
        return; const r = await mutate({ action: 'delete', id: deleting.id }); if (r.ok) {
        setDeleting(null);
        setEditor(null);
            setGroupEditor(null);
        toast.success('Item removed');
    }
    else
        setDeleteError(r.error ?? 'Could not delete.'); }}>{busy ? 'Removing…' : 'Remove item'}</button></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
