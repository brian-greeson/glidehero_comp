import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { donations } from '../../src/db/schema.js';

describe('donation persistence schema', () => {
  it('stores the normalized Ko-fi fields and immutable payload', () => {
    const config = getTableConfig(donations);
    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'message_id', 'kofi_transaction_id', 'payment_timestamp', 'payment_type',
      'amount', 'currency', 'is_public', 'is_subscription_payment',
      'is_first_subscription_payment', 'payload', 'received_at',
    ]);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toEqual([
      'donations_message_id_unique',
    ]);
    expect(config.indexes.map((index) => index.config.name)).toContain('donations_kofi_transaction_id_idx');
    expect(config.checks.map((constraint) => constraint.name)).toContain('donations_amount_nonnegative');
  });
});
