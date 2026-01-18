import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/index.js';
import { webhookRoutes } from './routes/webhooks.js';
import { authRoutes } from './routes/auth.js';
import { bot } from './modules/telegram/index.js';

async function main() {
  const fastify = Fastify({
    logger: true,
  });

  // Register plugins
  await fastify.register(cors, {
    origin: true,
  });

  // Register routes
  await fastify.register(webhookRoutes);
  await fastify.register(authRoutes);

  // Setup Telegram bot commands
  bot.command('start', (ctx) => {
    ctx.reply('Sedensia Assistant is running. I will notify you of new estimate requests.');
  });

  bot.command('status', (ctx) => {
    ctx.reply('✅ Bot is online and monitoring for estimate requests.');
  });

  // Handle callback queries (for future phases)
  bot.on('callback_query', async (ctx) => {
    const callbackQuery = ctx.callbackQuery;
    if ('data' in callbackQuery && callbackQuery.data?.startsWith('create_estimate:')) {
      const messageId = callbackQuery.data.replace('create_estimate:', '');
      await ctx.answerCbQuery('Estimate creation will be available in Phase 2');
      await ctx.reply(`📋 Estimate creation for message ${messageId} - Coming in Phase 2!`);
    }
  });

  // Start Telegram bot (polling for development)
  if (env.NODE_ENV === 'development') {
    bot.launch();
    console.log('Telegram bot started in polling mode');
  }

  // Start HTTP server
  try {
    await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`Server listening on port ${env.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    bot.stop('SIGTERM');
    await fastify.close();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(console.error);
