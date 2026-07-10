// Core data model for the Kanban board application.
// All persisted data is plain JSON so it is easy to edit, extend and migrate.

/** A board-level label that cards can reference by id (Trello-style). */
export interface Label {
  id: string;
  /** Optional display name; an empty name renders as a color-only label. */
  name: string;
  /** Label color (hex). */
  color: string;
}

/** A single checklist entry on a card. */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** A named checklist; a card can carry several (Trello-style). */
export interface Checklist {
  id: string;
  name: string;
  items: ChecklistItem[];
}

/** A comment left on a card (newest first). */
export interface Comment {
  id: string;
  text: string;
  createdAt: number;
}

/** An image attached to a card, stored inline as a data URL (offline-safe). */
export interface Attachment {
  id: string;
  /** Original file name, shown in the attachment list. */
  name: string;
  /** The image content as a base64 data URL. */
  dataUrl: string;
  createdAt: number;
}

/** A single card belonging to a column. */
export interface Card {
  id: string;
  text: string;
  /** Free-form details shown on the card's back (detail modal). */
  description: string;
  /** Ids of the board labels applied to this card. */
  labelIds: string[];
  /** Checklists (each with its own items) shown on the card's back. */
  checklists: Checklist[];
  /** Whether the checklists are expanded inline on the card's front. */
  checklistsOpen: boolean;
  /** Comments (newest first) shown on the card's back. */
  comments: Comment[];
  /** Image attachments; the first one doubles as the card's cover. */
  attachments: Attachment[];
  /** Start date as a timestamp (ms), or null when none is set. */
  startAt: number | null;
  /** Due date as a timestamp (ms), or null when none is set. */
  dueAt: number | null;
  /** Whether the due date has been marked complete. */
  dueDone: boolean;
  /** Optional accent color (hex). Empty means default. */
  color: string;
  /** Template cards stay in their list as blueprints for new cards. */
  isTemplate: boolean;
  createdAt: number;
}

/** A column (list) holding an ordered set of cards. */
export interface Column {
  id: string;
  title: string;
  cards: Card[];
}

/** A card removed from the board but kept for later restore or permanent delete. */
export interface ArchivedCard {
  card: Card;
  /** Id of the column the card was archived from (the restore target). */
  columnId: string;
  archivedAt: number;
}

/** A whole list (column) removed from the board but kept for restore/delete. */
export interface ArchivedColumn {
  column: Column;
  /** Original position, used as a hint when restoring. */
  index: number;
  archivedAt: number;
}

/**
 * One entry in a board's activity log. `kind` is an i18n key whose template is
 * filled with `params`, so entries render in whichever language is active.
 */
export interface ActivityEntry {
  id: string;
  kind: string;
  params: string[];
  createdAt: number;
}

/** A board (workspace) containing ordered columns and a shared label set. */
export interface Board {
  id: string;
  name: string;
  columns: Column[];
  /** Labels defined on this board and shared by all its cards. */
  labels: Label[];
  /** Archived cards (newest first), restorable from the archive view. */
  archived: ArchivedCard[];
  /** Archived lists/columns (newest first), restorable from the archive view. */
  archivedColumns: ArchivedColumn[];
  /** Board background color (hex). Empty means the default theme color. */
  background: string;
  /** Starred boards are listed before the others in the board selector. */
  starred: boolean;
  /** Recent activity (newest first), capped at ACTIVITY_LIMIT entries. */
  activity: ActivityEntry[];
  createdAt: number;
  updatedAt: number;
}

export type Language = 'ko' | 'en';

/** Color theme: follow the OS ('auto') or force light/dark. */
export type Theme = 'auto' | 'light' | 'dark';

/** User settings persisted alongside the boards. */
export interface Settings {
  lang: Language;
  zoom: number;
  theme: Theme;
  /** Calendar view: whether cards with a completed due date are hidden. */
  calendarHideDone: boolean;
}

/** The whole application state, serialized as one JSON document. */
export interface AppData {
  /** Schema version, used for future migrations. */
  version: number;
  boards: Board[];
  activeBoardId: string | null;
  settings: Settings;
}

/** Current schema version of {@link AppData}. v2: multiple checklists. */
export const SCHEMA_VERSION = 2;
