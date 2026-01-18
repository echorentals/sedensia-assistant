import { FastifyInstance } from 'fastify';
import {
  handleGmailWebhook,
  processEmailMessage,
  type PubSubMessage,
} from '../modules/gmail/webhook.js';
import { listRecentMessages, extractEmailContent } from '../modules/gmail/index.js';
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
    // List recent messages with their IDs
    fastify.get('/dev/messages', async (_request, reply) => {
      try {
        const messages = await listRecentMessages(5);
        const simplified = messages.map((msg) => {
          const { from, subject } = extractEmailContent(msg);
          return {
            id: msg.id,
            from,
            subject,
            snippet: msg.snippet?.substring(0, 100),
          };
        });
        return reply.send({ messages: simplified });
      } catch (error) {
        console.error('List messages error:', error);
        return reply.status(500).send({ error: String(error) });
      }
    });

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
