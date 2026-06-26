// Custom modal dialogs that replace the browser's native alert/confirm/prompt.
// They are promise-based, keyboard-accessible (Enter/Escape), close on backdrop
// click, and use only the DOM (no external library).
import { getLanguage, t } from './i18n.js';
function openModal(opts) {
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
        let input = null;
        if (opts.kind === 'prompt') {
            input = document.createElement('input');
            input.className = 'modal-input';
            input.type = 'text';
            input.value = opts.defaultValue ?? '';
            dialog.appendChild(input);
        }
        const cancelValue = opts.kind === 'confirm' ? false : null;
        const okValue = () => {
            if (opts.kind === 'confirm')
                return true;
            if (opts.kind === 'prompt')
                return input ? input.value : '';
            return null;
        };
        let settled = false;
        const close = (result) => {
            if (settled)
                return;
            settled = true;
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(cancelValue);
            }
            else if (e.key === 'Enter') {
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
            if (e.target === overlay)
                close(cancelValue);
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        if (input) {
            input.focus();
            input.select();
        }
        else {
            okBtn.focus();
        }
    });
}
/** Custom replacement for window.alert. */
export function customAlert(message) {
    return openModal({ kind: 'alert', message }).then(() => undefined);
}
/** Custom replacement for window.confirm. */
export function customConfirm(message) {
    return openModal({ kind: 'confirm', message }).then((r) => r === true);
}
/** Custom replacement for window.prompt. Resolves null if cancelled. */
export function customPrompt(message, defaultValue = '') {
    return openModal({ kind: 'prompt', message, defaultValue }).then((r) => typeof r === 'string' ? r : null);
}
/** Format a timestamp using the active language's locale. */
function formatDate(ts) {
    const locale = getLanguage() === 'en' ? 'en-US' : 'ko-KR';
    return new Date(ts).toLocaleString(locale);
}
/**
 * Open the "back of the card": an editable title + free-form description, an
 * accent color picker and a delete action. Resolves when the dialog closes.
 */
export function openCardDetail(init, cb) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'modal-dialog card-detail';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        overlay.appendChild(dialog);
        const addLabel = (text) => {
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
        const renderLabels = () => {
            labelList.replaceChildren();
            for (const label of init.labels) {
                const row = document.createElement('div');
                row.className = 'card-detail-label-row';
                const chip = document.createElement('button');
                chip.className = 'card-detail-label-chip';
                chip.style.background = label.color;
                const on = assigned.has(label.id);
                if (on)
                    chip.classList.add('is-on');
                chip.textContent = (on ? '✓ ' : '') + (label.name || '');
                chip.addEventListener('click', () => {
                    if (assigned.has(label.id))
                        assigned.delete(label.id);
                    else
                        assigned.add(label.id);
                    cb.onToggleLabel(label.id);
                    renderLabels();
                });
                const rename = document.createElement('button');
                rename.className = 'card-detail-label-edit';
                rename.textContent = '✏️';
                rename.title = t('rename');
                rename.addEventListener('click', () => {
                    void customPrompt(t('labelNamePrompt'), label.name).then((name) => {
                        if (name === null)
                            return;
                        cb.onRenameLabel(label.id, name); // mutates the shared label object
                        renderLabels();
                    });
                });
                row.append(chip, rename);
                labelList.appendChild(row);
            }
        };
        renderLabels();
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
            if (!color)
                swatch.classList.add('is-none'); // shows a "no color" hint
            if (color === selectedColor)
                swatch.classList.add('is-selected');
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
        const close = () => {
            if (settled)
                return;
            settled = true;
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve();
        };
        const save = () => {
            cb.onSave({
                text: title.value.trim(),
                description: desc.value.trim(),
                color: selectedColor,
            });
            close();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };
        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'modal-btn card-detail-delete';
        deleteBtn.textContent = `🗑️ ${t('delete')}`;
        deleteBtn.addEventListener('click', () => {
            void customConfirm(t('deleteCardConfirm')).then((ok) => {
                if (ok) {
                    cb.onDelete();
                    close();
                }
            });
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'modal-btn modal-cancel';
        cancelBtn.textContent = t('cancel');
        cancelBtn.addEventListener('click', () => close());
        const okBtn = document.createElement('button');
        okBtn.className = 'modal-btn modal-ok';
        okBtn.textContent = t('save');
        okBtn.addEventListener('click', () => save());
        actions.append(deleteBtn, cancelBtn, okBtn);
        dialog.appendChild(actions);
        overlay.addEventListener('pointerdown', (e) => {
            if (e.target === overlay)
                close();
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        title.focus();
    });
}
