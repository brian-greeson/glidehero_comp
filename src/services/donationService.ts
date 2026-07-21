import type { Database } from '../db/client.js';
import { donations } from '../db/schema.js';

export type DonationRecordInput = {
  messageId: string;
  kofiTransactionId?: string | null;
  paymentTimestamp: Date;
  paymentType: string;
  amount: string | number;
  currency: string;
  isPublic: boolean;
  isSubscriptionPayment: boolean;
  isFirstSubscriptionPayment: boolean;
  payload: Record<string, unknown>;
  receivedAt?: Date;
};

export type DonationService = {
  record(input: DonationRecordInput): Promise<{ status: 'recorded' | 'duplicate' }>;
};

function withoutVerificationToken(payload: Record<string, unknown>): Record<string, unknown> {
  const { verification_token: _verificationToken, ...sanitized } = payload;
  return sanitized;
}

export function createDonationService(database: Pick<Database, 'insert'>): DonationService {
  return {
    async record(input) {
      const [inserted] = await database
        .insert(donations)
        .values({
          messageId: input.messageId,
          kofiTransactionId: input.kofiTransactionId ?? null,
          paymentTimestamp: input.paymentTimestamp,
          paymentType: input.paymentType,
          amount: String(input.amount),
          currency: input.currency,
          isPublic: input.isPublic,
          isSubscriptionPayment: input.isSubscriptionPayment,
          isFirstSubscriptionPayment: input.isFirstSubscriptionPayment,
          payload: withoutVerificationToken(input.payload),
          ...(input.receivedAt === undefined ? {} : { receivedAt: input.receivedAt }),
        })
        .onConflictDoNothing({ target: donations.messageId })
        .returning({ id: donations.id });

      return { status: inserted ? 'recorded' : 'duplicate' };
    },
  };
}
