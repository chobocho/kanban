// Custom modal dialogs that replace the browser's native alert/confirm/prompt.
// They are promise-based, keyboard-accessible (Enter/Escape), close on backdrop
// click, and use only the DOM (no external library).

import { getLanguage, t } from './i18n.js';
import { Attachment, ChecklistItem, Comment, Label } from './types.js';

/** Attachments above this size are refused to keep the DB and exports sane. */
const MAX_ATTACHMENT_BYTES = 1_500_000;

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

/**
 * Show a swatch palette and resolve with the picked color, or null when
 * cancelled. An empty-string color renders as a "no color / default" swatch.
 */
export function openColorPicker(
  message: string,
  colors: readonly string[],
  current: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    overlay.appendChild(dialog);

    const title = document.createElement('div');
    title.className = 'modal-message';
    title.textContent = message;
    dialog.appendChild(title);

    let settled = false;
    const close = (result: string | null): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    };

    const swatches = document.createElement('div');
    swatches.className = 'card-detail-colors';
    for (const color of colors) {
      const swatch = document.createElement('button');
      swatch.className = 'card-detail-swatch';
      swatch.style.background = color || 'transparent';
      if (!color) swatch.classList.add('is-none');
      if (color === current) swatch.classList.add('is-selected');
      swatch.addEventListener('click', () => close(color));
      swatches.appendChild(swatch);
    }
    dialog.appendChild(swatches);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn modal-cancel';
    cancelBtn.textContent = t('cancel');
    cancelBtn.addEventListener('click', () => close(null));
    actions.appendChild(cancelBtn);
    dialog.appendChild(actions);

    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    cancelBtn.focus();
  });
}

/** Initial state shown by the card detail modal. */
export interface CardDetailInit {
  text: string;
  description: string;
  color: string;
  createdAt: number;
  /** Current start date (ms) or null when unset. */
  startAt: number | null;
  /** Current due date (ms) or null when unset. */
  dueAt: number | null;
  /** Whether the due date is marked complete. */
  dueDone: boolean;
  /** Accent palette to offer; the first (empty) entry means "no accent". */
  colors: readonly string[];
  /** The board's shared labels (mutated in place when renamed). */
  labels: Label[];
  /** Palette offered when creating a label or changing its color. */
  labelColors: readonly string[];
  /** Ids of labels currently assigned to this card. */
  assignedLabelIds: string[];
  /** The card's checklist (live reference; re-read after each edit). */
  checklist: ChecklistItem[];
  /** The card's comments, newest first (live reference; re-read after each edit). */
  comments: Comment[];
  /** The card's image attachments (live reference; re-read after each edit). */
  attachments: Attachment[];
  /** Whether the card is a template (blueprint for new cards). */
  isTemplate: boolean;
  /** Id of the column the card currently lives in. */
  columnId: string;
  /** All board columns, offered as move targets. */
  columns: Array<{ id: string; title: string; cardCount: number }>;
}

/** Fields saved when the card detail modal is committed. */
export interface CardDetailPatch {
  text: string;
  description: string;
  startAt: number | null;
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
  /** Recolor a board label (applies everywhere it is used). */
  onRecolorLabel(labelId: string, color: string): void;
  /** Create a new board label. */
  onAddLabel(name: string, color: string): void;
  /** Delete a board label, stripping it from every card. */
  onRemoveLabel(labelId: string): void;
  /** Append a checklist item. */
  onAddChecklistItem(text: string): void;
  /** Toggle a checklist item's done state. */
  onToggleChecklistItem(itemId: string): void;
  /** Rename a checklist item. */
  onRenameChecklistItem(itemId: string, text: string): void;
  /** Remove a checklist item. */
  onRemoveChecklistItem(itemId: string): void;
  /** Attach an image (already read into a data URL). */
  onAddAttachment(name: string, dataUrl: string): void;
  /** Delete an attachment. */
  onRemoveAttachment(attachmentId: string): void;
  /** Add a comment (prepended, newest first). */
  onAddComment(text: string): void;
  /** Replace a comment's text. */
  onEditComment(commentId: string, text: string): void;
  /** Delete a comment. */
  onRemoveComment(commentId: string): void;
  /** Duplicate the card right after the original. */
  onCopy(): void;
  /** Move the card to a column at the given index. */
  onMove(toColumnId: string, toIndex: number): void;
  /** Toggle the card's template flag. */
  onToggleTemplate(): void;
  /** Create a regular card from this template (appended to the list). */
  onCreateFromTemplate(): void;
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

        const recolor = document.createElement('button');
        recolor.className = 'card-detail-label-edit';
        recolor.textContent = '🎨';
        recolor.title = t('color');
        recolor.addEventListener('click', () => {
          void openColorPicker(t('labelColorPrompt'), init.labelColors, label.color).then(
            (color) => {
              if (color === null) return;
              cb.onRecolorLabel(label.id, color);
              renderLabels();
            },
          );
        });

        const remove = document.createElement('button');
        remove.className = 'card-detail-label-edit';
        remove.textContent = '🗑️';
        remove.title = t('delete');
        remove.addEventListener('click', () => {
          void customConfirm(t('deleteLabelConfirm')).then((ok) => {
            if (!ok) return;
            assigned.delete(label.id);
            cb.onRemoveLabel(label.id);
            renderLabels();
          });
        });

        row.append(chip, rename, recolor, remove);
        labelList.appendChild(row);
      }

      // Create a new label: ask for a name, then a color from the palette.
      const add = document.createElement('button');
      add.className = 'card-detail-label-add';
      add.textContent = `➕ ${t('addLabelBtn')}`;
      add.addEventListener('click', () => {
        void customPrompt(t('labelNamePrompt')).then((name) => {
          if (name === null) return;
          void openColorPicker(t('labelColorPrompt'), init.labelColors, '').then((color) => {
            if (color === null) return;
            cb.onAddLabel(name, color);
            renderLabels();
          });
        });
      });
      labelList.appendChild(add);
    };
    renderLabels();

    // --- Start date: a datetime picker with a clear button. ---
    addLabel(t('startDate'));
    const startRow = document.createElement('div');
    startRow.className = 'card-detail-due';

    const startInput = document.createElement('input');
    startInput.className = 'card-detail-due-input';
    startInput.type = 'datetime-local';
    if (init.startAt != null) startInput.value = toLocalInputValue(init.startAt);

    const startClear = document.createElement('button');
    startClear.type = 'button';
    startClear.className = 'card-detail-due-clear';
    startClear.textContent = t('clear');
    startClear.addEventListener('click', () => {
      startInput.value = '';
    });

    startRow.append(startInput, startClear);
    dialog.appendChild(startRow);

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

    // --- Checklist: progress bar + items, all applied immediately. ---
    addLabel(t('checklist'));
    const checklistBox = document.createElement('div');
    checklistBox.className = 'card-detail-checklist';
    dialog.appendChild(checklistBox);

    const renderChecklist = (): void => {
      checklistBox.replaceChildren();
      const items = init.checklist;
      const done = items.filter((i) => i.done).length;

      const bar = document.createElement('div');
      bar.className = 'checklist-progress';
      const fill = document.createElement('div');
      fill.className = 'checklist-progress-fill';
      fill.style.width = items.length ? `${(done / items.length) * 100}%` : '0%';
      const pct = document.createElement('span');
      pct.className = 'checklist-progress-text';
      pct.textContent = `${done}/${items.length}`;
      bar.append(fill);
      const barRow = document.createElement('div');
      barRow.className = 'checklist-progress-row';
      barRow.append(pct, bar);
      checklistBox.appendChild(barRow);

      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'checklist-item';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = item.done;
        check.addEventListener('change', () => {
          cb.onToggleChecklistItem(item.id);
          renderChecklist();
        });

        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'checklist-item-text';
        text.value = item.text;
        if (item.done) text.classList.add('is-done');
        // Commit a rename on blur/Enter, not on every keystroke.
        text.addEventListener('change', () => cb.onRenameChecklistItem(item.id, text.value.trim()));

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'checklist-item-del';
        del.textContent = '🗑️';
        del.title = t('delete');
        del.addEventListener('click', () => {
          cb.onRemoveChecklistItem(item.id);
          renderChecklist();
        });

        row.append(check, text, del);
        checklistBox.appendChild(row);
      }

      const addRow = document.createElement('div');
      addRow.className = 'checklist-add';
      const addInput = document.createElement('input');
      addInput.type = 'text';
      addInput.className = 'checklist-add-input';
      addInput.placeholder = t('checklistItemPlaceholder');
      const addItem = (): void => {
        const value = addInput.value.trim();
        if (!value) return;
        cb.onAddChecklistItem(value);
        renderChecklist();
        // Keep adding: refocus the (rebuilt) input.
        const next = checklistBox.querySelector<HTMLInputElement>('.checklist-add-input');
        next?.focus();
      };
      addInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addItem();
        }
      });
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'checklist-add-btn';
      addBtn.textContent = t('addChecklistItem');
      addBtn.addEventListener('click', addItem);
      addRow.append(addInput, addBtn);
      checklistBox.appendChild(addRow);
    };
    renderChecklist();

    // --- Attachments: image files stored inline as data URLs. ---
    addLabel(t('attachments'));
    const attachBox = document.createElement('div');
    attachBox.className = 'card-detail-attachments';
    dialog.appendChild(attachBox);

    const renderAttachments = (): void => {
      attachBox.replaceChildren();

      for (const att of init.attachments) {
        const row = document.createElement('div');
        row.className = 'attachment-item';

        const thumb = document.createElement('img');
        thumb.className = 'attachment-thumb';
        thumb.src = att.dataUrl;
        thumb.alt = att.name;
        thumb.draggable = false;

        const info = document.createElement('div');
        info.className = 'attachment-info';
        const name = document.createElement('div');
        name.className = 'attachment-name';
        name.textContent = att.name || ' ';
        const date = document.createElement('div');
        date.className = 'attachment-date';
        date.textContent = formatDate(att.createdAt);
        info.append(name, date);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'comment-btn';
        del.textContent = '🗑️';
        del.title = t('delete');
        del.addEventListener('click', () => {
          void customConfirm(t('deleteAttachmentConfirm')).then((ok) => {
            if (!ok) return;
            cb.onRemoveAttachment(att.id);
            renderAttachments();
          });
        });

        row.append(thumb, info, del);
        attachBox.appendChild(row);
      }

      // Hidden file input driven by a visible button; images only, size-capped.
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.hidden = true;
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          void customAlert(t('attachmentNotImage'));
          return;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          void customAlert(t('attachmentTooLarge'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            cb.onAddAttachment(file.name, reader.result);
            renderAttachments();
          }
        };
        reader.readAsDataURL(file);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'attachment-add-btn';
      addBtn.textContent = `📎 ${t('addAttachment')}`;
      addBtn.addEventListener('click', () => fileInput.click());
      attachBox.append(fileInput, addBtn);
    };
    renderAttachments();

    // --- Comments: newest first, add via textarea, edit in place, delete. ---
    addLabel(t('comments'));
    const commentsBox = document.createElement('div');
    commentsBox.className = 'card-detail-comments';
    dialog.appendChild(commentsBox);

    const renderComments = (): void => {
      commentsBox.replaceChildren();

      const addRow = document.createElement('div');
      addRow.className = 'comment-add';
      const addInput = document.createElement('textarea');
      addInput.className = 'comment-add-input';
      addInput.placeholder = t('commentPlaceholder');
      addInput.rows = 2;
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'comment-add-btn';
      addBtn.textContent = t('addComment');
      addBtn.addEventListener('click', () => {
        const value = addInput.value.trim();
        if (!value) return;
        cb.onAddComment(value);
        renderComments();
      });
      addRow.append(addInput, addBtn);
      commentsBox.appendChild(addRow);

      for (const comment of init.comments) {
        const row = document.createElement('div');
        row.className = 'comment-item';

        const meta = document.createElement('div');
        meta.className = 'comment-meta';
        const date = document.createElement('span');
        date.className = 'comment-date';
        date.textContent = formatDate(comment.createdAt);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'comment-btn';
        editBtn.textContent = '✏️';
        editBtn.title = t('edit');

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'comment-btn';
        delBtn.textContent = '🗑️';
        delBtn.title = t('delete');
        delBtn.addEventListener('click', () => {
          void customConfirm(t('deleteCommentConfirm')).then((ok) => {
            if (!ok) return;
            cb.onRemoveComment(comment.id);
            renderComments();
          });
        });

        meta.append(date, editBtn, delBtn);

        const text = document.createElement('div');
        text.className = 'comment-text';
        text.textContent = comment.text;

        // Editing swaps the text for a textarea with explicit save/cancel.
        editBtn.addEventListener('click', () => {
          const editor = document.createElement('textarea');
          editor.className = 'comment-add-input';
          editor.value = comment.text;
          editor.rows = 2;
          const actionsRow = document.createElement('div');
          actionsRow.className = 'comment-edit-actions';
          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'comment-add-btn';
          saveBtn.textContent = t('save');
          saveBtn.addEventListener('click', () => {
            const value = editor.value.trim();
            if (value) cb.onEditComment(comment.id, value);
            renderComments();
          });
          const cancelEdit = document.createElement('button');
          cancelEdit.type = 'button';
          cancelEdit.className = 'comment-btn';
          cancelEdit.textContent = t('cancel');
          cancelEdit.addEventListener('click', () => renderComments());
          actionsRow.append(cancelEdit, saveBtn);
          row.replaceChildren(meta, editor, actionsRow);
          editor.focus();
        });

        row.append(meta, text);
        commentsBox.appendChild(row);
      }
    };
    renderComments();

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

    // --- Actions: copy the card, or move it to another list/position. ---
    addLabel(t('actions'));
    const opsBox = document.createElement('div');
    opsBox.className = 'card-detail-ops';
    dialog.appendChild(opsBox);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'card-detail-op-btn';
    copyBtn.textContent = `📑 ${t('copyCard')}`;

    const moveBtn = document.createElement('button');
    moveBtn.type = 'button';
    moveBtn.className = 'card-detail-op-btn';
    moveBtn.textContent = `📤 ${t('moveCardAction')}`;

    // Template actions: toggle the flag, and (for templates) stamp out a card.
    const templateBtn = document.createElement('button');
    templateBtn.type = 'button';
    templateBtn.className = 'card-detail-op-btn';
    templateBtn.textContent = `📋 ${t(init.isTemplate ? 'removeTemplate' : 'makeTemplate')}`;
    templateBtn.addEventListener('click', () => {
      cb.onToggleTemplate();
      close();
    });

    opsBox.append(copyBtn, moveBtn, templateBtn);

    if (init.isTemplate) {
      const stampBtn = document.createElement('button');
      stampBtn.type = 'button';
      stampBtn.className = 'card-detail-op-btn';
      stampBtn.textContent = `🆕 ${t('createFromTemplate')}`;
      stampBtn.addEventListener('click', () => {
        cb.onCreateFromTemplate();
        close();
      });
      opsBox.appendChild(stampBtn);
    }

    // The move picker: destination list + 1-based position + confirm.
    const moveRow = document.createElement('div');
    moveRow.className = 'card-detail-move';
    moveRow.hidden = true;
    dialog.insertBefore(moveRow, opsBox.nextSibling);

    const listSelect = document.createElement('select');
    listSelect.className = 'control card-detail-move-select';
    listSelect.title = t('list');
    for (const col of init.columns) {
      const option = document.createElement('option');
      option.value = col.id;
      option.textContent = col.title || ' ';
      listSelect.appendChild(option);
    }
    listSelect.value = init.columnId;

    const posSelect = document.createElement('select');
    posSelect.className = 'control card-detail-move-select';
    posSelect.title = t('position');

    // A move within the same list keeps the card count; another list gains one.
    const refreshPositions = (): void => {
      posSelect.replaceChildren();
      const target = init.columns.find((c) => c.id === listSelect.value);
      if (!target) return;
      const count = Math.max(1, target.cardCount + (target.id === init.columnId ? 0 : 1));
      for (let i = 1; i <= count; i++) {
        const option = document.createElement('option');
        option.value = String(i - 1);
        option.textContent = String(i);
        posSelect.appendChild(option);
      }
    };
    refreshPositions();
    listSelect.addEventListener('change', refreshPositions);

    const moveGo = document.createElement('button');
    moveGo.type = 'button';
    moveGo.className = 'comment-add-btn';
    moveGo.textContent = t('move');
    moveRow.append(listSelect, posSelect, moveGo);

    moveBtn.addEventListener('click', () => {
      moveRow.hidden = !moveRow.hidden;
    });
    moveGo.addEventListener('click', () => {
      cb.onMove(listSelect.value, Number(posSelect.value));
      close();
    });
    copyBtn.addEventListener('click', () => {
      cb.onCopy();
      close();
    });

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
        startAt: fromLocalInputValue(startInput.value),
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

/** One already-localized line in the activity view. */
export interface ActivityViewEntry {
  text: string;
  when: number;
}

/** Show the board's recent activity (newest first). Resolves on close. */
export function openActivityLog(entries: ActivityViewEntry[]): Promise<void> {
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
    heading.textContent = t('activityLog');
    dialog.appendChild(heading);

    const listEl = document.createElement('div');
    listEl.className = 'archive-list';
    dialog.appendChild(listEl);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'archive-empty';
      empty.textContent = t('activityEmpty');
      listEl.appendChild(empty);
    }
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'activity-row';
      const text = document.createElement('div');
      text.className = 'activity-text';
      text.textContent = entry.text;
      const when = document.createElement('div');
      when.className = 'activity-when';
      when.textContent = formatDate(entry.when);
      row.append(text, when);
      listEl.appendChild(row);
    }

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

/** One archived item (card or list) as shown in the archive view. */
export interface ArchiveEntry {
  id: string;
  /** Primary text: card text or list title. */
  text: string;
  /** Secondary line: origin column for cards, card count for lists. */
  subtitle: string;
}

/** Callbacks for the archive view. The lists are re-read after every action. */
export interface ArchiveCallbacks {
  listColumns(): ArchiveEntry[];
  listCards(): ArchiveEntry[];
  onRestoreColumn(id: string): void;
  onDeleteColumnForever(id: string): void;
  onRestoreCard(id: string): void;
  onDeleteCardForever(id: string): void;
}

/**
 * Show the board's archive: archived lists and cards, each restorable or
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

    // Build one archive section (lists or cards) with restore/delete actions.
    const renderSection = (
      title: string,
      entries: ArchiveEntry[],
      confirmKey: string,
      onRestore: (id: string) => void,
      onDelete: (id: string) => void,
    ): void => {
      if (entries.length === 0) return;
      const sectionTitle = document.createElement('div');
      sectionTitle.className = 'archive-section-title';
      sectionTitle.textContent = title;
      listEl.appendChild(sectionTitle);

      for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'archive-row';

        const info = document.createElement('div');
        info.className = 'archive-info';
        const text = document.createElement('div');
        text.className = 'archive-text';
        text.textContent = entry.text || ' ';
        info.appendChild(text);
        if (entry.subtitle) {
          const sub = document.createElement('div');
          sub.className = 'archive-origin';
          sub.textContent = entry.subtitle;
          info.appendChild(sub);
        }

        const restore = document.createElement('button');
        restore.className = 'archive-btn archive-restore';
        restore.textContent = t('restore');
        restore.addEventListener('click', () => {
          onRestore(entry.id);
          renderList();
        });

        const del = document.createElement('button');
        del.className = 'archive-btn archive-delete';
        del.textContent = t('deleteForever');
        del.addEventListener('click', () => {
          void customConfirm(t(confirmKey)).then((ok) => {
            if (ok) {
              onDelete(entry.id);
              renderList();
            }
          });
        });

        row.append(info, restore, del);
        listEl.appendChild(row);
      }
    };

    const renderList = (): void => {
      listEl.replaceChildren();
      const columns = cb.listColumns();
      const cards = cb.listCards();
      if (columns.length === 0 && cards.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'archive-empty';
        empty.textContent = t('archiveEmpty');
        listEl.appendChild(empty);
        return;
      }
      renderSection(
        t('archivedLists'),
        columns,
        'deleteListForeverConfirm',
        cb.onRestoreColumn,
        cb.onDeleteColumnForever,
      );
      renderSection(
        t('archivedCards'),
        cards,
        'deleteForeverConfirm',
        cb.onRestoreCard,
        cb.onDeleteCardForever,
      );
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
