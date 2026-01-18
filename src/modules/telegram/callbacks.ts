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
} from '../../db/index.js';
import {
  createEstimate as createQBEstimate,
  findCustomerByName,
} from '../quickbooks/index.js';

// Store for edit sessions
const editSessions = new Map<string, {
  estimateId: string;
  itemIndex: number;
  step: 'select_item' | 'enter_price';
}>();

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
    if (!session) {
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
    session.itemIndex = itemIndex;
    session.step = 'enter_price';
    editSessions.set(userId, session);

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

  // Handle text replies for price editing
  bot.on('text', async (ctx) => {
    const userId = ctx.from?.id.toString() || '';
    const session = editSessions.get(userId);

    if (!session || session.step !== 'enter_price') {
      return; // Not in an edit session
    }

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
}

async function findEstimateByPrefix(prefix: string): Promise<Estimate | null> {
  const estimates = await getRecentEstimates(50);

  return estimates.find(e =>
    e.id.startsWith(prefix) ||
    e.quickbooks_doc_number?.includes(prefix) ||
    e.quickbooks_estimate_id?.includes(prefix)
  ) || null;
}
