import { FastifyInstance } from 'fastify';
import {
  handleGmailWebhook,
  processEmailMessage,
  type PubSubMessage,
} from '../modules/gmail/webhook.js';
import { env } from '../config/index.js';

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

  // Development: manually trigger email processing
  if (env.NODE_ENV === 'development') {
    fastify.post<{ Body: { messageId: string } }>(
      '/dev/process-email',
      async (request, reply) => {
        const { messageId } = request.body;

        if (!messageId) {
          return reply.status(400).send({ error: 'messageId required' });
        }

        try {
          const processed = await processEmailMessage(messageId);
          return reply.send({ processed, messageId });
        } catch (error) {
          console.error('Email processing error:', error);
          return reply.status(500).send({ error: String(error) });
        }
      }
    );
  }

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
}
