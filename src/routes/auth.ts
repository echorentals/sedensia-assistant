import { FastifyInstance } from 'fastify';
import { getAuthUrl, handleAuthCallback } from '../modules/gmail/index.js';
import { getAuthUrl as getQBAuthUrl, handleAuthCallback as handleQBCallback } from '../modules/quickbooks/index.js';
import { sendSimpleMessage } from '../modules/telegram/index.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Gmail OAuth - initiate
  fastify.get('/auth/gmail/authorize', async (request, reply) => {
    const authUrl = getAuthUrl();
    return reply.redirect(authUrl);
  });

  // Gmail OAuth - callback
  fastify.get<{ Querystring: { code?: string; error?: string } }>(
    '/auth/gmail/callback',
    async (request, reply) => {
      const { code, error } = request.query;

      if (error) {
        return reply.status(400).send({ error: 'OAuth authorization failed', details: error });
      }

      if (!code) {
        return reply.status(400).send({ error: 'Missing authorization code' });
      }

      try {
        await handleAuthCallback(code);
        await sendSimpleMessage('✅ Gmail authorized successfully');

        return reply.type('text/html').send(`
          <!DOCTYPE html>
          <html>
            <head><title>Authorization Successful</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ Gmail Authorized</h1>
              <p>You can close this window and return to Telegram.</p>
            </body>
          </html>
        `);
      } catch (err) {
        console.error('OAuth callback error:', err);
        return reply.status(500).send({ error: 'Failed to complete authorization' });
      }
    }
  );

  // QuickBooks OAuth - initiate
  fastify.get('/auth/quickbooks/authorize', async (request, reply) => {
    const authUrl = getQBAuthUrl();
    return reply.redirect(authUrl);
  });

  // QuickBooks OAuth - callback
  fastify.get<{ Querystring: { code?: string; state?: string; realmId?: string; error?: string } }>(
    '/auth/quickbooks/callback',
    async (request, reply) => {
      const { code, realmId, error } = request.query;

      if (error) {
        return reply.status(400).send({ error: 'OAuth authorization failed', details: error });
      }

      if (!code || !realmId) {
        return reply.status(400).send({ error: 'Missing authorization code or realmId' });
      }

      try {
        await handleQBCallback(code, realmId);
        await sendSimpleMessage('✅ QuickBooks authorized successfully');

        return reply.type('text/html').send(`
          <!DOCTYPE html>
          <html>
            <head><title>Authorization Successful</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ QuickBooks Authorized</h1>
              <p>Company ID: ${realmId}</p>
              <p>You can close this window and return to Telegram.</p>
            </body>
          </html>
        `);
      } catch (err) {
        console.error('QuickBooks OAuth callback error:', err);
        return reply.status(500).send({ error: 'Failed to complete authorization' });
      }
    }
  );
}
