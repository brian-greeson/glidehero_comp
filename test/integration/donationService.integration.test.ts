import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { donations } from '../../src/db/schema.js';
import { createDonationService } from '../../src/services/donationService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE donations');
});

afterAll(async () => {
  if (database) await database.pool.end();
});

describe('donation persistence with PostgreSQL', () => {
  it('records each message once and excludes verification_token from payload', async () => {
    const service = createDonationService(database.db);
    const input = {
      messageId: "integration-message'); DROP TABLE donations; --",
      kofiTransactionId: null,
      paymentTimestamp: new Date('2026-07-21T12:00:00.000Z'),
      paymentType: 'Donation',
      amount: '12.34',
      currency: 'USD',
      isPublic: true,
      isSubscriptionPayment: false,
      isFirstSubscriptionPayment: false,
      payload: {
        message_id: "integration-message'); DROP TABLE donations; --",
        verification_token: 'secret-that-must-not-persist',
        future_field: 'retained',
        from_name: "Pilot'); DROP TABLE users; --",
        message: "Supporter's flight; SELECT * FROM users;",
      },
    };

    await expect(service.record(input)).resolves.toEqual({ status: 'recorded' });
    await expect(service.record(input)).resolves.toEqual({ status: 'duplicate' });

    const [row] = await database.db.select().from(donations).where(eq(donations.messageId, input.messageId));
    expect(row).toMatchObject({ messageId: input.messageId, amount: '12.34', currency: 'USD' });
    expect(row?.payload).toEqual({
      message_id: input.messageId,
      future_field: 'retained',
      from_name: "Pilot'); DROP TABLE users; --",
      message: "Supporter's flight; SELECT * FROM users;",
    });
    expect(await database.db.select().from(donations)).toHaveLength(1);
  });
});
