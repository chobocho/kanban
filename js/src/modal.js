// Custom modal dialogs that replace the browser's native alert/confirm/prompt.
// They are promise-based, keyboard-accessible (Enter/Escape), close on backdrop
// click, and use only the DOM (no external library).
import { t } from './i18n.js';
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
