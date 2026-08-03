import { resolve } from 'node:path';
import vento from 'ventojs';
import type { FlightSocialPreview } from '../authenticated/adapters/flightDetailView.js';
import type { FlightPageModel } from '../authenticated/models.js';

export type PublicFlightPageModel = {
  page: 'flight';
  title: string;
  socialPreview: FlightSocialPreview;
  flight: FlightPageModel['flight'];
};

export type PublicFlightPageRenderer = (model: PublicFlightPageModel) => Promise<string>;

export function createPublicFlightPageRenderer(): PublicFlightPageRenderer {
  const environment = vento({
    includes: resolve('src/views'),
    autoescape: true,
    strict: true,
  });

  return async (model) => (
    await environment.run('authenticated/pages/flight.vto', {
      isGuest: true,
      pageStylesheet: '/styles/app-ui/flight.css',
      pageScript: '/scripts/app-ui/flight.js',
      showFooter: false,
      ...model,
    })
  ).content;
}
