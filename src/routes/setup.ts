import { FastifyInstance } from 'fastify';
import { setupGmailWatch, getWatchState } from '../modules/gmail/watch.js';
import { sendSimpleMessage } from '../modules/telegram/index.js';
import { importHistoricalEstimates } from '../modules/quickbooks/index.js';

export async function setupRoutes(fastify: FastifyInstance): Promise<void> {
  // Set up Gmail Pub/Sub watch
  fastify.post('/setup/gmail-watch', async (request, reply) => {
    const result = await setupGmailWatch();

    if (result) {
      await sendSimpleMessage(
        `Gmail watch established\n\nHistory ID: ${result.historyId}\nExpires: ${result.expiration.toISOString()}`
      );
      return reply.send({
        success: true,
        historyId: result.historyId,
        expiration: result.expiration,
      });
    }

    return reply.status(500).send({ success: false, error: 'Failed to set up watch' });
  });

  // Check current watch status
  fastify.get('/setup/gmail-watch/status', async (request, reply) => {
    const state = await getWatchState();

    if (!state) {
      return reply.send({ active: false });
    }

    const expiration = new Date(state.expiration);
    const isExpired = expiration < new Date();

    return reply.send({
      active: !isExpired,
      historyId: state.historyId,
      expiration: state.expiration,
      isExpired,
    });
  });

  // Import historical estimates from QuickBooks
  fastify.post('/setup/quickbooks/import', async (request, reply) => {
    try {
      const result = await importHistoricalEstimates();

      await sendSimpleMessage(
        `QuickBooks import complete\n\nImported: ${result.imported}\nSkipped: ${result.skipped}\nErrors: ${result.errors}`
      );

      return reply.send(result);
    } catch (error) {
      console.error('Import failed:', error);
      return reply.status(500).send({ error: String(error) });
    }
  });
}
