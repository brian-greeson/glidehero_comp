import { initializeFlightDetailMap } from '../flightDetailMap.js';
import { initializeMapSheet } from './mapSheet.js';

export { initializeFlightDetailMap };

if (typeof document !== 'undefined') {
  initializeMapSheet({ documentRef: document });
  initializeFlightDetailMap();
}
