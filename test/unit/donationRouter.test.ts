import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { DonationService } from '../../src/services/donationService.js';
import { createDonationRouter } from '../../src/routes/donationRouter.js';
import { withServer } from '../support/http.js';

const token = 'webhook-secret';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    verification_token: token,
    message_id: 'message-1',
    timestamp: '2026-07-21T12:00:00.000Z',
    type: 'Donation',
    amount: '12.34',
    currency: 'USD',
    is_public: true,
    is_subscription_payment: false,
    is_first_subscription_payment: false,
    kofi_transaction_id: null,
    from_name: "Robert'); DROP TABLE donations; --",
    message: "hello'); DROP TABLE users; --",
    ...overrides,
  };
}

function setup(record: DonationService['record'] = vi.fn(async () => ({ status: 'recorded' as const }))) {
  const donations: DonationService = { record };
  const app = createApp({ webMiddleware: [createDonationRouter({ donations, verificationToken: token })] });
  return { app, record };
}

async function post(baseUrl: string, value: unknown, contentType = 'application/x-www-form-urlencoded') {
  const body = new URLSearchParams({ data: typeof value === 'string' ? value : JSON.stringify(value) });
  return fetch(`${baseUrl}/donations/received-webhook`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

describe('donation webhook router', () => {
  it('validates and forwards a donation while retaining unknown fields except the token', async () => {
    const record = vi.fn(async () => ({ status: 'recorded' as const }));
    const { app } = setup(record);
    await withServer(app, async (baseUrl) => {
      const response = await post(baseUrl, payload({ future_field: { enabled: true } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'recorded' });
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1', paymentType: 'Donation', amount: '12.34', currency: 'USD',
      payload: expect.objectContaining({
        from_name: "Robert'); DROP TABLE donations; --",
        message: "hello'); DROP TABLE users; --",
        future_field: { enabled: true },
      }),
    }));
    const firstCall = (record as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { payload: Record<string, unknown> };
    expect(firstCall.payload).toEqual({
      message_id: 'message-1',
      timestamp: '2026-07-21T12:00:00.000Z',
      type: 'Donation',
      amount: '12.34',
      currency: 'USD',
      is_public: true,
      is_subscription_payment: false,
      is_first_subscription_payment: false,
      kofi_transaction_id: null,
      from_name: "Robert'); DROP TABLE donations; --",
      message: "hello'); DROP TABLE users; --",
      future_field: { enabled: true },
    });
  });

  it('returns 200 for idempotent duplicates', async () => {
    const { app } = setup(vi.fn(async () => ({ status: 'duplicate' as const })));
    await withServer(app, async (baseUrl) => {
      const response = await post(baseUrl, payload());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'duplicate' });
    });
  });

  it('rejects invalid tokens without writing', async () => {
    const record = vi.fn(async () => ({ status: 'recorded' as const }));
    const { app } = setup(record);
    await withServer(app, async (baseUrl) => {
      const response = await post(baseUrl, payload({ verification_token: 'wrong' }));
      expect(response.status).toBe(401);
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects malformed, missing, and wrong-content-type requests', async () => {
    const { app } = setup();
    await withServer(app, async (baseUrl) => {
      expect((await post(baseUrl, '{not-json')).status).toBe(400);
      expect((await fetch(`${baseUrl}/donations/received-webhook`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '',
      })).status).toBe(400);
      const wrongContentType = await fetch(`${baseUrl}/donations/received-webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: JSON.stringify(payload()) }),
      });
      expect(wrongContentType.status).toBe(400);
      const malformedBody = await fetch(`${baseUrl}/donations/received-webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
      });
      expect(malformedBody.status).toBe(400);
      expect(await malformedBody.json()).toEqual({ error: { code: 'invalid_request', message: 'Invalid request.' } });
      expect((await post(baseUrl, payload({ amount: '1.234' }))).status).toBe(400);
      expect((await post(baseUrl, payload({ currency: 'usd' }))).status).toBe(400);
    });
  });

  it('passes persistence failures to the API error handler', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = setup(vi.fn(async () => { throw new Error('database unavailable'); }));
    try {
      await withServer(app, async (baseUrl) => {
        const response = await post(baseUrl, payload());
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: { code: 'server_error', message: 'Internal server error.' } });
        expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'database unavailable' }));
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
