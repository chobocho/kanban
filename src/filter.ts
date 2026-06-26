// Pure card filtering logic. Kept free of DOM/storage so it can be unit tested
// and reused by the renderer. A filter combines a keyword, a set of labels and
// a due-date condition; a card must satisfy all active parts to match.

import { Card } from './types.js';

/** Due-date conditions offered by the filter. */
export type DueFilter = 'all' | 'has' | 'overdue' | 'soon' | 'done' | 'none';

/** The current filter state. Empty parts impose no constraint. */
export interface FilterState {
  query: string;
  /** Labels to match; a card matches if it has ANY of them (OR). */
  labelIds: string[];
  due: DueFilter;
}

/** A "due soon" card is due within this window from now (24h). */
const DUE_SOON_MS = 24 * 60 * 60 * 1000;

/** A filter that matches every card. */
export function emptyFilter(): FilterState {
  return { query: '', labelIds: [], due: 'all' };
}

/** Whether the filter constrains anything (used to toggle filtered mode). */
export function isFilterActive(f: FilterState): boolean {
  return f.query.trim() !== '' || f.labelIds.length > 0 || f.due !== 'all';
}

/** True when `card` satisfies every active part of the filter. */
export function cardMatchesFilter(card: Card, f: FilterState, now: number): boolean {
  const query = f.query.trim().toLowerCase();
  if (query) {
    const haystack = `${card.text}\n${card.description}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (f.labelIds.length > 0 && !f.labelIds.some((id) => card.labelIds.includes(id))) {
    return false;
  }

  switch (f.due) {
    case 'has':
      return card.dueAt != null;
    case 'none':
      return card.dueAt == null;
    case 'done':
      return card.dueDone;
    case 'overdue':
      return card.dueAt != null && !card.dueDone && card.dueAt < now;
    case 'soon':
      return (
        card.dueAt != null &&
        !card.dueDone &&
        card.dueAt >= now &&
        card.dueAt - now < DUE_SOON_MS
      );
    case 'all':
    default:
      return true;
  }
}
