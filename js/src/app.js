// Application controller. Owns the in-memory state, persists every change to
// IndexedDB (so work resumes across sessions), and wires the renderer, drag and
// drop, zoom, JSON import/export and PNG export together. No global variables
// are used; all state lives on the instance.
import { loadData, saveData } from './store.js';
import { createBoard, createColumn, getActiveBoard, addColumn, renameColumn, moveColumn, sortColumnCards, duplicateColumn, moveAllCards, addCard, updateCard, moveCard, addLabel, updateLabel, removeLabel, toggleCardLabel, LABEL_COLORS, addChecklistItem, updateChecklistItem, removeChecklistItem, addComment, updateComment, removeComment, duplicateCard, archiveCard, restoreCard, deleteArchivedCard, archiveColumn, restoreColumn, deleteArchivedColumn, setBoardBackground, BOARD_BACKGROUNDS, touch, } from './model.js';
import { History } from './history.js';
import { setLanguage, t } from './i18n.js';
import { emptyFilter, isFilterActive } from './filter.js';
import { renderBoard, CARD_COLORS } from './render.js';
import { DragController } from './dnd.js';
import { ZoomController } from './zoom.js';
import { LayoutController } from './layout.js';
import { downloadJson, readJsonFile } from './jsonio.js';
import { exportBoardPng } from './png.js';
import { customAlert, customConfirm, customPrompt, openCardDetail, openArchive, openColorPicker, } from './modal.js';
/** Maximum number of undo steps kept per board. */
const MAX_HISTORY = 8;
/** Darken a #rrggbb color by the given factor (0..1) for the toolbar shade. */
function darken(hex, factor) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match)
        return hex;
    const num = parseInt(match[1], 16);
    const scale = (v) => Math.round(v * factor);
    const r = scale((num >> 16) & 0xff);
    const g = scale((num >> 8) & 0xff);
    const b = scale(num & 0xff);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
export class KanbanApp {
    constructor(doc) {
        this.doc = doc;
        this.saveTimer = 0;
        // Undo/redo of the active board's content (columns + cards). `baseline` holds
        // a clone of the last committed state so a change can be recorded *before* it
        // is overwritten by the next mutation.
        this.history = new History(MAX_HISTORY);
        this.baseline = [];
        /** Current search/label/due filter (in-memory, not persisted). */
        this.filter = emptyFilter();
        this.columnsEl = this.byId('columns');
        this.surfaceEl = this.byId('boardSurface');
        this.boardSelect = this.byId('boardSelect');
        this.langSelect = this.byId('langSelect');
        this.undoBtn = this.byId('undoBtn');
        this.redoBtn = this.byId('redoBtn');
        this.filterInput = this.byId('filterInput');
        this.filterBtn = this.byId('filterBtn');
        this.filterClearBtn = this.byId('filterClearBtn');
        this.filterPanel = this.byId('filterPanel');
        this.menuBtn = this.byId('menuBtn');
        this.menuPanel = this.byId('menuPanel');
    }
    byId(id) {
        const node = this.doc.getElementById(id);
        if (!node)
            throw new Error(`missing element #${id}`);
        return node;
    }
    /** Load persisted state and start the app. */
    async start() {
        this.data = await loadData();
        setLanguage(this.data.settings.lang);
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
        if (view)
            new LayoutController(surface, this.columnsEl, view);
        new DragController(this.columnsEl, {
            moveCard: (from, cardId, to, index) => {
                const board = this.active();
                if (board && moveCard(board, from, cardId, to, index))
                    this.commit();
            },
            moveColumn: (from, to) => {
                const board = this.active();
                if (board && moveColumn(board, from, to))
                    this.commit();
            },
            // Reordering while filtered would map visible positions onto the full
            // list incorrectly, so drag is suspended whenever a filter is active.
            isBlocked: () => this.zoom.isPinching() || isFilterActive(this.filter),
        });
        this.wireToolbar();
        this.resetHistory();
        // Flush any pending debounced save before the page is hidden/closed so that
        // work always resumes exactly where the user left off.
        view?.addEventListener('pagehide', () => this.flush());
        this.doc.addEventListener('visibilitychange', () => {
            if (this.doc.visibilityState === 'hidden')
                this.flush();
        });
        // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo.
        this.doc.addEventListener('keydown', (e) => this.onKeyDown(e));
        // Dismiss the filter/overflow popovers when clicking outside of them.
        this.doc.addEventListener('pointerdown', (e) => this.closePanelsOnOutside(e), true);
        this.render();
    }
    /** Close a popover when a pointer goes down outside it and its toggle button. */
    closePanelsOnOutside(e) {
        const target = e.target;
        if (!this.filterPanel.hidden &&
            !this.filterPanel.contains(target) &&
            !this.filterBtn.contains(target)) {
            this.filterPanel.hidden = true;
        }
        if (!this.menuPanel.hidden &&
            !this.menuPanel.contains(target) &&
            !this.menuBtn.contains(target)) {
            this.menuPanel.hidden = true;
        }
    }
    onKeyDown(e) {
        if (!(e.ctrlKey || e.metaKey))
            return;
        // Leave native text editing (inline card/list edit, modal inputs) alone.
        const target = e.target;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable)
            return;
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
        }
        else if ((key === 'z' && e.shiftKey) || key === 'y') {
            e.preventDefault();
            this.redo();
        }
    }
    /** Immediately persist, cancelling any pending debounced save. */
    flush() {
        const view = this.doc.defaultView;
        if (view && this.saveTimer) {
            view.clearTimeout(this.saveTimer);
            this.saveTimer = 0;
        }
        void saveData(this.data);
    }
    active() {
        return getActiveBoard(this.data);
    }
    get handlers() {
        return {
            addCard: (colId) => {
                const board = this.active();
                if (board && addCard(board, colId, t('newCardText')))
                    this.commit();
            },
            editCard: (colId, cardId, text) => {
                const board = this.active();
                if (board && updateCard(board, colId, cardId, { text }))
                    this.commit();
            },
            archiveCard: (colId, cardId) => {
                const board = this.active();
                if (board && archiveCard(board, colId, cardId))
                    this.commitArchive();
            },
            cycleCardColor: (colId, cardId) => {
                const board = this.active();
                if (!board)
                    return;
                const column = board.columns.find((c) => c.id === colId);
                const card = column?.cards.find((c) => c.id === cardId);
                if (!card)
                    return;
                const next = CARD_COLORS[(CARD_COLORS.indexOf(card.color) + 1) % CARD_COLORS.length];
                if (updateCard(board, colId, cardId, { color: next }))
                    this.commit();
            },
            openCard: (colId, cardId) => {
                const board = this.active();
                if (!board)
                    return;
                const column = board.columns.find((c) => c.id === colId);
                const card = column?.cards.find((c) => c.id === cardId);
                if (!card)
                    return;
                void openCardDetail({
                    text: card.text,
                    description: card.description,
                    color: card.color,
                    createdAt: card.createdAt,
                    dueAt: card.dueAt,
                    dueDone: card.dueDone,
                    colors: CARD_COLORS,
                    labels: board.labels,
                    labelColors: LABEL_COLORS,
                    assignedLabelIds: card.labelIds.slice(),
                    checklist: card.checklist,
                    comments: card.comments,
                    columnId: colId,
                    columns: board.columns.map((c) => ({
                        id: c.id,
                        title: c.title,
                        cardCount: c.cards.length,
                    })),
                }, {
                    onSave: (patch) => {
                        if (updateCard(board, colId, cardId, patch))
                            this.commit();
                    },
                    onArchive: () => {
                        if (archiveCard(board, colId, cardId))
                            this.commitArchive();
                    },
                    onToggleLabel: (labelId) => {
                        if (toggleCardLabel(board, colId, cardId, labelId))
                            this.commit();
                    },
                    onRenameLabel: (labelId, name) => {
                        if (updateLabel(board, labelId, { name }))
                            this.commit();
                    },
                    onRecolorLabel: (labelId, color) => {
                        if (updateLabel(board, labelId, { color }))
                            this.commit();
                    },
                    onAddLabel: (name, labelColor) => {
                        addLabel(board, name, labelColor);
                        this.commit();
                    },
                    onRemoveLabel: (labelId) => {
                        if (removeLabel(board, labelId))
                            this.commit();
                    },
                    onAddChecklistItem: (text) => {
                        if (addChecklistItem(board, colId, cardId, text))
                            this.commit();
                    },
                    onToggleChecklistItem: (itemId) => {
                        const item = card.checklist.find((i) => i.id === itemId);
                        if (item && updateChecklistItem(board, colId, cardId, itemId, { done: !item.done })) {
                            this.commit();
                        }
                    },
                    onRenameChecklistItem: (itemId, text) => {
                        if (updateChecklistItem(board, colId, cardId, itemId, { text }))
                            this.commit();
                    },
                    onRemoveChecklistItem: (itemId) => {
                        if (removeChecklistItem(board, colId, cardId, itemId))
                            this.commit();
                    },
                    onAddComment: (text) => {
                        if (addComment(board, colId, cardId, text))
                            this.commit();
                    },
                    onEditComment: (commentId, text) => {
                        if (updateComment(board, colId, cardId, commentId, text))
                            this.commit();
                    },
                    onRemoveComment: (commentId) => {
                        if (removeComment(board, colId, cardId, commentId))
                            this.commit();
                    },
                    onCopy: () => {
                        if (duplicateCard(board, colId, cardId))
                            this.commit();
                    },
                    onMove: (toColumnId, toIndex) => {
                        if (moveCard(board, colId, cardId, toColumnId, toIndex))
                            this.commit();
                    },
                });
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
                if (board && renameColumn(board, colId, title))
                    this.commit();
            },
            archiveColumn: (colId) => {
                const board = this.active();
                if (board && archiveColumn(board, colId))
                    this.commitArchive();
            },
            sortColumn: (colId, by) => {
                const board = this.active();
                if (board && sortColumnCards(board, colId, by))
                    this.commit();
            },
            copyColumn: (colId) => {
                const board = this.active();
                if (board && duplicateColumn(board, colId))
                    this.commit();
            },
            moveAllCards: (fromColId, toColId) => {
                const board = this.active();
                if (board && moveAllCards(board, fromColId, toColId))
                    this.commit();
            },
        };
    }
    wireToolbar() {
        this.byId('newBoardBtn').addEventListener('click', () => this.newBoard());
        this.byId('renameBoardBtn').addEventListener('click', () => this.renameBoard());
        this.byId('deleteBoardBtn').addEventListener('click', () => this.deleteBoard());
        this.byId('archiveBtn').addEventListener('click', () => this.openArchiveView());
        this.byId('bgColorBtn').addEventListener('click', () => this.pickBackground());
        this.boardSelect.addEventListener('change', () => {
            this.data.activeBoardId = this.boardSelect.value;
            this.commitReset();
        });
        this.langSelect.addEventListener('change', () => {
            this.setLang(this.langSelect.value);
            this.menuPanel.hidden = true;
        });
        // Overflow menu: toggle, and close after an action is chosen.
        this.menuBtn.addEventListener('click', () => {
            this.menuPanel.hidden = !this.menuPanel.hidden;
        });
        this.menuPanel.addEventListener('click', (e) => {
            if (e.target.closest('button, label'))
                this.menuPanel.hidden = true;
        });
        this.undoBtn.addEventListener('click', () => this.undo());
        this.redoBtn.addEventListener('click', () => this.redo());
        this.filterInput.addEventListener('input', () => {
            this.filter.query = this.filterInput.value;
            this.render();
        });
        this.filterBtn.addEventListener('click', () => {
            this.filterPanel.hidden = !this.filterPanel.hidden;
            if (!this.filterPanel.hidden)
                this.refreshFilterPanel();
        });
        this.filterClearBtn.addEventListener('click', () => this.clearFilter());
        this.byId('zoomInBtn').addEventListener('click', () => this.zoom.zoomIn());
        this.byId('zoomOutBtn').addEventListener('click', () => this.zoom.zoomOut());
        this.byId('zoomResetBtn').addEventListener('click', () => this.zoom.reset());
        this.byId('exportJsonBtn').addEventListener('click', () => downloadJson(this.data));
        this.byId('exportPngBtn').addEventListener('click', () => {
            const board = this.active();
            if (board)
                exportBoardPng(board);
        });
        const importInput = this.byId('importJsonInput');
        importInput.addEventListener('change', async () => {
            const file = importInput.files?.[0];
            if (!file)
                return;
            try {
                this.data = await readJsonFile(file);
                setLanguage(this.data.settings.lang);
                this.zoom.setScale(this.data.settings.zoom);
                this.commitReset();
            }
            catch {
                void customAlert(t('importError'));
            }
            finally {
                importInput.value = '';
            }
        });
    }
    async newBoard() {
        const name = await customPrompt(t('boardNamePrompt'), t('newBoard'));
        if (name === null)
            return;
        const board = createBoard(name || t('newBoard'), [
            createColumn('To Do'),
            createColumn('In Progress'),
            createColumn('Done'),
        ]);
        this.data.boards.push(board);
        this.data.activeBoardId = board.id;
        this.commitReset();
    }
    async renameBoard() {
        const board = this.active();
        if (!board)
            return;
        const name = await customPrompt(t('boardNamePrompt'), board.name);
        if (name === null)
            return;
        board.name = name || board.name;
        // Board name is outside undo scope (cards/lists), so keep the history.
        this.refresh();
    }
    async deleteBoard() {
        const board = this.active();
        if (!board)
            return;
        if (!(await customConfirm(t('deleteBoardConfirm'))))
            return;
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
    async pickBackground() {
        const board = this.active();
        if (!board)
            return;
        const color = await openColorPicker(t('backgroundPrompt'), BOARD_BACKGROUNDS, board.background);
        if (color === null)
            return;
        // Background is board decoration, outside the undo scope (cards/lists).
        if (setBoardBackground(board, color))
            this.refresh();
    }
    /** Apply the active board's background to the page theme variables. */
    applyBackground() {
        const rootStyle = this.doc.documentElement.style;
        const background = this.active()?.background ?? '';
        if (background) {
            rootStyle.setProperty('--bg', background);
            rootStyle.setProperty('--toolbar-bg', darken(background, 0.85));
        }
        else {
            rootStyle.removeProperty('--bg');
            rootStyle.removeProperty('--toolbar-bg');
        }
    }
    setLang(lang) {
        this.data.settings.lang = lang;
        setLanguage(lang);
        this.doc.documentElement.lang = lang;
        // Language is a setting, not board content, so the history is preserved.
        this.refresh();
    }
    /** Clone any JSON-serializable value (board snapshots are plain JSON). */
    clone(value) {
        return JSON.parse(JSON.stringify(value));
    }
    /** Forget undo/redo history and re-baseline on the active board. */
    resetHistory() {
        this.history.clear();
        const board = this.active();
        this.baseline = board ? this.clone(board.columns) : [];
        this.updateHistoryButtons();
    }
    updateHistoryButtons() {
        this.undoBtn.disabled = !this.history.canUndo();
        this.redoBtn.disabled = !this.history.canRedo();
    }
    /** Revert the active board's content to the previous state. */
    undo() {
        const board = this.active();
        if (!board)
            return;
        const previous = this.history.undo(this.clone(board.columns));
        if (!previous)
            return;
        board.columns = this.clone(previous);
        this.baseline = this.clone(previous);
        touch(board);
        this.persist();
        this.render();
    }
    /** Re-apply the most recently undone change. */
    redo() {
        const board = this.active();
        if (!board)
            return;
        const next = this.history.redo(this.clone(board.columns));
        if (!next)
            return;
        board.columns = this.clone(next);
        this.baseline = this.clone(next);
        touch(board);
        this.persist();
        this.render();
    }
    /** Apply a board-content change: record an undo step, persist and re-render. */
    commit() {
        const board = this.active();
        if (board) {
            this.history.record(this.baseline);
            this.baseline = this.clone(board.columns);
        }
        this.persist();
        this.render();
    }
    /** Persist and re-render without touching the undo history. */
    refresh() {
        this.persist();
        this.render();
    }
    /**
     * Apply an archive/restore/purge change. These move cards between the board
     * and the board-level archive, which the undo history (columns only) does not
     * track, so the history is reset to keep undo from producing duplicates.
     */
    commitArchive() {
        this.resetHistory();
        this.persist();
        this.render();
    }
    /** Open the archive view, wiring restore/permanent-delete back to the model. */
    openArchiveView() {
        if (!this.active())
            return;
        void openArchive({
            listColumns: () => {
                const board = this.active();
                if (!board)
                    return [];
                return board.archivedColumns.map((entry) => ({
                    id: entry.column.id,
                    text: entry.column.title,
                    subtitle: `${entry.column.cards.length} ${t('cardsUnit')}`,
                }));
            },
            listCards: () => {
                const board = this.active();
                if (!board)
                    return [];
                return board.archived.map((entry) => ({
                    id: entry.card.id,
                    text: entry.card.text,
                    subtitle: board.columns.find((c) => c.id === entry.columnId)?.title ?? '',
                }));
            },
            onRestoreColumn: (id) => {
                const board = this.active();
                if (board && restoreColumn(board, id))
                    this.commitArchive();
            },
            onDeleteColumnForever: (id) => {
                const board = this.active();
                if (board && deleteArchivedColumn(board, id))
                    this.commitArchive();
            },
            onRestoreCard: (id) => {
                const board = this.active();
                if (board && restoreCard(board, id))
                    this.commitArchive();
            },
            onDeleteCardForever: (id) => {
                const board = this.active();
                if (board && deleteArchivedCard(board, id))
                    this.commitArchive();
            },
        });
    }
    /** Persist, re-render and reset the undo history (board switched/replaced). */
    commitReset() {
        // A filter's label ids belong to the previous board, so start clean.
        this.filter = emptyFilter();
        this.filterInput.value = '';
        this.filterPanel.hidden = true;
        this.resetHistory();
        this.persist();
        this.render();
    }
    /** Debounced save so rapid edits do not thrash IndexedDB. */
    persist() {
        const view = this.doc.defaultView;
        if (!view)
            return;
        if (this.saveTimer)
            view.clearTimeout(this.saveTimer);
        this.saveTimer = view.setTimeout(() => {
            void saveData(this.data);
        }, 200);
    }
    render() {
        const board = this.active();
        // Rebuilding the board clears the DOM, which resets the surface scroll to 0
        // and snaps the view back to the first list. Capture and restore the scroll
        // offset so an edit keeps the list the user was working on in view.
        const { scrollLeft, scrollTop } = this.surfaceEl;
        if (board)
            renderBoard(this.columnsEl, board, this.filter, this.handlers);
        this.surfaceEl.scrollLeft = scrollLeft;
        this.surfaceEl.scrollTop = scrollTop;
        this.applyBackground();
        this.refreshBoardSelect();
        this.refreshLabels();
        this.refreshFilterUi();
        this.updateHistoryButtons();
    }
    /** Reset every filter part and re-render. */
    clearFilter() {
        this.filter = emptyFilter();
        this.filterInput.value = '';
        this.filterPanel.hidden = true;
        this.render();
    }
    /** Sync the filter input, clear button and active indicator with state. */
    refreshFilterUi() {
        const active = isFilterActive(this.filter);
        this.filterClearBtn.hidden = !active;
        this.filterBtn.classList.toggle('is-active', active);
        if (this.filterInput.value !== this.filter.query) {
            this.filterInput.value = this.filter.query;
        }
        if (!this.filterPanel.hidden)
            this.refreshFilterPanel();
    }
    /** Rebuild the filter popover (label chips + due-date selector). */
    refreshFilterPanel() {
        const board = this.active();
        if (!board)
            return;
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
            if (on)
                chip.classList.add('is-on');
            chip.textContent = (on ? '✓ ' : '') + (label.name || '');
            chip.addEventListener('click', () => {
                const at = this.filter.labelIds.indexOf(label.id);
                if (at >= 0)
                    this.filter.labelIds.splice(at, 1);
                else
                    this.filter.labelIds.push(label.id);
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
        const dueOptions = [
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
            this.filter.due = dueSelect.value;
            this.render();
        });
        this.filterPanel.appendChild(dueSelect);
        const clear = this.doc.createElement('button');
        clear.className = 'filter-panel-clear';
        clear.textContent = t('clearFilter');
        clear.addEventListener('click', () => this.clearFilter());
        this.filterPanel.appendChild(clear);
    }
    refreshBoardSelect() {
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
    refreshLabels() {
        this.doc.querySelectorAll('[data-i18n]').forEach((node) => {
            const key = node.dataset.i18n;
            if (key)
                node.textContent = t(key);
        });
        this.doc.querySelectorAll('[data-i18n-title]').forEach((node) => {
            const key = node.dataset.i18nTitle;
            if (key)
                node.title = t(key);
        });
        this.doc.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
            const key = node.dataset.i18nPlaceholder;
            if (key)
                node.placeholder = t(key);
        });
        this.doc.title = t('appTitle');
    }
}
