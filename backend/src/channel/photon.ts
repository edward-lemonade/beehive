import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { receivePhotonMessage, splitSms } from './inbound.js';
import { setSmsSender } from './service.js';

export async function createPhotonAdapter() {
  const app = await Spectrum({
    projectId: config.PHOTON_PROJECT_ID,
    projectSecret: config.PHOTON_PROJECT_SECRET,
    webhookSecret: config.PHOTON_WEBHOOK_SECRET,
    providers: [imessage.config()],
  });
  const provider = imessage(app);

  setSmsSender(async (phone, text, userId) => {
    const recipient = await provider.user(phone);
    const space = await provider.space.create(recipient, { phone: config.PHOTON_PHONE_NUMBER });
    for (const part of splitSms(text)) {
      let sentId: string | undefined;
      for (let attempt = 0; attempt < 3 && !sentId; attempt += 1) {
        try {
          const sent = await space.send(part);
          if (!sent?.id) throw new Error('Photon did not return an outbound message id');
          sentId = sent.id;
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        }
      }
      if (!sentId) throw new Error('Photon did not return an outbound message id');
      await sql`
        INSERT INTO sms_log (provider_id, user_id, phone, direction, body, created_at, status)
        VALUES (${sentId}, ${userId ?? null}, ${phone}, 'outbound', ${part}, ${Date.now()}, 'processed')
        ON CONFLICT (provider_id) DO NOTHING
      `;
    }
  });

  return {
    webhook(request: Request): Promise<Response> {
      return app.webhook(request, (space, message) => receivePhotonMessage(space, message));
    },
    async stop(): Promise<void> {
      await app.stop();
    },
  };
}
