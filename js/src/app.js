// Application controller. Owns the in-memory state, persists every change to
// IndexedDB (so work resumes across sessions), and wires the renderer, drag and
// drop, zoom, JSON import/export and PNG export together. No global variables
// are used; all state lives on the instance.
import { loadData, saveData } from './store.js';
import { createBoard, createColumn, getActiveBoard, addColumn, renameColumn, removeColumn, moveColumn, addCard, updateCard, removeCard, moveCard, } from './model.js';
import { setLanguage, t } from './i18n.js';
import { renderBoard, CARD_COLORS } from './render.js';
import { DragController } from './dnd.js';
import { ZoomController } from './zoom.js';
import { downloadJson, readJsonFile } from './jsonio.js';
import { exportBoardPng } from './png.js';
export class KanbanApp {
    constructor(doc) {
        this.doc = doc;
        this.saveTimer = 0;
        this.columnsEl = this.byId('columns');
        this.boardSelect = this.byId('boardSelect');
        this.langSelect = this.byId('langSelect');
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
                if (board && moveCard(board, from, cardId, to, index))
                    this.commit();
            },
            moveColumn: (from, to) => {
                const board = this.active();
                if (board && moveColumn(board, from, to))
                    this.commit();
            },
            isBlocked: () => this.zoom.isPinching(),
        });
        this.wireToolbar();
        // Flush any pending debounced save before the page is hidden/closed so that
        // work always resumes exactly where the user left off.
        const view = this.doc.defaultView;
        view?.addEventListener('pagehide', () => this.flush());
        this.doc.addEventListener('visibilitychange', () => {
            if (this.doc.visibilityState === 'hidden')
                this.flush();
        });
        this.render();
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
            deleteCard: (colId, cardId) => {
                const board = this.active();
                if (board && removeCard(board, colId, cardId))
                    this.commit();
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
            deleteColumn: (colId) => {
                const board = this.active();
                if (board && this.doc.defaultView?.confirm(t('deleteColumnConfirm'))) {
                    if (removeColumn(board, colId))
                        this.commit();
                }
            },
        };
    }
    wireToolbar() {
        this.byId('newBoardBtn').addEventListener('click', () => this.newBoard());
        this.byId('renameBoardBtn').addEventListener('click', () => this.renameBoard());
        this.byId('deleteBoardBtn').addEventListener('click', () => this.deleteBoard());
        this.boardSelect.addEventListener('change', () => {
            this.data.activeBoardId = this.boardSelect.value;
            this.commit();
        });
        this.langSelect.addEventListener('change', () => {
            this.setLang(this.langSelect.value);
        });
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
                this.commit();
            }
            catch {
                this.doc.defaultView?.alert(t('importError'));
            }
            finally {
                importInput.value = '';
            }
        });
    }
    newBoard() {
        const name = this.doc.defaultView?.prompt(t('boardNamePrompt'), t('newBoard'));
        if (name === null || name === undefined)
            return;
        const board = createBoard(name || t('newBoard'), [
            createColumn('To Do'),
            createColumn('In Progress'),
            createColumn('Done'),
        ]);
        this.data.boards.push(board);
        this.data.activeBoardId = board.id;
        this.commit();
    }
    renameBoard() {
        const board = this.active();
        if (!board)
            return;
        const name = this.doc.defaultView?.prompt(t('boardNamePrompt'), board.name);
        if (name === null || name === undefined)
            return;
        board.name = name || board.name;
        this.commit();
    }
    deleteBoard() {
        const board = this.active();
        if (!board)
            return;
        if (!this.doc.defaultView?.confirm(t('deleteBoardConfirm')))
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
        this.commit();
    }
    setLang(lang) {
        this.data.settings.lang = lang;
        setLanguage(lang);
        this.doc.documentElement.lang = lang;
        this.commit();
    }
    /** Apply state changes: persist and re-render. */
    commit() {
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
        if (board)
            renderBoard(this.columnsEl, board, this.handlers);
        this.refreshBoardSelect();
        this.refreshLabels();
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
        this.doc.title = t('appTitle');
    }
}
