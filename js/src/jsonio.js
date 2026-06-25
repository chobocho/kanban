// Import/export of the whole application state as a single JSON document.
// Importing always runs through normalization so a malformed file cannot break
// the app.
import { normalizeAppData } from './normalize.js';
/** Download the entire app state as a JSON file. */
export function downloadJson(data, filename = 'kanban-data.json') {
    const text = JSON.stringify(data, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
/** Parse JSON text into a valid AppData. Throws if the text is not JSON. */
export function parseJson(text) {
    const raw = JSON.parse(text);
    return normalizeAppData(raw);
}
/** Read a File chosen by the user and resolve to a valid AppData. */
export function readJsonFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                resolve(parseJson(String(reader.result)));
            }
            catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}
