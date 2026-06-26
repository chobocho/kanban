// Core data model for the Kanban board application.
// All persisted data is plain JSON so it is easy to edit, extend and migrate.

/** A single card belonging to a column. */
export interface Card {
  id: string;
  text: string;
  /** Free-form details shown on the card's back (detail modal). */
  description: string;
  /** Optional accent color (hex). Empty means default. */
  color: string;
  createdAt: number;
}

/** A column (list) holding an ordered set of cards. */
export interface Column {
  id: string;
  title: string;
  cards: Card[];
}

/** A board (workspace) containing ordered columns. */
export interface Board {
  id: string;
  name: string;
  columns: Column[];
  createdAt: number;
  updatedAt: number;
}

export type Language = 'ko' | 'en';

/** User settings persisted alongside the boards. */
export interface Settings {
  lang: Language;
  zoom: number;
}

/** The whole application state, serialized as one JSON document. */
export interface AppData {
  /** Schema version, used for future migrations. */
  version: number;
  boards: Board[];
  activeBoardId: string | null;
  settings: Settings;
}

/** Current schema version of {@link AppData}. */
export const SCHEMA_VERSION = 1;
