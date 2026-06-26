// Custom modal dialogs that replace the browser's native alert/confirm/prompt.
// They are promise-based, keyboard-accessible (Enter/Escape), close on backdrop
// click, and use only the DOM (no external library).

import { getLanguage, t } from './i18n.js';
import { Label } from './types.js';

type ModalKind = 'alert' | 'confirm' | 'prompt';
type ModalResult = string | boolean | null;

interface ModalOptions {
  kind: ModalKind;
  message: string;
  defaultValue?: string;
}

function openModal(opts: ModalOptions): Promise<ModalResult> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.setAttribute('role', opts.kind === 'alert' ? 'alertdialog' : 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    overlay.appendChild(dialog);

    const message = document.createElement('div');
    message.className = 'modal-message';
    message.textContent = opts.message;
    dialog.appendChild(message);

    let input: HTMLInputElement | null = null;
    if (opts.kind === 'prompt') {
      input = document.createElement('input');
      input.className = 'modal-input';
      input.type = 'text';
      input.value = opts.defaultValue ?? '';
      dialog.appendChild(input);
    }

    const cancelValue: ModalResult = opts.kind === 'confirm' ? false : null;
    const okValue = (): ModalResult => {
      if (opts.kind === 'confirm') return true;
      if (opts.kind === 'prompt') return input ? input.value : '';
      return null;
    };

    let settled = false;
    const close = (result: ModalResult): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(cancelValue);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close(okValue());
      }
    };

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    if (opts.kind !== 'alert') {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'modal-btn modal-cancel';
      cancelBtn.textContent = t('cancel');
      cancelBtn.addEventListener('click', () => close(cancelValue));
      actions.appendChild(cancelBtn);
    }

    const okBtn = document.createElement('button');
    okBtn.className = 'modal-btn modal-ok';
    okBtn.textContent = t('ok');
    okBtn.addEventListener('click', () => close(okValue()));
    actions.appendChild(okBtn);

    dialog.appendChild(actions);

    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close(cancelValue);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    if (input) {
      input.focus();
      input.select();
    } else {
      okBtn.focus();
    }
  });
}

/** Custom replacement for window.alert. */
export function customAlert(message: string): Promise<void> {
  return openModal({ kind: 'alert', message }).then(() => undefined);
}

/** Custom replacement for window.confirm. */
export function customConfirm(message: string): Promise<boolean> {
  return openModal({ kind: 'confirm', message }).then((r) => r === true);
}

/** Custom replacement for window.prompt. Resolves null if cancelled. */
export function customPrompt(message: string, defaultValue = ''): Promise<string | null> {
  return openModal({ kind: 'prompt', message, defaultValue }).then((r) =>
    typeof r === 'string' ? r : null,
  );
}

/** Initial state shown by the card detail modal. */
export interface CardDetailInit {
  text: string;
  description: string;
  color: string;
  createdAt: number;
  /** Current due date (ms) or null when unset. */
  dueAt: number | null;
  /** Whether the due date is marked complete. */
  dueDone: boolean;
  /** Accent palette to offer; the first (empty) entry means "no accent". */
  colors: readonly string[];
  /** The board's shared labels (mutated in place when renamed). */
  labels: Label[];
  /** Ids of labels currently assigned to this card. */
  assignedLabelIds: string[];
}

/** Fields saved when the card detail modal is committed. */
export interface CardDetailPatch {
  text: string;
  description: string;
  dueAt: number | null;
  dueDone: boolean;
  color: string;
}

/** Callbacks invoked by the card detail modal. */
export interface CardDetailCallbacks {
  onSave(patch: CardDetailPatch): void;
  /** Archive the card (reversible from the archive view). */
  onArchive(): void;
  /** Assign/unassign a label on the card. */
  onToggleLabel(labelId: string): void;
  /** Rename a board label (applies everywhere it is used). */
  onRenameLabel(labelId: string, name: string): void;
}

/** Convert a timestamp to a `datetime-local` input value in local time. */
function toLocalInputValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Parse a `datetime-local` value (local time) back into a timestamp or null. */
function fromLocalInputValue(value: string): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/** Format a timestamp using the active language's locale. */
function formatDate(ts: number): string {
  const locale = getLanguage() === 'en' ? 'en-US' : 'ko-KR';
  return new Date(ts).toLocaleString(locale);
}

/**
 * Open the "back of the card": an editable title + free-form description, an
 * accent color picker and a delete action. Resolves when the dialog closes.
 */
export function openCardDetail(init: CardDetailInit, cb: CardDetailCallbacks): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog card-detail';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    overlay.appendChild(dialog);

    const addLabel = (text: string): void => {
      const label = document.createElement('div');
      label.className = 'card-detail-label';
      label.textContent = text;
      dialog.appendChild(label);
    };

    addLabel(t('cardTitleLabel'));
    const title = document.createElement('input');
    title.className = 'modal-input card-detail-title';
    title.type = 'text';
    title.value = init.text;
    dialog.appendChild(title);

    // --- Labels: toggle assignment by clicking a chip, rename via ✏️. ---
    addLabel(t('labels'));
    const labelList = document.createElement('div');
    labelList.className = 'card-detail-labels';
    dialog.appendChild(labelList);

    const assigned = new Set(init.assignedLabelIds);
    const renderLabels = (): void => {
      labelList.replaceChildren();
      for (const label of init.labels) {
        const row = document.createElement('div');
        row.className = 'card-detail-label-row';

        const chip = document.createElement('button');
        chip.className = 'card-detail-label-chip';
        chip.style.background = label.color;
        const on = assigned.has(label.id);
        if (on) chip.classList.add('is-on');
        chip.textContent = (on ? '✓ ' : '') + (label.name || '');
        chip.addEventListener('click', () => {
          if (assigned.has(label.id)) assigned.delete(label.id);
          else assigned.add(label.id);
          cb.onToggleLabel(label.id);
          renderLabels();
        });

        const rename = document.createElement('button');
        rename.className = 'card-detail-label-edit';
        rename.textContent = '✏️';
        rename.title = t('rename');
        rename.addEventListener('click', () => {
          void customPrompt(t('labelNamePrompt'), label.name).then((name) => {
            if (name === null) return;
            cb.onRenameLabel(label.id, name); // mutates the shared label object
            renderLabels();
          });
        });

        row.append(chip, rename);
        labelList.appendChild(row);
      }
    };
    renderLabels();

    // --- Due date: a datetime picker, a "done" toggle and a clear button. ---
    addLabel(t('dueDate'));
    const dueRow = document.createElement('div');
    dueRow.className = 'card-detail-due';

    const dueInput = document.createElement('input');
    dueInput.className = 'card-detail-due-input';
    dueInput.type = 'datetime-local';
    if (init.dueAt != null) dueInput.value = toLocalInputValue(init.dueAt);

    const doneLabel = document.createElement('label');
    doneLabel.className = 'card-detail-due-done';
    const doneCheck = document.createElement('input');
    doneCheck.type = 'checkbox';
    doneCheck.checked = init.dueDone;
    doneLabel.append(doneCheck, document.createTextNode(t('dueComplete')));

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'card-detail-due-clear';
    clearBtn.textContent = t('clear');
    clearBtn.addEventListener('click', () => {
      dueInput.value = '';
      doneCheck.checked = false;
    });

    dueRow.append(dueInput, doneLabel, clearBtn);
    dialog.appendChild(dueRow);

    addLabel(t('description'));
    const desc = document.createElement('textarea');
    desc.className = 'card-detail-desc';
    desc.value = init.description;
    desc.placeholder = t('descriptionPlaceholder');
    dialog.appendChild(desc);

    addLabel(t('color'));
    let selectedColor = init.color;
    const swatches = document.createElement('div');
    swatches.className = 'card-detail-colors';
    for (const color of init.colors) {
      const swatch = document.createElement('button');
      swatch.className = 'card-detail-swatch';
      swatch.style.background = color || 'transparent';
      if (!color) swatch.classList.add('is-none'); // shows a "no color" hint
      if (color === selectedColor) swatch.classList.add('is-selected');
      swatch.addEventListener('click', () => {
        selectedColor = color;
        swatches
          .querySelectorAll('.card-detail-swatch')
          .forEach((s) => s.classList.remove('is-selected'));
        swatch.classList.add('is-selected');
      });
      swatches.appendChild(swatch);
    }
    dialog.appendChild(swatches);

    const meta = document.createElement('div');
    meta.className = 'card-detail-meta';
    meta.textContent = `${t('created')}: ${formatDate(init.createdAt)}`;
    dialog.appendChild(meta);

    let settled = false;
    const close = (): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve();
    };
    const save = (): void => {
      const dueAt = fromLocalInputValue(dueInput.value);
      cb.onSave({
        text: title.value.trim(),
        description: desc.value.trim(),
        dueAt,
        dueDone: dueAt != null && doneCheck.checked,
        color: selectedColor,
      });
      close();
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const archiveBtn = document.createElement('button');
    archiveBtn.className = 'modal-btn card-detail-delete';
    archiveBtn.textContent = `🗄️ ${t('archive')}`;
    archiveBtn.addEventListener('click', () => {
      cb.onArchive(); // reversible, so no confirmation needed
      close();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn modal-cancel';
    cancelBtn.textContent = t('cancel');
    cancelBtn.addEventListener('click', () => close());

    const okBtn = document.createElement('button');
    okBtn.className = 'modal-btn modal-ok';
    okBtn.textContent = t('save');
    okBtn.addEventListener('click', () => save());

    actions.append(archiveBtn, cancelBtn, okBtn);
    dialog.appendChild(actions);

    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    title.focus();
  });
}

/** One archived card as shown in the archive view. */
export interface ArchiveEntry {
  cardId: string;
  text: string;
  /** Title of the origin column (may be empty if it was deleted). */
  columnTitle: string;
}

/** Callbacks for the archive view. `list` is re-read after every action. */
export interface ArchiveCallbacks {
  list(): ArchiveEntry[];
  onRestore(cardId: string): void;
  onDeleteForever(cardId: string): void;
}

/**
 * Show the board's archive: a list of archived cards, each restorable or
 * permanently deletable (with confirmation). Resolves when the view closes.
 */
export function openArchive(cb: ArchiveCallbacks): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog card-archive';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    overlay.appendChild(dialog);

    const heading = document.createElement('div');
    heading.className = 'card-detail-label';
    heading.textContent = t('archiveView');
    dialog.appendChild(heading);

    const listEl = document.createElement('div');
    listEl.className = 'archive-list';
    dialog.appendChild(listEl);

    const renderList = (): void => {
      listEl.replaceChildren();
      const entries = cb.list();
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'archive-empty';
        empty.textContent = t('archiveEmpty');
        listEl.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'archive-row';

        const info = document.createElement('div');
        info.className = 'archive-info';
        const text = document.createElement('div');
        text.className = 'archive-text';
        text.textContent = entry.text || ' ';
        info.appendChild(text);
        if (entry.columnTitle) {
          const origin = document.createElement('div');
          origin.className = 'archive-origin';
          origin.textContent = entry.columnTitle;
          info.appendChild(origin);
        }

        const restore = document.createElement('button');
        restore.className = 'archive-btn archive-restore';
        restore.textContent = t('restore');
        restore.addEventListener('click', () => {
          cb.onRestore(entry.cardId);
          renderList();
        });

        const del = document.createElement('button');
        del.className = 'archive-btn archive-delete';
        del.textContent = t('deleteForever');
        del.addEventListener('click', () => {
          void customConfirm(t('deleteForeverConfirm')).then((ok) => {
            if (ok) {
              cb.onDeleteForever(entry.cardId);
              renderList();
            }
          });
        });

        row.append(info, restore, del);
        listEl.appendChild(row);
      }
    };
    renderList();

    let settled = false;
    const close = (): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn modal-ok';
    closeBtn.textContent = t('close');
    closeBtn.addEventListener('click', () => close());
    actions.appendChild(closeBtn);
    dialog.appendChild(actions);

    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    closeBtn.focus();
  });
}
