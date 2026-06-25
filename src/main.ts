// Entry point: construct the app and start it once the DOM is ready.

import { KanbanApp } from './app.js';

function boot(): void {
  const app = new KanbanApp(document);
  void app.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
