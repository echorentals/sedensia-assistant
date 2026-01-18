import { Telegraf, Markup } from 'telegraf';
import { env } from '../../config/index.js';
import type { PricedItem } from '../pricing/index.js';
import { t, formatStatusInquiry, formatNoMatch, formatMultipleMatches } from './i18n.js';
import { getUserLanguage } from '../../db/index.js';
import type { JobMatch } from '../jobs/index.js';

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

export interface PricedEstimateNotification {
  from: string;
  company: string;
  subject: string;
  items: PricedItem[];
  specialRequests: string[];
  estimateId: string;
  gmailMessageId: string;
}

export async function sendPricedEstimateNotification(notification: PricedEstimateNotification): Promise<void> {
  const itemsList = notification.items
    .map((item, idx) => {
      const confidenceIcon = item.confidence === 'high' ? '⭐' : item.confidence === 'medium' ? '📊' : '⚠️';
      const confidenceText = item.confidence === 'high'
        ? `${item.sampleSize} jobs, ${Math.round(item.winRate * 100)}% win`
        : item.confidence === 'medium'
        ? `${item.sampleSize} jobs`
        : item.priceSource === 'minimum' ? 'min price' : 'base formula';

      return `${idx + 1}. ${item.signType} ${item.width}"×${item.height}"${item.material ? ` (${item.material})` : ''}
   Qty: ${item.quantity} × $${item.suggestedUnitPrice.toLocaleString()} = $${item.suggestedTotal.toLocaleString()}
   ${confidenceIcon} ${confidenceText}`;
    })
    .join('\n\n');

  const total = notification.items.reduce((sum, item) => sum + item.suggestedTotal, 0);

  const specialRequestsList = notification.specialRequests.length > 0
    ? `\n\n📝 Special Requests:\n${notification.specialRequests.map((r) => `• ${r}`).join('\n')}`
    : '';

  const message = `📋 New Estimate Request

From: ${notification.from} (${notification.company})
Subject: ${notification.subject}

${itemsList}

━━━━━━━━━━━━━━━━━━━━
Total: $${total.toLocaleString()}${specialRequestsList}`;

  await bot.telegram.sendMessage(
    env.TELEGRAM_ADMIN_CHAT_ID,
    message,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('✓ Approve', `approve_estimate:${notification.estimateId}`),
        Markup.button.callback('✏️ Edit', `edit_estimate:${notification.estimateId}`),
        Markup.button.callback('✗ Reject', `reject_estimate:${notification.estimateId}`),
      ],
      [
        Markup.button.url('View Email', `https://mail.google.com/mail/u/0/#inbox/${notification.gmailMessageId}`),
      ],
    ])
  );
}

export interface StatusInquiryNotificationData {
  telegramUserId?: string;
  contact: { name: string; company: string | null };
  subject: string;
  gmailMessageId: string;
  matchedJob?: JobMatch;
  multipleMatches?: JobMatch[];
  noMatch?: boolean;
  searchTerms?: string;
  draftResponse?: string;
}

export async function sendStatusInquiryNotification(data: StatusInquiryNotificationData): Promise<void> {
  try {
    const lang = data.telegramUserId
      ? await getUserLanguage(data.telegramUserId)
      : 'ko';

    if (data.noMatch) {
      const message = formatNoMatch(lang, data.searchTerms || '');
      await bot.telegram.sendMessage(
        env.TELEGRAM_ADMIN_CHAT_ID,
        message,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(t(lang, 'newEstimate'), `status_new_estimate:${data.gmailMessageId}`),
            Markup.button.callback(t(lang, 'ignore'), `status_ignore:${data.gmailMessageId}`),
          ],
        ])
      );
      return;
    }

    if (data.multipleMatches && data.multipleMatches.length > 1) {
      const message = formatMultipleMatches(lang, {
        company: data.contact.company || '',
        matches: data.multipleMatches.map(m => ({
          jobId: m.job.id,
          description: m.job.description,
          date: new Date(m.job.created_at).toLocaleDateString(),
        })),
      });

      const buttons = data.multipleMatches.map((m, i) =>
        [Markup.button.callback(`${i + 1} ${t(lang, 'select')}`, `status_select:${m.job.id}:${data.gmailMessageId}`)]
      );

      await bot.telegram.sendMessage(
        env.TELEGRAM_ADMIN_CHAT_ID,
        message,
        Markup.inlineKeyboard(buttons)
      );
      return;
    }

    if (data.matchedJob && data.draftResponse) {
      const message = formatStatusInquiry(lang, {
        company: data.contact.company || '',
        from: data.contact.name,
        subject: data.subject,
        jobId: data.matchedJob.job.id,
        stage: data.matchedJob.job.stage,
        eta: data.matchedJob.job.eta,
        draftResponse: data.draftResponse,
      });

      const callbackData = `${data.matchedJob.job.id}:${data.gmailMessageId}`;

      await bot.telegram.sendMessage(
        env.TELEGRAM_ADMIN_CHAT_ID,
        message,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(t(lang, 'send'), `status_send:${callbackData}`),
            Markup.button.callback(t(lang, 'edit'), `status_edit:${callbackData}`),
            Markup.button.callback(t(lang, 'ignore'), `status_ignore:${data.gmailMessageId}`),
          ],
        ])
      );
      return;
    }

    // Edge case: matchedJob exists but no draft response
    if (data.matchedJob) {
      console.warn('Status inquiry notification called with matchedJob but no draftResponse');
    }
  } catch (error) {
    console.error('Failed to send status inquiry notification:', error);
    throw error;
  }
}
