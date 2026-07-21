import { describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { createDonationService, type DonationRecordInput } from '../../src/services/donationService.js';

function input(): DonationRecordInput {
  return {
    messageId: 'message-1',
    kofiTransactionId: 'transaction-1',
    paymentTimestamp: new Date('2026-07-21T12:00:00.000Z'),
    paymentType: 'Donation',
    amount: '12.34',
    currency: 'USD',
    isPublic: true,
    isSubscriptionPayment: false,
    isFirstSubscriptionPayment: false,
    payload: {
      message_id: 'message-1',
      verification_token: 'do-not-store',
      from_name: 'Pilot',
    },
  };
}

function databaseReturning(rows: unknown[]) {
  const calls: unknown[] = [];
  const database = {
    insert(table: unknown) {
      calls.push(table);
      return {
        values(values: unknown) {
          calls.push(values);
          return {
            onConflictDoNothing(options: unknown) {
              calls.push(options);
              return {
                returning: async () => rows,
              };
            },
          };
        },
      };
    },
  };
  return { database, calls };
}

describe('donation service', () => {
  it('records a donation and removes verification_token from payload', async () => {
    const { database, calls } = databaseReturning([{ id: 'donation-id' }]);
    await expect(createDonationService(database as Pick<Database, 'insert'>).record(input())).resolves.toEqual({ status: 'recorded' });

    expect(calls[1]).toMatchObject({ messageId: 'message-1' });
    expect((calls[1] as { payload: Record<string, unknown> }).payload).toEqual({
      message_id: 'message-1',
      from_name: 'Pilot',
    });
  });

  it('reports a duplicate message without requiring a second write', async () => {
    const { database, calls } = databaseReturning([]);
    await expect(createDonationService(database as Pick<Database, 'insert'>).record(input())).resolves.toEqual({ status: 'duplicate' });
    expect(calls[2]).toMatchObject({ target: expect.anything() });
  });
});
