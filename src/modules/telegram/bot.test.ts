import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  env: {
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_ADMIN_CHAT_ID: '123456789',
  },
}));

describe('telegram bot', () => {
  it('exports bot instance and sendNotification function', async () => {
    const telegram = await import('./index.js');

    expect(telegram.bot).toBeDefined();
    expect(telegram.sendNotification).toBeDefined();
    expect(typeof telegram.sendNotification).toBe('function');
  });
});
