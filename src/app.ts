// Application controller. Owns the in-memory state, persists every change to
// IndexedDB (so work resumes across sessions), and wires the renderer, drag and
// drop, zoom, JSON import/export and PNG export together. No global variables
// are used; all state lives on the instance.

import { AppData, Board, Column, Language } from './types.js';
import { loadData, saveData } from './store.js';
import {
  createBoard,
  createColumn,
  getActiveBoard,
  addColumn,
  renameColumn,
  removeColumn,
  moveColumn,
  addCard,
  updateCard,
  removeCard,
  moveCard,
  updateLabel,
  toggleCardLabel,
  touch,
} from './model.js';
import { History } from './history.js';
import { setLanguage, t } from './i18n.js';
import { renderBoard, RenderHandlers, CARD_COLORS } from './render.js';
import { DragController } from './dnd.js';
import { ZoomController } from './zoom.js';
import { downloadJson, readJsonFile } from './jsonio.js';
import { exportBoardPng } from './png.js';
import { customAlert, customConfirm, customPrompt, openCardDetail } from './modal.js';

/** Maximum number of undo steps kept per board. */
const MAX_HISTORY = 8;

export class KanbanApp {
  private data!: AppData;
  private zoom!: ZoomController;
  private saveTimer = 0;

  // Undo/redo of the active board's content (columns + cards). `baseline` holds
  // a clone of the last committed state so a change can be recorded *before* it
  // is overwritten by the next mutation.
  private readonly history = new History<Column[]>(MAX_HISTORY);
  private baseline: Column[] = [];

  private readonly columnsEl: HTMLElement;
  private readonly boardSelect: HTMLSelectElement;
  private readonly langSelect: HTMLSelectElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;

  constructor(private readonly doc: Document) {
    this.columnsEl = this.byId('columns');
    this.boardSelect = this.byId('boardSelect') as HTMLSelectElement;
    this.langSelect = this.byId('langSelect') as HTMLSelectElement;
    this.undoBtn = this.byId('undoBtn') as HTMLButtonElement;
    this.redoBtn = this.byId('redoBtn') as HTMLButtonElement;
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

    const surface = this.byId('boardSurface');
    const scale = this.byId('boardScale');
    this.zoom = new ZoomController(scale, surface, (value) => {
      this.data.settings.zoom = value;
      this.persist();
    });
    this.zoom.setScale(this.data.settings.zoom);

    new DragController(this.columnsEl, {
      moveCard: (from, cardId, to, index) => {
        const board = this.active();
        if (board && moveCard(board, from, cardId, to, index)) this.commit();
      },
      moveColumn: (from, to) => {
        const board = this.active();
        if (board && moveColumn(board, from, to)) this.commit();
      },
      isBlocked: () => this.zoom.isPinching(),
    });

    this.wireToolbar();
    this.resetHistory();

    // Flush any pending debounced save before the page is hidden/closed so that
    // work always resumes exactly where the user left off.
    const view = this.doc.defaultView;
    view?.addEventListener('pagehide', () => this.flush());
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'hidden') this.flush();
    });

    // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo.
    this.doc.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.render();
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

  private get handlers(): RenderHandlers {
    return {
      addCard: (colId) => {
        const board = this.active();
        if (board && addCard(board, colId, t('newCardText'))) this.commit();
      },
      editCard: (colId, cardId, text) => {
        const board = this.active();
        if (board && updateCard(board, colId, cardId, { text })) this.commit();
      },
      deleteCard: async (colId, cardId) => {
        const board = this.active();
        if (!board) return;
        if (await customConfirm(t('deleteCardConfirm'))) {
          if (removeCard(board, colId, cardId)) this.commit();
        }
      },
      cycleCardColor: (colId, cardId) => {
        const board = this.active();
        if (!board) return;
        const column = board.columns.find((c) => c.id === colId);
        const card = column?.cards.find((c) => c.id === cardId);
        if (!card) return;
        const next = CARD_COLORS[(CARD_COLORS.indexOf(card.color) + 1) % CARD_COLORS.length];
        if (updateCard(board, colId, cardId, { color: next })) this.commit();
      },
      openCard: (colId, cardId) => {
        const board = this.active();
        if (!board) return;
        const column = board.columns.find((c) => c.id === colId);
        const card = column?.cards.find((c) => c.id === cardId);
        if (!card) return;
        void openCardDetail(
          {
            text: card.text,
            description: card.description,
            color: card.color,
            createdAt: card.createdAt,
            colors: CARD_COLORS,
            labels: board.labels,
            assignedLabelIds: card.labelIds.slice(),
          },
          {
            onSave: (patch) => {
              if (updateCard(board, colId, cardId, patch)) this.commit();
            },
            onDelete: () => {
              if (removeCard(board, colId, cardId)) this.commit();
            },
            onToggleLabel: (labelId) => {
              if (toggleCardLabel(board, colId, cardId, labelId)) this.commit();
            },
            onRenameLabel: (labelId, name) => {
              if (updateLabel(board, labelId, { name })) this.commit();
            },
          },
        );
      },
      addColumn: () => {
        const board = this.active();
        if (board) {
          addColumn(board, t('newColumnTitle'));
          this.commit();
        }
      },
      renameColumn: (colId, title) => {
        const board = this.active();
        if (board && renameColumn(board, colId, title)) this.commit();
      },
      deleteColumn: async (colId) => {
        const board = this.active();
        if (!board) return;
        if (await customConfirm(t('deleteColumnConfirm'))) {
          if (removeColumn(board, colId)) this.commit();
        }
      },
    };
  }

  private wireToolbar(): void {
    this.byId('newBoardBtn').addEventListener('click', () => this.newBoard());
    this.byId('renameBoardBtn').addEventListener('click', () => this.renameBoard());
    this.byId('deleteBoardBtn').addEventListener('click', () => this.deleteBoard());
    this.boardSelect.addEventListener('change', () => {
      this.data.activeBoardId = this.boardSelect.value;
      this.commitReset();
    });

    this.langSelect.addEventListener('change', () => {
      this.setLang(this.langSelect.value as Language);
    });

    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());

    this.byId('zoomInBtn').addEventListener('click', () => this.zoom.zoomIn());
    this.byId('zoomOutBtn').addEventListener('click', () => this.zoom.zoomOut());
    this.byId('zoomResetBtn').addEventListener('click', () => this.zoom.reset());

    this.byId('exportJsonBtn').addEventListener('click', () => downloadJson(this.data));
    this.byId('exportPngBtn').addEventListener('click', () => {
      const board = this.active();
      if (board) exportBoardPng(board);
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

  private setLang(lang: Language): void {
    this.data.settings.lang = lang;
    setLanguage(lang);
    this.doc.documentElement.lang = lang;
    // Language is a setting, not board content, so the history is preserved.
    this.refresh();
  }

  /** Clone any JSON-serializable value (board snapshots are plain JSON). */
  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  /** Forget undo/redo history and re-baseline on the active board. */
  private resetHistory(): void {
    this.history.clear();
    const board = this.active();
    this.baseline = board ? this.clone(board.columns) : [];
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
    const previous = this.history.undo(this.clone(board.columns));
    if (!previous) return;
    board.columns = this.clone(previous);
    this.baseline = this.clone(previous);
    touch(board);
    this.persist();
    this.render();
  }

  /** Re-apply the most recently undone change. */
  private redo(): void {
    const board = this.active();
    if (!board) return;
    const next = this.history.redo(this.clone(board.columns));
    if (!next) return;
    board.columns = this.clone(next);
    this.baseline = this.clone(next);
    touch(board);
    this.persist();
    this.render();
  }

  /** Apply a board-content change: record an undo step, persist and re-render. */
  private commit(): void {
    const board = this.active();
    if (board) {
      this.history.record(this.baseline);
      this.baseline = this.clone(board.columns);
    }
    this.persist();
    this.render();
  }

  /** Persist and re-render without touching the undo history. */
  private refresh(): void {
    this.persist();
    this.render();
  }

  /** Persist, re-render and reset the undo history (board switched/replaced). */
  private commitReset(): void {
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
    if (board) renderBoard(this.columnsEl, board, this.handlers);
    this.refreshBoardSelect();
    this.refreshLabels();
    this.updateHistoryButtons();
  }

  private refreshBoardSelect(): void {
    this.boardSelect.replaceChildren();
    for (const board of this.data.boards) {
      const option = this.doc.createElement('option');
      option.value = board.id;
      option.textContent = board.name;
      this.boardSelect.appendChild(option);
    }
    this.boardSelect.value = this.data.activeBoardId ?? '';
    this.langSelect.value = this.data.settings.lang;
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
    this.doc.title = t('appTitle');
  }
}
