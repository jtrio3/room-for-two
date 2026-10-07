'use client';

import { useEffect, useState } from 'react';
import type { PointerEvent } from 'react';
import { Bath, BedDouble, Check, ChevronDown, ChevronUp, CookingPot, ExternalLink, GripVertical, Info, Lamp, Layers, Leaf, Link2, Package, Pencil, Plus, ShoppingBag, Sofa } from 'lucide-react';
import { effectivePrice, isPurchased, money, rooms } from '@/lib/planner';
import type { Group, Item, Plan } from '@/lib/planner';
import { groupMembers, groupMetrics, sortedGroups } from '@/lib/groups';

const roomIcons = { 'Living room': Sofa, 'Bedroom': BedDouble, 'Kitchen & dining': CookingPot, Bathroom: Bath, 'Home office': Lamp, Outdoors: Leaf, Other: Package };
function ItemImage({ image, name, room }: { image: string; name: string; room: Item['room'] }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  const Icon = roomIcons[room];
  return <div className={'item-image room-' + rooms.indexOf(room)}>
    {image && !failed ? <img src={image} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : <Icon size={27} strokeWidth={1.35}/>}
  </div>;
}

type Props = {
  plan: Plan; visible: Item[]; groupView: boolean; filterActive: boolean; busy: boolean; reorderEnabled: boolean;
  expanded: string | null; dragging: string | null; dropTarget: string | null; collapsed: string[];
  onToggleBackup: (id: string) => void; onEdit: (item: Item) => void; onPurchase: (item: Item) => void; onGroup: (group: Group) => void;
  onStartDrag: (event: PointerEvent<HTMLButtonElement>, id: string) => void;
  onMove: (item: Item, offset: number) => void; onPromote: (item: Item, optionId: string) => void;
  onToggleGroup: (id: string) => void; onAddToGroup: (id: string) => void; onClearFilter: () => void;
};

export function ShoppingList(props: Props) {
  const { plan, visible, groupView, busy, expanded } = props;
  const groups = plan.groups ?? [];
  function renderItem(item: Item) {
    const group = groups.find(g => g.id === item.groupId);
    const price = effectivePrice(item);
    const purchased = isPurchased(item);
    return <article key={item.id} data-item-id={item.id} className={'item-card ' + (purchased ? 'is-purchased ' : '') + (props.dragging === item.id ? 'dragging ' : '') + (props.dropTarget === item.id ? 'drop-target' : '')}>
      <div className="item-row">
        {!groupView && <div className="rank"><button className="drag-handle" disabled={busy || !props.reorderEnabled}
          aria-label={'Reorder ' + item.name + '. Drag or use up and down arrow keys.'} title="Drag to reorder · keyboard: ↑ ↓"
          onPointerDown={e => props.onStartDrag(e, item.id)} onKeyDown={e => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); props.onMove(item, e.key === 'ArrowUp' ? -1 : 1); }
          }}><GripVertical size={18}/></button></div>}
        <ItemImage image={item.image} name={item.name} room={item.room}/>
        <div className="item-info"><button className="item-title" disabled={busy} onClick={() => props.onEdit(item)}>{item.name}</button>
          <div className="item-meta"><span>{item.room}</span></div>
          {item.notes && <p className="item-note">{item.notes}</p>}
        </div>
        <div className="item-price"><strong>{price === null ? 'Price TBD' : money(price)}</strong>
          <small>{item.sale !== null ? 'Budgeted amount' : item.regular !== null ? 'High-end fallback' : 'Budget not set'}</small>
          {item.sale !== null && item.regular !== null && <span className="current-reference">High-end {money(item.regular)}</span>}
        </div>
        <button className="icon-button edit-item" disabled={busy} aria-label={'Edit ' + item.name} onClick={() => props.onEdit(item)}><Pencil size={16}/></button>
      </div>
      <div className="item-tags">
        {purchased && <span className="purchased-tag"><Check size={13}/> Purchased</span>}
        <span className={'need-tag ' + item.need}>{item.need === 'now' ? 'Immediate need' : 'Can wait'}</span>
        {!groupView && group && <button className="group-chip" disabled={busy} aria-label={'Manage group ' + group.name} title={group.name} onClick={() => props.onGroup(group)}><span className="group-pill"><Link2 size={13}/><span className="group-name">{group.name}</span></span></button>}
      </div>
      <div className={'purchase-strip ' + (purchased ? 'purchase-complete' : '')}>
        {purchased ? <div className="paid-amount"><span>Actually paid</span><strong>{money(item.purchasePrice!)}</strong></div> : <span className="purchase-prompt">Ready when you are.</span>}
        <button className="text-button purchase-action" disabled={busy} onClick={() => props.onPurchase(item)} aria-label={(purchased ? 'Edit purchase for ' : 'Mark purchased: ') + item.name}>
          {purchased ? <Pencil size={14}/> : <ShoppingBag size={15}/>} {purchased ? 'Edit purchase' : 'Mark purchased'}
        </button>
      </div>
      <div className="item-bottom">
        <div>{item.backups.length ? <button className="text-button backups-link" aria-expanded={expanded === item.id} onClick={() => props.onToggleBackup(item.id)}><Layers size={14}/>{item.backups.length} backup option{item.backups.length === 1 ? '' : 's'}{expanded === item.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button> :
          <button className="text-button faint" disabled={busy} onClick={() => props.onEdit(item)}><Plus size={14}/> Add a backup</button>}</div>
        {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-button purchase-link">View item <ExternalLink size={13}/></a>}
      </div>
      {expanded === item.id && <div className="backup-list">{item.backups.map(option => <div key={option.id} className="backup-option">
        <ItemImage image={option.image} name={option.name} room={item.room}/>
        <div className="backup-info"><strong>{option.name}</strong>
          <p>{effectivePrice(option) === null ? 'Price not set' : money(effectivePrice(option)!)} <span className="backup-price-label">{option.sale !== null ? 'budgeted' : option.regular !== null ? 'high-end estimate' : ''}</span></p>
          {option.sale !== null && option.regular !== null && <p className="current-reference">High-end {money(option.regular)}</p>}
          {option.notes && <p className="backup-note">{option.notes}</p>}
          <div className="actions">{option.url && <a className="text-button" href={option.url} target="_blank" rel="noopener noreferrer">View option <ExternalLink size={12}/></a>}
            <button className="text-button" disabled={busy || purchased} title={purchased ? 'Mark this item as not purchased before changing the main choice.' : undefined} onClick={() => props.onPromote(item, option.id)}>Make main choice</button>
          </div>
        </div>
      </div>)}</div>}
    </article>;
  }
  if (!groupView) return <div className="item-list">{visible.map(renderItem)}</div>;
  const matching = new Set(visible.map(i => i.id));
  const ungrouped = visible.filter(i => !groups.some(g => g.id === i.groupId));
  const shownGroups = sortedGroups(plan).filter(g => !props.filterActive || groupMembers(plan, g.id).some(i => matching.has(i.id)));
  if (!shownGroups.length && !ungrouped.length) return <div className="group-empty-filter">No items match these filters.</div>;
  return <div className="grouped-list">
    {shownGroups.map(group => {
      const members = groupMembers(plan, group.id), filtered = members.filter(i => matching.has(i.id));
      const totals = groupMetrics(members), shown = groupMetrics(filtered), now = members.filter(i => i.need === 'now').length;
      const collapsed = props.collapsed.includes(group.id);
      return <section className="shopping-group" key={group.id} aria-label={group.name}>
        <div className="shopping-group-header">
          <button className="shopping-group-toggle" onClick={() => props.onToggleGroup(group.id)} aria-expanded={!collapsed} aria-controls={'group-' + group.id}>
            <span className="group-mark"><Link2 size={20}/></span><span><strong>{group.name}</strong><small>{members.length} item{members.length === 1 ? '' : 's'} · {now} immediate · {members.length - now} can wait{totals.purchasedCount > 0 && <> · {totals.purchasedCount} purchased</>}</small></span>
            {collapsed ? <ChevronDown size={17}/> : <ChevronUp size={17}/>}
          </button>
          <div className="shopping-group-actions"><div className="group-price"><small>Full group budgeted</small><strong>{money(totals.budgeted)}</strong>
            {totals.unknown > 0 ? <small>{totals.unknown} price{totals.unknown === 1 ? '' : 's'} missing</small> : totals.usingCurrent > 0 ? <small>{totals.usingCurrent} high-end fallback{totals.usingCurrent === 1 ? '' : 's'}</small> : <small>{money(totals.savings)} planning cushion</small>}
          </div><button className="button secondary" disabled={busy} onClick={() => props.onGroup(group)}>Manage</button></div>
        </div>
        <div id={'group-' + group.id} hidden={collapsed}>
          {group.notes && <p className="group-note"><Info size={14}/><span>{group.notes}</span></p>}
          {props.filterActive && <div className="group-filter-note"><span>{filtered.length} of {members.length} items · {money(shown.budgeted)} shown{shown.unknown ? ' · incomplete' : ''}</span><button className="text-button" onClick={props.onClearFilter}>View all</button></div>}
          <div className="group-items">{filtered.length ? filtered.map(renderItem) : <p className="empty-group">Add the things that belong together.</p>}</div>
          <div className="group-footer"><button className="text-button" disabled={busy} onClick={() => props.onGroup(group)}><Link2 size={14}/> Link existing items</button>
            <button className="text-button" disabled={busy || plan.items.length >= 300} onClick={() => props.onAddToGroup(group.id)}><Plus size={15}/> Add new item</button>
          </div>
        </div>
      </section>;
    })}
    {ungrouped.length > 0 && <section className="ungrouped-list"><h3>Ungrouped <span className="count">{ungrouped.length}</span></h3><div className="item-list">{ungrouped.map(renderItem)}</div></section>}
  </div>;
}
