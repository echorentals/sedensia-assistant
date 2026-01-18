import { Telegraf, Markup } from 'telegraf';
import { env } from '../../config/index.js';

export const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

export interface EstimateRequestNotification {
  from: string;
  company: string;
  subject: string;
  items: Array<{
    signType: string;
    quantity: number;
    size: string;
  }>;
  specialRequests: string[];
  gmailMessageId: string;
}

export async function sendNotification(notification: EstimateRequestNotification): Promise<void> {
  const itemsList = notification.items
    .map((item) => `• ${item.signType} - ${item.quantity} pcs - ${item.size}`)
    .join('\n');

  const specialRequestsList = notification.specialRequests.length > 0
    ? `\n\nSpecial Requests:\n${notification.specialRequests.map((r) => `• ${r}`).join('\n')}`
    : '';

  const message = `📬 New Estimate Request from ${notification.company}

From: ${notification.from}
Subject: ${notification.subject}

Signs Requested:
${itemsList}${specialRequestsList}`;

  await bot.telegram.sendMessage(
    env.TELEGRAM_ADMIN_CHAT_ID,
    message,
    Markup.inlineKeyboard([
      [
        Markup.button.url('View Email', `https://mail.google.com/mail/u/0/#inbox/${notification.gmailMessageId}`),
        Markup.button.callback('Create Estimate', `create_estimate:${notification.gmailMessageId}`),
      ],
    ])
  );
}

export async function sendAuthAlert(provider: 'gmail' | 'quickbooks', authUrl: string): Promise<void> {
  const providerName = provider === 'gmail' ? 'Gmail' : 'QuickBooks';

  await bot.telegram.sendMessage(
    env.TELEGRAM_ADMIN_CHAT_ID,
    `⚠️ ${providerName} authorization expired\n\n${providerName} access has been revoked or expired.\nPlease re-authorize to continue.`,
    Markup.inlineKeyboard([
      [Markup.button.url(`Re-authorize ${providerName}`, authUrl)],
    ])
  );
}

export async function sendSimpleMessage(message: string): Promise<void> {
  await bot.telegram.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, message);
}
