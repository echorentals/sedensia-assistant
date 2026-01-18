import { FastifyInstance } from 'fastify';
import { handleGmailWebhook, type PubSubMessage } from '../modules/gmail/webhook.js';

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Gmail Pub/Sub webhook
  fastify.post<{ Body: PubSubMessage }>('/webhooks/gmail', async (request, reply) => {
    try {
      await handleGmailWebhook(request.body);
      return reply.status(200).send({ ok: true });
    } catch (error) {
      console.error('Gmail webhook error:', error);
      // Always return 200 to Pub/Sub to prevent retries on processing errors
      return reply.status(200).send({ ok: false });
    }
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
}
