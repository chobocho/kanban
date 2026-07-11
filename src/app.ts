// Application controller. Owns the in-memory state, persists every change to
// IndexedDB (so work resumes across sessions), and wires the renderer, drag and
// drop, zoom, JSON import/export and PNG export together. No global variables
// are used; all state lives on the instance.

import { AppData, Board, Column, Language, Theme } from './types.js';
import { loadData, saveData } from './store.js';
import {
  createBoard,
  createColumn,
  getActiveBoard,
  findColumn,
  findCard,
  snapshotColumns,
  addColumn,
  renameColumn,
  moveColumn,
  sortColumnCards,
  duplicateColumn,
  moveAllCards,
  addCardsFromText,
  importBoard,
  duplicateBoard,
  addCard,
  updateCard,
  moveCard,
  addLabel,
  updateLabel,
  removeLabel,
  toggleCardLabel,
  LABEL_COLORS,
  addChecklist,
  renameChecklist,
  removeChecklist,
  addChecklistItem,
  updateChecklistItem,
  toggleChecklistItem,
  removeChecklistItem,
  moveChecklistItem,
  addComment,
  updateComment,
  removeComment,
  addAttachment,
  removeAttachment,
  duplicateCard,
  createCardFromTemplate,
  archiveCard,
  restoreCard,
  deleteArchivedCard,
  archiveColumn,
  restoreColumn,
  deleteArchivedColumn,
  setBoardBackground,
  BOARD_BACKGROUNDS,
  toggleBoardStar,
  sortedBoards,
  logActivity,
  touch,
} from './model.js';
import { History } from './history.js';
import { setLanguage, t, tf } from './i18n.js';
import { FilterState, DueFilter, emptyFilter, isFilterActive } from './filter.js';
import { renderBoard, RenderHandlers, CARD_COLORS } from './render.js';
import { DragController } from './dnd.js';
import { KeyboardNavigator } from './keys.js';
import { ZoomController } from './zoom.js';
import { LayoutController } from './layout.js';
import { downloadJson, readJsonFile, downloadBoardJson, readBoardJsonFile } from './jsonio.js';
import { exportBoardPng } from './png.js';
import { openCalendar } from './calendar.js';
import {
  customAlert,
  customConfirm,
  customPrompt,
  customTextPrompt,
  openCardDetail,
  openArchive,
  openColorPicker,
  openActivityLog,
} from './modal.js';

/** Maximum number of undo steps kept per board. */
const MAX_HISTORY = 8;

/** Default due time (local hour) for cards created from a calendar day. */
const CALENDAR_DUE_HOUR = 9;

/** Shorten a card/list title for a compact activity-log line. */
function snip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

/** Darken a #rrggbb color by the given factor (0..1) for the toolbar shade. */
function darken(hex: string, factor: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const num = parseInt(match[1], 16);
  const scale = (v: number): number => Math.round(v * factor);
  const r = scale((num >> 16) & 0xff);
  const g = scale((num >> 8) & 0xff);
  const b = scale(num & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export class KanbanApp {
  private data!: AppData;
  private zoom!: ZoomController;
  private saveTimer = 0;

  // Undo/redo of the active board's content (columns + cards). `baseline` holds
  // a clone of the last committed state so a change can be recorded *before* it
  // is overwritten by the next mutation.
  private readonly history = new History<Column[]>(MAX_HISTORY);
  private baseline: Column[] = [];

  /** Current search/label/due filter (in-memory, not persisted). */
  private filter: FilterState = emptyFilter();

  private readonly columnsEl: HTMLElement;
  private readonly surfaceEl: HTMLElement;
  private readonly boardSelect: HTMLSelectElement;
  private readonly starBtn: HTMLButtonElement;
  private readonly langSelect: HTMLSelectElement;
  private readonly themeSelect: HTMLSelectElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly filterInput: HTMLInputElement;
  private readonly filterBtn: HTMLButtonElement;
  private readonly filterClearBtn: HTMLButtonElement;
  private readonly filterPanel: HTMLElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly menuPanel: HTMLElement;

  constructor(private readonly doc: Document) {
    this.columnsEl = this.byId('columns');
    this.surfaceEl = this.byId('boardSurface');
    this.boardSelect = this.byId('boardSelect') as HTMLSelectElement;
    this.starBtn = this.byId('starBtn') as HTMLButtonElement;
    this.langSelect = this.byId('langSelect') as HTMLSelectElement;
    this.themeSelect = this.byId('themeSelect') as HTMLSelectElement;
    this.undoBtn = this.byId('undoBtn') as HTMLButtonElement;
    this.redoBtn = this.byId('redoBtn') as HTMLButtonElement;
    this.filterInput = this.byId('filterInput') as HTMLInputElement;
    this.filterBtn = this.byId('filterBtn') as HTMLButtonElement;
    this.filterClearBtn = this.byId('filterClearBtn') as HTMLButtonElement;
    this.filterPanel = this.byId('filterPanel');
    this.menuBtn = this.byId('menuBtn') as HTMLButtonElement;
    this.menuPanel = this.byId('menuPanel');
  }

  private byId(id: string): HTMLElement {
    const node = this.doc.getElementById(id);
    if (!node) throw new Error(`missing element #${id}`);
    return node;
  }

  /** Load persisted state and start the app. */
  async start(): Promise<void> {
    this.data = await loadData();
    setLanguage(this.data.settings.lang);
    this.applyTheme();
    // In "auto" the theme tracks the OS preference live.
    this.doc.defaultView
      ?.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (this.data.settings.theme === 'auto') this.applyTheme();
      });

    const surface = this.surfaceEl;
    const scale = this.byId('boardScale');
    this.zoom = new ZoomController(scale, surface, (value) => {
      this.data.settings.zoom = value;
      this.persist();
    });
    this.zoom.setScale(this.data.settings.zoom);

    // Keep column heights tied to the real visible area so the board reflows
    // cleanly when a foldable opens/closes or the device rotates.
    const view = this.doc.defaultView;
    if (view) new LayoutController(surface, this.columnsEl, view);

    new DragController(this.columnsEl, {
      moveCard: (from, cardId, to, index) => this.moveCardLogged(from, cardId, to, index),
      moveColumn: (from, to) => {
        const board = this.active();
        if (board && moveColumn(board, from, to)) this.commit();
      },
      // Reordering while filtered would map visible positions onto the full
      // list incorrectly, so drag is suspended whenever a filter is active.
      isBlocked: () => this.zoom.isPinching() || isFilterActive(this.filter),
    });

    new KeyboardNavigator(this.columnsEl, (colId, cardId) =>
      this.handlers.openCard(colId, cardId),
    );

    this.wireToolbar();
    this.resetHistory();

    // Flush any pending debounced save before the page is hidden/closed so that
    // work always resumes exactly where the user left off.
    view?.addEventListener('pagehide', () => this.flush());
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'hidden') this.flush();
    });

    // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo.
    this.doc.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Dismiss the filter/overflow popovers when clicking outside of them.
    this.doc.addEventListener('pointerdown', (e) => this.closePanelsOnOutside(e), true);

    this.render();
  }

  /** Close a popover when a pointer goes down outside it and its toggle button. */
  private closePanelsOnOutside(e: Event): void {
    const target = e.target as Node;
    if (
      !this.filterPanel.hidden &&
      !this.filterPanel.contains(target) &&
      !this.filterBtn.contains(target)
    ) {
      this.filterPanel.hidden = true;
    }
    if (
      !this.menuPanel.hidden &&
      !this.menuPanel.contains(target) &&
      !this.menuBtn.contains(target)
    ) {
      this.menuPanel.hidden = true;
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    // Leave native text editing (inline card/list edit, modal inputs) alone.
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      this.redo();
    }
  }

  /** Immediately persist, cancelling any pending debounced save. */
  private flush(): void {
    const view = this.doc.defaultView;
    if (view && this.saveTimer) {
      view.clearTimeout(this.saveTimer);
      this.saveTimer = 0;
    }
    void saveData(this.data);
  }

  private active(): Board | undefined {
    return getActiveBoard(this.data);
  }

  /** Move a card (drag or dialog) and record cross-list moves as activity. */
  private moveCardLogged(from: string, cardId: string, to: string, index: number): void {
    const board = this.active();
    if (!board) return;
    const fromCol = findColumn(board, from);
    const toCol = findColumn(board, to);
    const card = findCard(board, from, cardId);
    if (!moveCard(board, from, cardId, to, index)) return;
    // Reorders within a list are not activity; cross-list moves are.
    if (from !== to && card && fromCol && toCol) {
      logActivity(board, 'activityCardMove', [
        snip(card.text),
        snip(fromCol.title),
        snip(toCol.title),
      ]);
    }
    this.commit();
  }

  private get handlers(): RenderHandlers {
    return {
      addCard: (colId) => {
        const board = this.active();
        if (!board) return;
        const column = findColumn(board, colId);
        const card = addCard(board, colId, t('newCardText'));
        if (!card) return;
        if (column) logActivity(board, 'activityCardAdd', [snip(card.text), snip(column.title)]);
        this.commit();
      },
      editCard: (colId, cardId, text) => {
        const board = this.active();
        if (board && updateCard(board, colId, cardId, { text })) this.commit();
      },
      archiveCard: (colId, cardId) => {
        const board = this.active();
        if (!board) return;
        const card = findCard(board, colId, cardId);
        if (archiveCard(board, colId, cardId)) {
          if (card) logActivity(board, 'activityCardArchive', [snip(card.text)]);
          this.commitArchive();
        }
      },
      cycleCardColor: (colId, cardId) => {
        const board = this.active();
        if (!board) return;
        const card = findCard(board, colId, cardId);
        if (!card) return;
        const next = CARD_COLORS[(CARD_COLORS.indexOf(card.color) + 1) % CARD_COLORS.length];
        if (updateCard(board, colId, cardId, { color: next })) this.commit();
      },
      toggleCardChecklists: (colId, cardId) => {
        const board = this.active();
        if (!board) return;
        const card = findCard(board, colId, cardId);
        if (!card) return;
        if (updateCard(board, colId, cardId, { checklistsOpen: !card.checklistsOpen })) {
          this.commit();
        }
      },
      toggleChecklistItem: (colId, cardId, checklistId, itemId) => {
        const board = this.active();
        if (board && toggleChecklistItem(board, colId, cardId, checklistId, itemId)) {
          this.commit();
        }
      },
      openCard: (colId, cardId) => {
        const board = this.active();
        if (!board) return;
        const card = findCard(board, colId, cardId);
        if (!card) return;
        void openCardDetail(
          {
            text: card.text,
            description: card.description,
            color: card.color,
            createdAt: card.createdAt,
            startAt: card.startAt,
            dueAt: card.dueAt,
            dueDone: card.dueDone,
            colors: CARD_COLORS,
            labels: board.labels,
            labelColors: LABEL_COLORS,
            assignedLabelIds: card.labelIds.slice(),
            checklists: card.checklists,
            comments: card.comments,
            attachments: card.attachments,
            isTemplate: card.isTemplate,
            columnId: colId,
            columns: board.columns.map((c) => ({
              id: c.id,
              title: c.title,
              cardCount: c.cards.length,
            })),
            openSections: this.data.settings.cardOpenSections,
          },
          {
            onSave: (patch) => {
              if (updateCard(board, colId, cardId, patch)) this.commit();
            },
            onArchive: () => {
              if (archiveCard(board, colId, cardId)) {
                logActivity(board, 'activityCardArchive', [snip(card.text)]);
                this.commitArchive();
              }
            },
            onToggleLabel: (labelId) => {
              if (toggleCardLabel(board, colId, cardId, labelId)) this.commit();
            },
            onRenameLabel: (labelId, name) => {
              if (updateLabel(board, labelId, { name })) this.commit();
            },
            onRecolorLabel: (labelId, color) => {
              if (updateLabel(board, labelId, { color })) this.commit();
            },
            onAddLabel: (name, labelColor) => {
              addLabel(board, name, labelColor);
              this.commit();
            },
            onRemoveLabel: (labelId) => {
              if (removeLabel(board, labelId)) this.commit();
            },
            onAddChecklist: (name) => {
              if (addChecklist(board, colId, cardId, name)) this.commit();
            },
            onRenameChecklist: (checklistId, name) => {
              if (renameChecklist(board, colId, cardId, checklistId, name)) this.commit();
            },
            onRemoveChecklist: (checklistId) => {
              if (removeChecklist(board, colId, cardId, checklistId)) this.commit();
            },
            onAddChecklistItem: (checklistId, text) => {
              if (addChecklistItem(board, colId, cardId, checklistId, text)) this.commit();
            },
            onToggleChecklistItem: (checklistId, itemId) => {
              if (toggleChecklistItem(board, colId, cardId, checklistId, itemId)) this.commit();
            },
            onRenameChecklistItem: (checklistId, itemId, text) => {
              if (updateChecklistItem(board, colId, cardId, checklistId, itemId, { text })) {
                this.commit();
              }
            },
            onRemoveChecklistItem: (checklistId, itemId) => {
              if (removeChecklistItem(board, colId, cardId, checklistId, itemId)) this.commit();
            },
            onMoveChecklistItem: (checklistId, itemId, direction) => {
              if (moveChecklistItem(board, colId, cardId, checklistId, itemId, direction)) {
                this.commit();
              }
            },
            onAddAttachment: (name, dataUrl) => {
              if (addAttachment(board, colId, cardId, name, dataUrl)) this.commit();
            },
            onRemoveAttachment: (attachmentId) => {
              if (removeAttachment(board, colId, cardId, attachmentId)) this.commit();
            },
            onAddComment: (text) => {
              if (addComment(board, colId, cardId, text)) this.commit();
            },
            onEditComment: (commentId, text) => {
              if (updateComment(board, colId, cardId, commentId, text)) this.commit();
            },
            onRemoveComment: (commentId) => {
              if (removeComment(board, colId, cardId, commentId)) this.commit();
            },
            onCopy: () => {
              if (duplicateCard(board, colId, cardId)) {
                logActivity(board, 'activityCardCopy', [snip(card.text)]);
                this.commit();
              }
            },
            onMove: (toColumnId, toIndex) => {
              this.moveCardLogged(colId, cardId, toColumnId, toIndex);
            },
            onToggleTemplate: () => {
              if (updateCard(board, colId, cardId, { isTemplate: !card.isTemplate })) {
                this.commit();
              }
            },
            onCreateFromTemplate: () => {
              if (createCardFromTemplate(board, colId, cardId)) {
                logActivity(board, 'activityCardCopy', [snip(card.text)]);
                this.commit();
              }
            },
            onToggleSection: (key, open) => {
              const keys = new Set(this.data.settings.cardOpenSections);
              if (open) keys.add(key);
              else keys.delete(key);
              this.data.settings.cardOpenSections = [...keys];
              this.persist(); // a view setting: no board re-render, no undo step
            },
          },
        );
      },
      addColumn: () => {
        const board = this.active();
        if (!board) return;
        const column = addColumn(board, t('newColumnTitle'));
        logActivity(board, 'activityListAdd', [snip(column.title)]);
        this.commit();
      },
      renameColumn: (colId, title) => {
        const board = this.active();
        if (board && renameColumn(board, colId, title)) this.commit();
      },
      archiveColumn: (colId) => {
        const board = this.active();
        if (!board) return;
        const column = findColumn(board, colId);
        if (archiveColumn(board, colId)) {
          if (column) logActivity(board, 'activityListArchive', [snip(column.title)]);
          this.commitArchive();
        }
      },
      sortColumn: (colId, by) => {
        const board = this.active();
        if (!board) return;
        const column = findColumn(board, colId);
        if (sortColumnCards(board, colId, by)) {
          if (column) logActivity(board, 'activitySort', [snip(column.title)]);
          this.commit();
        }
      },
      copyColumn: (colId) => {
        const board = this.active();
        if (!board) return;
        const column = findColumn(board, colId);
        if (duplicateColumn(board, colId)) {
          if (column) logActivity(board, 'activityListCopy', [snip(column.title)]);
          this.commit();
        }
      },
      addCardsBulk: (colId) => {
        const board = this.active();
        const column = board ? findColumn(board, colId) : undefined;
        if (!board || !column) return;
        void customTextPrompt(t('addCardsBulkPrompt')).then((text) => {
          if (text === null) return;
          const made = addCardsFromText(board, colId, text);
          if (made.length === 0) return;
          logActivity(board, 'activityBulkAdd', [String(made.length), snip(column.title)]);
          this.commit();
        });
      },
      moveAllCards: (fromColId, toColId) => {
        const board = this.active();
        if (!board) return;
        const fromCol = findColumn(board, fromColId);
        const toCol = findColumn(board, toColId);
        if (moveAllCards(board, fromColId, toColId)) {
          if (fromCol && toCol) {
            logActivity(board, 'activityMoveAll', [snip(fromCol.title), snip(toCol.title)]);
          }
          this.commit();
        }
      },
    };
  }

  private wireToolbar(): void {
    this.byId('newBoardBtn').addEventListener('click', () => this.newBoard());
    this.byId('renameBoardBtn').addEventListener('click', () => this.renameBoard());
    this.byId('copyBoardBtn').addEventListener('click', () => this.copyBoard());
    this.byId('deleteBoardBtn').addEventListener('click', () => this.deleteBoard());
    this.byId('archiveBtn').addEventListener('click', () => this.openArchiveView());
    this.byId('bgColorBtn').addEventListener('click', () => this.pickBackground());
    this.byId('activityBtn').addEventListener('click', () => {
      const board = this.active();
      if (!board) return;
      void openActivityLog(
        board.activity.map((e) => ({ text: tf(e.kind, e.params), when: e.createdAt })),
      );
    });
    this.boardSelect.addEventListener('change', () => {
      this.data.activeBoardId = this.boardSelect.value;
      this.commitReset();
    });
    this.starBtn.addEventListener('click', () => {
      const board = this.active();
      if (!board) return;
      toggleBoardStar(board);
      // Stars are board metadata, outside the undo scope (cards/lists).
      this.refresh();
    });

    this.langSelect.addEventListener('change', () => {
      this.setLang(this.langSelect.value as Language);
      this.menuPanel.hidden = true;
    });

    this.themeSelect.addEventListener('change', () => {
      this.data.settings.theme = this.themeSelect.value as Theme;
      this.applyTheme();
      this.menuPanel.hidden = true;
      // A setting, not board content, so the undo history is preserved.
      this.refresh();
    });

    // Overflow menu: toggle, and close after an action is chosen.
    this.menuBtn.addEventListener('click', () => {
      this.menuPanel.hidden = !this.menuPanel.hidden;
    });
    this.menuPanel.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, label')) this.menuPanel.hidden = true;
    });

    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    this.byId('calendarBtn').addEventListener('click', () => this.openCalendarView());

    this.filterInput.addEventListener('input', () => {
      this.filter.query = this.filterInput.value;
      this.render();
    });
    this.filterBtn.addEventListener('click', () => {
      this.filterPanel.hidden = !this.filterPanel.hidden;
      if (!this.filterPanel.hidden) this.refreshFilterPanel();
    });
    this.filterClearBtn.addEventListener('click', () => this.clearFilter());

    this.byId('zoomInBtn').addEventListener('click', () => this.zoom.zoomIn());
    this.byId('zoomOutBtn').addEventListener('click', () => this.zoom.zoomOut());
    this.byId('zoomResetBtn').addEventListener('click', () => this.zoom.reset());

    this.byId('exportJsonBtn').addEventListener('click', () => downloadJson(this.data));
    this.byId('exportPngBtn').addEventListener('click', () => {
      const board = this.active();
      if (board) exportBoardPng(board);
    });

    this.byId('exportBoardBtn').addEventListener('click', () => {
      const board = this.active();
      if (board) downloadBoardJson(board);
    });

    const importBoardInput = this.byId('importBoardInput') as HTMLInputElement;
    importBoardInput.addEventListener('change', async () => {
      const file = importBoardInput.files?.[0];
      if (!file) return;
      try {
        importBoard(this.data, await readBoardJsonFile(file));
        this.commitReset();
      } catch {
        void customAlert(t('importError'));
      } finally {
        importBoardInput.value = '';
      }
    });

    const importInput = this.byId('importJsonInput') as HTMLInputElement;
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        this.data = await readJsonFile(file);
        setLanguage(this.data.settings.lang);
        this.zoom.setScale(this.data.settings.zoom);
        this.commitReset();
      } catch {
        void customAlert(t('importError'));
      } finally {
        importInput.value = '';
      }
    });
  }

  private async newBoard(): Promise<void> {
    const name = await customPrompt(t('boardNamePrompt'), t('newBoard'));
    if (name === null) return;
    const board = createBoard(name || t('newBoard'), [
      createColumn('To Do'),
      createColumn('In Progress'),
      createColumn('Done'),
    ]);
    this.data.boards.push(board);
    this.data.activeBoardId = board.id;
    this.commitReset();
  }

  private async renameBoard(): Promise<void> {
    const board = this.active();
    if (!board) return;
    const name = await customPrompt(t('boardNamePrompt'), board.name);
    if (name === null) return;
    board.name = name || board.name;
    // Board name is outside undo scope (cards/lists), so keep the history.
    this.refresh();
  }

  private async copyBoard(): Promise<void> {
    const board = this.active();
    if (!board) return;
    const name = await customPrompt(t('boardNamePrompt'), tf('copyOfName', [board.name]));
    if (name === null) return;
    if (duplicateBoard(this.data, board.id, name || board.name)) this.commitReset();
  }

  private async deleteBoard(): Promise<void> {
    const board = this.active();
    if (!board) return;
    if (!(await customConfirm(t('deleteBoardConfirm')))) return;
    this.data.boards = this.data.boards.filter((b) => b.id !== board.id);
    if (this.data.boards.length === 0) {
      const fresh = createBoard('My Board', [
        createColumn('To Do'),
        createColumn('In Progress'),
        createColumn('Done'),
      ]);
      this.data.boards.push(fresh);
    }
    this.data.activeBoardId = this.data.boards[0].id;
    this.commitReset();
  }

  /** Let the user pick the board's background from the Trello-like palette. */
  private async pickBackground(): Promise<void> {
    const board = this.active();
    if (!board) return;
    const color = await openColorPicker(t('backgroundPrompt'), BOARD_BACKGROUNDS, board.background);
    if (color === null) return;
    // Background is board decoration, outside the undo scope (cards/lists).
    if (setBoardBackground(board, color)) this.refresh();
  }

  /** Resolve the theme setting ('auto' follows the OS) onto the html element. */
  private applyTheme(): void {
    const setting = this.data.settings.theme;
    const prefersDark =
      this.doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches ?? false;
    const resolved = setting === 'auto' ? (prefersDark ? 'dark' : 'light') : setting;
    this.doc.documentElement.dataset.theme = resolved;
  }

  /** Apply the active board's background to the page theme variables. */
  private applyBackground(): void {
    const rootStyle = this.doc.documentElement.style;
    const background = this.active()?.background ?? '';
    if (background) {
      rootStyle.setProperty('--bg', background);
      rootStyle.setProperty('--toolbar-bg', darken(background, 0.85));
    } else {
      rootStyle.removeProperty('--bg');
      rootStyle.removeProperty('--toolbar-bg');
    }
  }

  private setLang(lang: Language): void {
    this.data.settings.lang = lang;
    setLanguage(lang);
    this.doc.documentElement.lang = lang;
    // Language is a setting, not board content, so the history is preserved.
    this.refresh();
  }

  /** Forget undo/redo history and re-baseline on the active board. */
  private resetHistory(): void {
    this.history.clear();
    const board = this.active();
    this.baseline = board ? snapshotColumns(board.columns) : [];
    this.updateHistoryButtons();
  }

  private updateHistoryButtons(): void {
    this.undoBtn.disabled = !this.history.canUndo();
    this.redoBtn.disabled = !this.history.canRedo();
  }

  /** Revert the active board's content to the previous state. */
  private undo(): void {
    const board = this.active();
    if (!board) return;
    const previous = this.history.undo(snapshotColumns(board.columns));
    if (!previous) return;
    board.columns = snapshotColumns(previous);
    this.baseline = snapshotColumns(previous);
    touch(board);
    this.persist();
    this.render();
  }

  /** Re-apply the most recently undone change. */
  private redo(): void {
    const board = this.active();
    if (!board) return;
    const next = this.history.redo(snapshotColumns(board.columns));
    if (!next) return;
    board.columns = snapshotColumns(next);
    this.baseline = snapshotColumns(next);
    touch(board);
    this.persist();
    this.render();
  }

  /** Apply a board-content change: record an undo step, persist and re-render. */
  private commit(): void {
    const board = this.active();
    if (board) {
      this.history.record(this.baseline);
      this.baseline = snapshotColumns(board.columns);
    }
    this.persist();
    this.render();
  }

  /** Persist and re-render without touching the undo history. */
  private refresh(): void {
    this.persist();
    this.render();
  }

  /**
   * Apply an archive/restore/purge change. These move cards between the board
   * and the board-level archive, which the undo history (columns only) does not
   * track, so the history is reset to keep undo from producing duplicates.
   */
  private commitArchive(): void {
    this.resetHistory();
    this.persist();
    this.render();
  }

  /**
   * Open the all-boards calendar. Picking a card switches to its board (when it
   * is not the active one) and opens the card's detail view; picking an empty
   * day creates a card due that day.
   */
  private openCalendarView(): void {
    void openCalendar(sortedBoards(this.data), this.data.settings.calendarHideDone, {
      onOpenCard: (boardId, columnId, cardId) => {
        if (this.data.activeBoardId !== boardId) {
          this.data.activeBoardId = boardId;
          this.commitReset();
        }
        this.handlers.openCard(columnId, cardId);
      },
      onAddCard: (dayTs, text) => this.addCardFromCalendar(dayTs, text),
      onMoveCard: (boardId, columnId, cardId, patch) =>
        this.moveCardDates(boardId, columnId, cardId, patch),
      onToggleHideDone: (hidden) => {
        this.data.settings.calendarHideDone = hidden;
        this.persist(); // a view setting: no board re-render, no undo step
      },
    });
  }

  /** Apply a calendar drag-and-drop date change to a card on any board. */
  private moveCardDates(
    boardId: string,
    columnId: string,
    cardId: string,
    patch: { startAt?: number; dueAt?: number },
  ): void {
    const board = this.data.boards.find((b) => b.id === boardId);
    if (!board || !updateCard(board, columnId, cardId, patch)) return;
    // Undo history only tracks the active board's columns; a change on another
    // board is persisted without recording a bogus undo step.
    if (board.id === this.data.activeBoardId) this.commit();
    else this.refresh();
  }

  /** Create a card in the active board's first list, due on the picked day. */
  private addCardFromCalendar(dayTs: number, text: string): void {
    const board = this.active();
    if (!board) return;
    // An empty board gets a fresh list so the calendar add always lands somewhere.
    const column = board.columns[0] ?? addColumn(board, t('newColumnTitle'));
    const card = addCard(board, column.id, text);
    if (!card) return;
    const due = new Date(dayTs);
    due.setHours(CALENDAR_DUE_HOUR, 0, 0, 0);
    updateCard(board, column.id, card.id, { dueAt: due.getTime() });
    logActivity(board, 'activityCardAdd', [snip(card.text), snip(column.title)]);
    this.commit();
  }

  /** Open the archive view, wiring restore/permanent-delete back to the model. */
  private openArchiveView(): void {
    if (!this.active()) return;
    void openArchive({
      listColumns: () => {
        const board = this.active();
        if (!board) return [];
        return board.archivedColumns.map((entry) => ({
          id: entry.column.id,
          text: entry.column.title,
          subtitle: `${entry.column.cards.length} ${t('cardsUnit')}`,
        }));
      },
      listCards: () => {
        const board = this.active();
        if (!board) return [];
        return board.archived.map((entry) => ({
          id: entry.card.id,
          text: entry.card.text,
          subtitle: board.columns.find((c) => c.id === entry.columnId)?.title ?? '',
        }));
      },
      onRestoreColumn: (id) => {
        const board = this.active();
        if (!board) return;
        const entry = board.archivedColumns.find((a) => a.column.id === id);
        if (restoreColumn(board, id)) {
          if (entry) logActivity(board, 'activityListRestore', [snip(entry.column.title)]);
          this.commitArchive();
        }
      },
      onDeleteColumnForever: (id) => {
        const board = this.active();
        if (board && deleteArchivedColumn(board, id)) this.commitArchive();
      },
      onRestoreCard: (id) => {
        const board = this.active();
        if (!board) return;
        const entry = board.archived.find((a) => a.card.id === id);
        if (restoreCard(board, id)) {
          if (entry) logActivity(board, 'activityCardRestore', [snip(entry.card.text)]);
          this.commitArchive();
        }
      },
      onDeleteCardForever: (id) => {
        const board = this.active();
        if (board && deleteArchivedCard(board, id)) this.commitArchive();
      },
    });
  }

  /** Persist, re-render and reset the undo history (board switched/replaced). */
  private commitReset(): void {
    // A filter's label ids belong to the previous board, so start clean.
    this.filter = emptyFilter();
    this.filterInput.value = '';
    this.filterPanel.hidden = true;
    this.resetHistory();
    this.persist();
    this.render();
  }

  /** Debounced save so rapid edits do not thrash IndexedDB. */
  private persist(): void {
    const view = this.doc.defaultView;
    if (!view) return;
    if (this.saveTimer) view.clearTimeout(this.saveTimer);
    this.saveTimer = view.setTimeout(() => {
      void saveData(this.data);
    }, 200);
  }

  private render(): void {
    const board = this.active();
    // Rebuilding the board clears the DOM, which resets the surface scroll to 0
    // and snaps the view back to the first list. Capture and restore the scroll
    // offset so an edit keeps the list the user was working on in view.
    const { scrollLeft, scrollTop } = this.surfaceEl;
    if (board) renderBoard(this.columnsEl, board, this.filter, this.handlers);
    this.surfaceEl.scrollLeft = scrollLeft;
    this.surfaceEl.scrollTop = scrollTop;
    this.applyBackground();
    this.refreshBoardSelect();
    this.refreshLabels();
    this.refreshFilterUi();
    this.updateHistoryButtons();
  }

  /** Reset every filter part and re-render. */
  private clearFilter(): void {
    this.filter = emptyFilter();
    this.filterInput.value = '';
    this.filterPanel.hidden = true;
    this.render();
  }

  /** Sync the filter input, clear button and active indicator with state. */
  private refreshFilterUi(): void {
    const active = isFilterActive(this.filter);
    this.filterClearBtn.hidden = !active;
    this.filterBtn.classList.toggle('is-active', active);
    if (this.filterInput.value !== this.filter.query) {
      this.filterInput.value = this.filter.query;
    }
    if (!this.filterPanel.hidden) this.refreshFilterPanel();
  }

  /** Rebuild the filter popover (label chips + due-date selector). */
  private refreshFilterPanel(): void {
    const board = this.active();
    if (!board) return;
    this.filterPanel.replaceChildren();

    const labelTitle = this.doc.createElement('div');
    labelTitle.className = 'filter-panel-title';
    labelTitle.textContent = t('labels');
    this.filterPanel.appendChild(labelTitle);

    const chips = this.doc.createElement('div');
    chips.className = 'filter-label-chips';
    for (const label of board.labels) {
      const chip = this.doc.createElement('button');
      chip.className = 'filter-label-chip';
      chip.style.background = label.color;
      const on = this.filter.labelIds.includes(label.id);
      if (on) chip.classList.add('is-on');
      chip.textContent = (on ? '✓ ' : '') + (label.name || '');
      chip.addEventListener('click', () => {
        const at = this.filter.labelIds.indexOf(label.id);
        if (at >= 0) this.filter.labelIds.splice(at, 1);
        else this.filter.labelIds.push(label.id);
        this.render();
      });
      chips.appendChild(chip);
    }
    this.filterPanel.appendChild(chips);

    const dueTitle = this.doc.createElement('div');
    dueTitle.className = 'filter-panel-title';
    dueTitle.textContent = t('dueFilter');
    this.filterPanel.appendChild(dueTitle);

    const dueSelect = this.doc.createElement('select');
    dueSelect.className = 'control filter-due-select';
    const dueOptions: Array<[DueFilter, string]> = [
      ['all', t('dueAll')],
      ['has', t('dueHas')],
      ['overdue', t('dueOverdue')],
      ['soon', t('dueSoon')],
      ['done', t('dueComplete')],
      ['none', t('dueNone')],
    ];
    for (const [value, label] of dueOptions) {
      const option = this.doc.createElement('option');
      option.value = value;
      option.textContent = label;
      dueSelect.appendChild(option);
    }
    dueSelect.value = this.filter.due;
    dueSelect.addEventListener('change', () => {
      this.filter.due = dueSelect.value as DueFilter;
      this.render();
    });
    this.filterPanel.appendChild(dueSelect);

    const clear = this.doc.createElement('button');
    clear.className = 'filter-panel-clear';
    clear.textContent = t('clearFilter');
    clear.addEventListener('click', () => this.clearFilter());
    this.filterPanel.appendChild(clear);
  }

  private refreshBoardSelect(): void {
    this.boardSelect.replaceChildren();
    // Starred boards come first and carry a star marker in their name.
    for (const board of sortedBoards(this.data)) {
      const option = this.doc.createElement('option');
      option.value = board.id;
      option.textContent = (board.starred ? '⭐ ' : '') + board.name;
      this.boardSelect.appendChild(option);
    }
    this.boardSelect.value = this.data.activeBoardId ?? '';
    this.starBtn.textContent = this.active()?.starred ? '⭐' : '☆';
    this.langSelect.value = this.data.settings.lang;
    this.themeSelect.value = this.data.settings.theme;
  }

  /** Update all static labels marked with data-i18n / data-i18n-title. */
  private refreshLabels(): void {
    this.doc.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
      const key = node.dataset.i18n;
      if (key) node.textContent = t(key);
    });
    this.doc.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((node) => {
      const key = node.dataset.i18nTitle;
      if (key) node.title = t(key);
    });
    this.doc.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((node) => {
      const key = node.dataset.i18nPlaceholder;
      if (key) node.placeholder = t(key);
    });
    this.doc.title = t('appTitle');
  }
}
