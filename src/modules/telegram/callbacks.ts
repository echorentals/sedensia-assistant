import { Markup } from 'telegraf';
import { bot } from './bot.js';
import {
  getEstimateById,
  updateEstimateStatus,
  updateEstimateItems,
  type Estimate,
  recordPricingHistory,
  updatePricingOutcome,
  getPendingEstimates,
  getRecentEstimates,
  createJob,
  getActiveJobs,
  findJobByPrefix,
  updateJobStage,
  updateJobEta,
  getTelegramUser,
  upsertTelegramUser,
  setUserLanguage,
} from '../../db/index.js';
import {
  createEstimate as createQBEstimate,
  findCustomerByName,
} from '../quickbooks/index.js';
import { getMessage, extractEmailContent, replyToThread } from '../gmail/index.js';

// Store for edit sessions
const editSessions = new Map<string, {
  estimateId: string;
  itemIndex: number;
  step: 'select_item' | 'enter_price';
} | {
  type: 'status_response';
  jobId: string;
  gmailMessageId: string;
  originalDraft: string;
}>();

// Store draft responses temporarily
const draftResponses = new Map<string, string>();

export function storeDraftResponse(gmailMessageId: string, draft: string): void {
  draftResponses.set(gmailMessageId, draft);
}

export function getDraftResponse(gmailMessageId: string): string | undefined {
  return draftResponses.get(gmailMessageId);
}

export function setupCallbackHandlers(): void {
  // Approve estimate
  bot.action(/^approve_estimate:(.+)$/, async (ctx) => {
    const estimateId = ctx.match[1];
    await ctx.answerCbQuery('Processing...');

    try {
      const estimate = await getEstimateById(estimateId);
      if (!estimate) {
        await ctx.reply('❌ Estimate not found');
        return;
      }

      // Find or create QuickBooks customer
      // For now, use a placeholder - in production, match to contact
      const customer = await findCustomerByName('Samsung');
      if (!customer) {
        await ctx.reply('❌ Customer not found in QuickBooks. Please create the customer first.');
        return;
      }

      // Create estimate in QuickBooks
      const qbEstimate = await createQBEstimate({
        customerId: customer.Id,
        customerName: customer.DisplayName,
        lines: estimate.items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });

      // Update local estimate with QuickBooks data
      await updateEstimateStatus(estimateId, 'sent', {
        estimateId: qbEstimate.Id!,
        docNumber: qbEstimate.DocNumber || '',
        customerId: customer.Id,
      });

      // Record pricing history for each item
      for (const item of estimate.items) {
        if (item.width && item.height) {
          await recordPricingHistory({
            signTypeId: item.signType || undefined,
            description: item.description,
            widthInches: item.width,
            heightInches: item.height,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.unitPrice * item.quantity,
            outcome: 'pending',
            quickbooksEstimateId: qbEstimate.Id,
          });
        }
      }

      await ctx.editMessageText(
        `✅ Estimate #${qbEstimate.DocNumber} created in QuickBooks!\n\nTotal: $${estimate.total_amount?.toLocaleString()}\n\nUse /won ${estimateId.slice(0, 8)} or /lost ${estimateId.slice(0, 8)} to track outcome.`
      );
    } catch (error) {
      console.error('Failed to create QuickBooks estimate:', error);
      await ctx.reply(`❌ Failed to create estimate: ${error}`);
    }
  });

  // Start edit flow
  bot.action(/^edit_estimate:(.+)$/, async (ctx) => {
    const estimateId = ctx.match[1];
    await ctx.answerCbQuery();

    const estimate = await getEstimateById(estimateId);
    if (!estimate) {
      await ctx.reply('❌ Estimate not found');
      return;
    }

    const userId = ctx.from?.id.toString() || '';
    editSessions.set(userId, {
      estimateId,
      itemIndex: -1,
      step: 'select_item',
    });

    const buttons = estimate.items.map((item, idx) =>
      [Markup.button.callback(`${idx + 1}. ${item.description.slice(0, 30)}...`, `edit_item:${idx}`)]
    );
    buttons.push([Markup.button.callback('Cancel', 'cancel_edit')]);

    await ctx.reply(
      'Which item do you want to edit?',
      Markup.inlineKeyboard(buttons)
    );
  });

  // Select item to edit
  bot.action(/^edit_item:(\d+)$/, async (ctx) => {
    const itemIndex = parseInt(ctx.match[1]);
    const userId = ctx.from?.id.toString() || '';

    const session = editSessions.get(userId);
    if (!session || !('estimateId' in session)) {
      await ctx.answerCbQuery('Session expired, please start over');
      return;
    }

    await ctx.answerCbQuery();

    const estimate = await getEstimateById(session.estimateId);
    if (!estimate) {
      await ctx.reply('❌ Estimate not found');
      return;
    }

    const item = estimate.items[itemIndex];
    editSessions.set(userId, {
      ...session,
      itemIndex,
      step: 'enter_price',
    });

    await ctx.reply(
      `${item.description}\n\nCurrent price: $${item.unitPrice.toLocaleString()}\n\nReply with new price (number only):`,
      { reply_markup: { force_reply: true } }
    );
  });

  // Cancel edit
  bot.action('cancel_edit', async (ctx) => {
    const userId = ctx.from?.id.toString() || '';
    editSessions.delete(userId);
    await ctx.answerCbQuery('Edit cancelled');
    await ctx.deleteMessage();
  });

  // Reject estimate
  bot.action(/^reject_estimate:(.+)$/, async (ctx) => {
    const estimateId = ctx.match[1];
    await ctx.answerCbQuery();

    await updateEstimateStatus(estimateId, 'expired');
    await ctx.editMessageText('❌ Estimate rejected and archived.');
  });

  // Status inquiry callbacks
  bot.action(/^status_send:(.+):(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const gmailMessageId = ctx.match[2];
    await ctx.answerCbQuery('Sending...');

    const draft = getDraftResponse(gmailMessageId);
    if (!draft) {
      await ctx.reply('❌ Draft response not found. Please try again.');
      return;
    }

    try {
      // Get original message to find thread and recipient
      const originalMessage = await getMessage(gmailMessageId);
      if (!originalMessage) {
        await ctx.reply('❌ Could not find original email.');
        return;
      }

      const { from, subject } = extractEmailContent(originalMessage);
      const threadId = originalMessage.threadId;

      if (!threadId) {
        await ctx.reply('❌ Could not find email thread.');
        return;
      }

      // Extract email address from "Name <email>" format or plain email
      const bracketMatch = from.match(/<([^>]+)>/);
      let toEmail: string | null = null;
      if (bracketMatch && bracketMatch[1].includes('@')) {
        toEmail = bracketMatch[1].trim();
      } else {
        // Check if it's a plain email address
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        const plainMatch = from.match(emailRegex);
        toEmail = plainMatch ? plainMatch[0] : null;
      }

      if (!toEmail) {
        await ctx.reply('❌ Could not determine recipient email address.');
        return;
      }

      // Send reply
      const sentId = await replyToThread({
        threadId,
        messageId: gmailMessageId,
        to: toEmail,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        body: draft,
      });

      if (sentId) {
        await ctx.editMessageText(`✅ Response sent for job #${jobId.slice(0, 8)}\n\nEmail sent successfully.`);
      } else {
        await ctx.editMessageText(`❌ Failed to send email. Please try again or send manually.`);
      }
    } catch (error) {
      console.error('Failed to send status response:', error);
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      // Always clean up draft, regardless of success/failure
      draftResponses.delete(gmailMessageId);
    }
  });

  bot.action(/^status_edit:(.+):(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const gmailMessageId = ctx.match[2];
    await ctx.answerCbQuery();

    const draft = getDraftResponse(gmailMessageId);
    const userId = ctx.from?.id.toString() || '';

    // Store edit session
    editSessions.set(userId, {
      type: 'status_response',
      jobId,
      gmailMessageId,
      originalDraft: draft || '',
    });

    await ctx.reply(
      `Current draft:\n\n${draft}\n\nReply with your edited message:`,
      { reply_markup: { force_reply: true } }
    );
  });

  bot.action(/^status_ignore:(.+)$/, async (ctx) => {
    const gmailMessageId = ctx.match[1];
    await ctx.answerCbQuery('Ignored');
    await ctx.editMessageText('📥 Status inquiry archived.');
    draftResponses.delete(gmailMessageId);
  });

  bot.action(/^status_select:(.+):(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const gmailMessageId = ctx.match[2];
    await ctx.answerCbQuery('Selected');

    // TODO: Re-process with selected job
    await ctx.editMessageText(`Selected job #${jobId.slice(0, 8)}. Processing...`);
  });

  bot.action(/^status_new_estimate:(.+)$/, async (ctx) => {
    const gmailMessageId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.editMessageText(`Treating as new estimate request...`);
    // TODO: Redirect to new estimate flow
  });

  // Reorder callbacks
  bot.action(/^reorder_same:(.+):(.+)$/, async (ctx) => {
    const estimateId = ctx.match[1];
    const gmailMessageId = ctx.match[2];
    await ctx.answerCbQuery('Creating estimate...');
    // TODO: Create new estimate with same items and prices
    await ctx.editMessageText(`📋 Creating estimate from previous order #${estimateId.slice(0, 8)}...\n\n(Estimate creation coming soon)`);
  });

  bot.action(/^reorder_edit:(.+):(.+)$/, async (ctx) => {
    const estimateId = ctx.match[1];
    const gmailMessageId = ctx.match[2];
    await ctx.answerCbQuery();
    // TODO: Show edit interface for prices
    await ctx.editMessageText(`✏️ Edit mode for order #${estimateId.slice(0, 8)}...\n\n(Price editing interface coming soon)`);
  });

  bot.action(/^reorder_new:(.+)$/, async (ctx) => {
    const gmailMessageId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.editMessageText(`📝 Treating as new estimate request...\n\n(Processing as new request)`);
    // TODO: Redirect to new estimate flow
  });

  bot.action(/^reorder_ignore:(.+)$/, async (ctx) => {
    const gmailMessageId = ctx.match[1];
    await ctx.answerCbQuery('Ignored');
    await ctx.editMessageText('📥 Reorder request archived.');
  });

  // Handle text replies for editing
  bot.on('text', async (ctx) => {
    const userId = ctx.from?.id.toString() || '';
    const session = editSessions.get(userId);

    if (!session) {
      return; // Not in an edit session
    }

    // Handle status response editing
    if ('type' in session && session.type === 'status_response') {
      const editedMessage = ctx.message.text;
      draftResponses.set(session.gmailMessageId, editedMessage);
      editSessions.delete(userId);

      await ctx.reply(
        `✅ Draft updated.\n\n"${editedMessage.slice(0, 100)}${editedMessage.length > 100 ? '...' : ''}"`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Send', `status_send:${session.jobId}:${session.gmailMessageId}`),
            Markup.button.callback('Edit Again', `status_edit:${session.jobId}:${session.gmailMessageId}`),
          ],
        ])
      );
      return;
    }

    // Handle estimate price editing
    if ('step' in session && session.step === 'enter_price') {
      const newPrice = parseFloat(ctx.message.text.replace(/[,$]/g, ''));
      if (isNaN(newPrice) || newPrice < 0) {
        await ctx.reply('Please enter a valid number (e.g., 1500 or 1,500)');
        return;
      }

      const estimate = await getEstimateById(session.estimateId);
      if (!estimate) {
        await ctx.reply('❌ Estimate not found');
        editSessions.delete(userId);
        return;
      }

      // Update the item price
      const updatedItems = [...estimate.items];
      updatedItems[session.itemIndex] = {
        ...updatedItems[session.itemIndex],
        unitPrice: newPrice,
      };

      await updateEstimateItems(session.estimateId, updatedItems);
      editSessions.delete(userId);

      const newTotal = updatedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

      await ctx.reply(
        `✅ Updated to $${newPrice.toLocaleString()}\n\nNew total: $${newTotal.toLocaleString()}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✓ Approve', `approve_estimate:${session.estimateId}`),
            Markup.button.callback('✏️ Edit More', `edit_estimate:${session.estimateId}`),
          ],
        ])
      );
    }
  });
}

// Win/lose tracking commands
export function setupOutcomeCommands(): void {
  bot.command('won', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('Usage: /won <estimate_id_prefix>');
      return;
    }

    const idPrefix = args[1];
    const estimate = await findEstimateByPrefix(idPrefix);
    if (!estimate) {
      await ctx.reply(`❌ No estimate found starting with "${idPrefix}"`);
      return;
    }

    await updateEstimateStatus(estimate.id, 'won');
    if (estimate.quickbooks_estimate_id) {
      await updatePricingOutcome(estimate.quickbooks_estimate_id, 'won');
    }

    // Create job from won estimate
    const itemDescriptions = estimate.items.map(i => i.description).join(', ');
    const job = await createJob({
      estimateId: estimate.id,
      contactId: estimate.contact_id,
      description: itemDescriptions || 'No description',
      totalAmount: estimate.total_amount,
    });

    if (job) {
      await ctx.reply(
        `🎉 Estimate #${estimate.quickbooks_doc_number || estimate.id.slice(0, 8)} marked as WON!\n\n` +
        `📋 Job created: ${job.id.slice(0, 8)}\n` +
        `Use /stage ${job.id.slice(0, 8)} <stage> to update progress.`
      );
    } else {
      await ctx.reply(`🎉 Estimate marked as WON but failed to create job.`);
    }
  });

  bot.command('lost', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('Usage: /lost <estimate_id_prefix>');
      return;
    }

    const idPrefix = args[1];
    const estimate = await findEstimateByPrefix(idPrefix);
    if (!estimate) {
      await ctx.reply(`❌ No estimate found starting with "${idPrefix}"`);
      return;
    }

    await updateEstimateStatus(estimate.id, 'lost');
    if (estimate.quickbooks_estimate_id) {
      await updatePricingOutcome(estimate.quickbooks_estimate_id, 'lost');
    }

    await ctx.reply(`📉 Estimate #${estimate.quickbooks_doc_number || estimate.id.slice(0, 8)} marked as LOST. Pricing will be adjusted.`);
  });

  bot.command('estimates', async (ctx) => {
    const pending = await getPendingEstimates();

    if (pending.length === 0) {
      await ctx.reply('No pending estimates.');
      return;
    }

    const list = pending.map(est =>
      `• #${est.quickbooks_doc_number || est.id.slice(0, 8)} - $${est.total_amount?.toLocaleString()} (${est.status})`
    ).join('\n');

    await ctx.reply(`📋 Pending Estimates:\n\n${list}\n\nUse /won <id> or /lost <id> to update.`);
  });

  // List active jobs
  bot.command('jobs', async (ctx) => {
    const jobs = await getActiveJobs();

    if (jobs.length === 0) {
      await ctx.reply('No active jobs.');
      return;
    }

    const list = jobs.map(job => {
      const eta = job.eta ? ` | ETA: ${job.eta}` : '';
      return `• ${job.id.slice(0, 8)} | ${job.stage}${eta}\n  ${job.description.slice(0, 50)}...`;
    }).join('\n\n');

    await ctx.reply(`📋 Active Jobs:\n\n${list}\n\nUse /job <id> for details.`);
  });

  // Show job details
  bot.command('job', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('Usage: /job <job_id_prefix>');
      return;
    }

    const job = await findJobByPrefix(args[1]);
    if (!job) {
      await ctx.reply(`❌ No job found starting with "${args[1]}"`);
      return;
    }

    const eta = job.eta || 'Not set';
    const amount = job.total_amount ? `$${job.total_amount.toLocaleString()}` : 'N/A';

    await ctx.reply(
      `📋 Job: ${job.id.slice(0, 8)}\n\n` +
      `Stage: ${job.stage}\n` +
      `ETA: ${eta}\n` +
      `Amount: ${amount}\n\n` +
      `${job.description}\n\n` +
      `Commands:\n` +
      `/stage ${job.id.slice(0, 8)} <pending|in_production|ready|installed|completed>\n` +
      `/eta ${job.id.slice(0, 8)} <YYYY-MM-DD>`
    );
  });

  // Update job stage
  bot.command('stage', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
      await ctx.reply('Usage: /stage <job_id> <pending|in_production|ready|installed|completed>');
      return;
    }

    const validStages = ['pending', 'in_production', 'ready', 'installed', 'completed'];
    const stage = args[2].toLowerCase();
    if (!validStages.includes(stage)) {
      await ctx.reply(`Invalid stage. Use: ${validStages.join(', ')}`);
      return;
    }

    const job = await findJobByPrefix(args[1]);
    if (!job) {
      await ctx.reply(`❌ No job found starting with "${args[1]}"`);
      return;
    }

    const success = await updateJobStage(job.id, stage as 'pending' | 'in_production' | 'ready' | 'installed' | 'completed');
    if (success) {
      await ctx.reply(`✅ Job ${job.id.slice(0, 8)} updated to: ${stage}`);
    } else {
      await ctx.reply(`❌ Failed to update job stage.`);
    }
  });

  // Update job ETA
  bot.command('eta', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
      await ctx.reply('Usage: /eta <job_id> <YYYY-MM-DD>');
      return;
    }

    const dateStr = args[2];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      await ctx.reply('Invalid date format. Use: YYYY-MM-DD (e.g., 2026-01-25)');
      return;
    }

    const job = await findJobByPrefix(args[1]);
    if (!job) {
      await ctx.reply(`❌ No job found starting with "${args[1]}"`);
      return;
    }

    const success = await updateJobEta(job.id, dateStr);
    if (success) {
      await ctx.reply(`✅ Job ${job.id.slice(0, 8)} ETA set to: ${dateStr}`);
    } else {
      await ctx.reply(`❌ Failed to update job ETA.`);
    }
  });

  // Language preference command
  bot.command('lang', async (ctx) => {
    const args = ctx.message.text.split(' ');
    const userId = ctx.from?.id.toString();

    if (!userId) {
      await ctx.reply('Could not identify user.');
      return;
    }

    if (args.length < 2) {
      const user = await getTelegramUser(userId);
      const currentLang = user?.language || 'ko';
      await ctx.reply(
        currentLang === 'ko'
          ? `현재 언어: 한국어\n\n사용법: /lang <ko|en>`
          : `Current language: English\n\nUsage: /lang <ko|en>`
      );
      return;
    }

    const lang = args[1].toLowerCase();
    if (lang !== 'ko' && lang !== 'en') {
      await ctx.reply('Invalid language. Use: /lang ko or /lang en');
      return;
    }

    // Ensure user exists
    const user = await upsertTelegramUser(userId, ctx.from?.first_name);
    if (!user) {
      await ctx.reply('Failed to create user record.');
      return;
    }
    const success = await setUserLanguage(userId, lang);

    if (success) {
      const message = lang === 'ko'
        ? '✅ 언어가 한국어로 설정되었습니다.\n모든 알림이 한국어로 표시됩니다.'
        : '✅ Language set to English.\nAll notifications will now be in English.';
      await ctx.reply(message);
    } else {
      await ctx.reply('Failed to update language preference.');
    }
  });
}

async function findEstimateByPrefix(prefix: string): Promise<Estimate | null> {
  const estimates = await getRecentEstimates(50);

  return estimates.find(e =>
    e.id.startsWith(prefix) ||
    e.quickbooks_doc_number?.includes(prefix) ||
    e.quickbooks_estimate_id?.includes(prefix)
  ) || null;
}
