import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { DonationService } from '../services/donationService.js';

const MAX_FORM_DATA_LENGTH = 16 * 1024;
const boundedText = (max: number) => z.string().min(1).max(max);
const paymentType = z.string().trim().min(1).max(64);
const amount = z.union([z.string(), z.number().finite()])
  .transform(String)
  .refine((value) => /^\d{1,10}(?:\.\d{1,2})?$/.test(value));

const donationPayloadSchema = z.object({
  verification_token: boundedText(256),
  message_id: boundedText(256),
  timestamp: z.string().datetime({ offset: true }),
  type: paymentType,
  amount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  is_public: z.boolean(),
  is_subscription_payment: z.boolean(),
  is_first_subscription_payment: z.boolean(),
  kofi_transaction_id: z.string().min(1).max(256).nullable().optional().default(null),
}).passthrough();

const formSchema = z.object({
  data: z.string().min(1).max(MAX_FORM_DATA_LENGTH),
}).strict();

function invalidRequest(res: Response): void {
  res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid donation webhook.' } });
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function createDonationRouter(dependencies: {
  donations: DonationService;
  verificationToken: string;
}) {
  const router = Router();

  router.post('/donations/received-webhook', async (req: Request, res: Response) => {
    if (req.is('application/x-www-form-urlencoded') !== 'application/x-www-form-urlencoded') {
      invalidRequest(res);
      return;
    }

    const form = formSchema.safeParse(req.body);
    if (!form.success) {
      invalidRequest(res);
      return;
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(form.data.data);
    } catch {
      invalidRequest(res);
      return;
    }
    const parsed = donationPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      invalidRequest(res);
      return;
    }
    if (!tokensMatch(parsed.data.verification_token, dependencies.verificationToken)) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid verification token.' } });
      return;
    }

    const { verification_token: _verificationToken, ...payload } = rawPayload as Record<string, unknown>;
    const result = await dependencies.donations.record({
      messageId: parsed.data.message_id,
      kofiTransactionId: parsed.data.kofi_transaction_id,
      paymentTimestamp: new Date(parsed.data.timestamp),
      paymentType: parsed.data.type,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      isPublic: parsed.data.is_public,
      isSubscriptionPayment: parsed.data.is_subscription_payment,
      isFirstSubscriptionPayment: parsed.data.is_first_subscription_payment,
      payload,
    });
    res.status(200).json(result);
  });

  return router;
}
