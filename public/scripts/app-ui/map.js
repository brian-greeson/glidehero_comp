import { initializeFlightMap } from './mapFlightBrowser.js';
import { initializeMapSheet } from './mapSheet.js';
import { initializeStyledSelects } from './styledSelect.js';

export { initializeMapSheet } from './mapSheet.js';
export { initializeFlightMap } from './mapFlightBrowser.js';
export { initializeStyledSelects } from './styledSelect.js';

export function initializeMapUrlControls({
  documentRef = document,
  locationRef = globalThis.location,
  historyRef = globalThis.history,
  now = () => new Date(),
} = {}) {
  void documentRef; void historyRef; void now;
  const query = new URLSearchParams(locationRef?.search ?? '');
  return { period: query.get('period') ?? 'month', anchor: query.get('anchor') ?? query.get('month') };
}

export function initializeMapPage(options = {}) {
  const documentRef = options.documentRef ?? document;
  initializeMapSheet({ documentRef });
  initializeStyledSelects({ documentRef });
  return initializeFlightMap({ ...options, documentRef });
}

if (typeof document !== 'undefined') initializeMapPage();
