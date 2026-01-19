import { Markup } from 'telegraf';
import { bot, sendCompletionNotification } from './bot.js';
import {
  getEstimateById,
  updateEstimateStatus,
  updateEstimateItems,
  updateEstimateTurnaround,
  type Estimate,
  type Job,
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
  updateInvoiceSent,
  updateInvoicePaid,
  getInvoiceByJobId,
  getContactById,
} from '../../db/index.js';
import {
  createEstimate as createQBEstimate,
  findCustomerByName,
} from '../quickbooks/index.js';
import { getMessage, extractEmailContent, replyToThread, getMessageThreadId } from '../gmail/index.js';
import { handleJobCompletion } from '../invoicing/index.js';

// Store for edit sessions
const editSessions = new Map<string, {
  estimateId: string;
  itemIndex: number;
  step: 'select_item' | 'select_field' | 'enter_price' | 'enter_quantity' | 'enter_turnaround';
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

// Completion data storage for invoicing flow
interface CompletionData {
  draftEmail: string;
  pdfBuffer: Buffer;
  contactEmail: string;
  gmailMessageId?: string;
  invoiceNumber: string;
}

const completionDataStore = new Map<string, CompletionData>();

function storeCompletionData(jobId: string, data: CompletionData): void {
  completionDataStore.set(jobId, data);
}

function getCompletionData(jobId: string): CompletionData | undefined {
  return completionDataStore.get(jobId);
}

function clearCompletionData(jobId: string): void {
  completionDataStore.delete(jobId);
}

// Track users editing completion emails
const editingCompletionEmail = new Map<string, string>(); // telegramUserId -> jobId

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

      // Get contact to find customer name
      const contact = estimate.contact_id ? await getContactById(estimate.contact_id) : null;
      const customerSearchName = contact?.company || contact?.name || 'Samsung';

      // Find QuickBooks customer by contact's company name
      const customer = await findCustomerByName(customerSearchName);
      if (!customer) {
        await ctx.reply(`❌ Customer "${customerSearchName}" not found in QuickBooks. Please create the customer first.`);
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
        memo: `Turnaround: ${estimate.turnaround_days} days`,
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
    buttons.push([Markup.button.callback(`⏱️ Turnaround (${estimate.turnaround_days} days)`, `edit_turnaround:${estimateId}`)]);
    buttons.push([Markup.button.callback('Cancel', 'cancel_edit')]);

    await ctx.reply(
      'What do you want to edit?',
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
      step: 'select_field',
    });

    await ctx.reply(
      `${item.description}\n\nQty: ${item.quantity} × $${item.unitPrice.toLocaleString()} = $${(item.quantity * item.unitPrice).toLocaleString()}\n\nWhat do you want to edit?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('💰 Price', `edit_field:price:${itemIndex}`),
          Markup.button.callback('🔢 Quantity', `edit_field:qty:${itemIndex}`),
        ],
        [Markup.button.callback('Cancel', 'cancel_edit')],
      ])
    );
  });

  // Select field to edit (price or quantity)
  bot.action(/^edit_field:(price|qty):(\d+)$/, async (ctx) => {
    const field = ctx.match[1];
    const itemIndex = parseInt(ctx.match[2]);
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

    if (field === 'price') {
      editSessions.set(userId, {
        ...session,
        itemIndex,
        step: 'enter_price',
      });

      await ctx.reply(
        `${item.description}\n\nCurrent price: $${item.unitPrice.toLocaleString()}\n\nReply with new price (number only):`,
        { reply_markup: { force_reply: true } }
      );
    } else {
      editSessions.set(userId, {
        ...session,
        itemIndex,
        step: 'enter_quantity',
      });

      await ctx.reply(
        `${item.description}\n\nCurrent quantity: ${item.quantity}\n\nReply with new quantity (number only):`,
        { reply_markup: { force_reply: true } }
      );
    }
  });

  // Cancel edit
  bot.action('cancel_edit', async (ctx) => {
    const userId = ctx.from?.id.toString() || '';
    editSessions.delete(userId);
    await ctx.answerCbQuery('Edit cancelled');
    await ctx.deleteMessage();
  });

  // Edit turnaround time
  bot.action(/^edit_turnaround:(.+)$/, async (ctx) => {
    const estimateId = ctx.match[1];
    const userId = ctx.from?.id.toString() || '';
    await ctx.answerCbQuery();

    const estimate = await getEstimateById(estimateId);
    if (!estimate) {
      await ctx.reply('❌ Estimate not found');
      return;
    }

    editSessions.set(userId, {
      estimateId,
      itemIndex: -1,
      step: 'enter_turnaround',
    });

    await ctx.reply(
      `Current turnaround: ${estimate.turnaround_days} days\n\nReply with new turnaround (number of days):`,
      { reply_markup: { force_reply: true } }
    );
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

    // Handle completion email editing
    const completionJobId = editingCompletionEmail.get(userId);
    if (completionJobId) {
      const data = getCompletionData(completionJobId);
      if (data) {
        const editedEmail = ctx.message.text;
        // Update the stored completion data with edited email
        storeCompletionData(completionJobId, {
          ...data,
          draftEmail: editedEmail,
        });

        editingCompletionEmail.delete(userId);

        await ctx.reply(
          `✅ Draft updated.\n\n"${editedEmail.slice(0, 100)}${editedEmail.length > 100 ? '...' : ''}"`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback('Send', `complete_send:${completionJobId}`),
              Markup.button.callback('Edit Again', `complete_edit:${completionJobId}`),
            ],
            [
              Markup.button.callback('Skip', `complete_skip:${completionJobId}`),
            ],
          ])
        );
      } else {
        editingCompletionEmail.delete(userId);
        await ctx.reply('❌ Completion data expired. Please run /stage again.');
      }
      return;
    }

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
        `✅ Price updated to $${newPrice.toLocaleString()}\n\nNew total: $${newTotal.toLocaleString()}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✓ Approve', `approve_estimate:${session.estimateId}`),
            Markup.button.callback('✏️ Edit More', `edit_estimate:${session.estimateId}`),
          ],
        ])
      );
    }

    // Handle estimate quantity editing
    if ('step' in session && session.step === 'enter_quantity') {
      const newQty = parseInt(ctx.message.text.replace(/[,]/g, ''));
      if (isNaN(newQty) || newQty < 1) {
        await ctx.reply('Please enter a valid quantity (e.g., 1, 5, 10)');
        return;
      }

      const estimate = await getEstimateById(session.estimateId);
      if (!estimate) {
        await ctx.reply('❌ Estimate not found');
        editSessions.delete(userId);
        return;
      }

      // Update the item quantity
      const updatedItems = [...estimate.items];
      updatedItems[session.itemIndex] = {
        ...updatedItems[session.itemIndex],
        quantity: newQty,
      };

      await updateEstimateItems(session.estimateId, updatedItems);
      editSessions.delete(userId);

      const newTotal = updatedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

      await ctx.reply(
        `✅ Quantity updated to ${newQty}\n\nNew total: $${newTotal.toLocaleString()}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✓ Approve', `approve_estimate:${session.estimateId}`),
            Markup.button.callback('✏️ Edit More', `edit_estimate:${session.estimateId}`),
          ],
        ])
      );
    }

    // Handle turnaround editing
    if ('step' in session && session.step === 'enter_turnaround') {
      const newTurnaround = parseInt(ctx.message.text.replace(/[,]/g, ''));
      if (isNaN(newTurnaround) || newTurnaround < 1) {
        await ctx.reply('Please enter a valid number of days (e.g., 7, 14, 21)');
        return;
      }

      const success = await updateEstimateTurnaround(session.estimateId, newTurnaround);
      editSessions.delete(userId);

      if (success) {
        await ctx.reply(
          `✅ Turnaround updated to ${newTurnaround} days`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback('✓ Approve', `approve_estimate:${session.estimateId}`),
              Markup.button.callback('✏️ Edit More', `edit_estimate:${session.estimateId}`),
            ],
          ])
        );
      } else {
        await ctx.reply('❌ Failed to update turnaround');
      }
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
      `/stage ${job.id.slice(0, 8)} <pending|in_production|ready|installed|completed|invoiced|paid>\n` +
      `/eta ${job.id.slice(0, 8)} <YYYY-MM-DD>`
    );
  });

  // Update job stage
  bot.command('stage', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
      await ctx.reply('Usage: /stage <job_id> <pending|in_production|ready|installed|completed|invoiced|paid>');
      return;
    }

    const validStages = ['pending', 'in_production', 'ready', 'installed', 'completed', 'invoiced', 'paid'];
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

    const success = await updateJobStage(job.id, stage as Job['stage']);
    if (success) {
      await ctx.reply(`✅ Job ${job.id.slice(0, 8)} updated to: ${stage}`);

      // Trigger invoicing flow when completed
      if (stage === 'completed') {
        await ctx.reply('Processing invoice...');
        const result = await handleJobCompletion(job.id);

        if (result.success && result.job && result.invoiceNumber && result.draftEmail) {
          // Store completion data for callbacks
          storeCompletionData(job.id, {
            draftEmail: result.draftEmail,
            pdfBuffer: result.pdfBuffer!,
            contactEmail: result.contactEmail!,
            gmailMessageId: result.gmailMessageId,
            invoiceNumber: result.invoiceNumber,
          });

          await sendCompletionNotification({
            telegramUserId: ctx.from?.id.toString(),
            job: { id: job.id, description: job.description },
            invoiceNumber: result.invoiceNumber,
            invoiceTotal: result.invoice?.total || 0,
            draftEmail: result.draftEmail,
            contactName: result.contactEmail?.split('@')[0] || 'Customer',
            companyName: 'Samsung', // TODO: Get from contact
          });
        } else {
          await ctx.reply(`⚠️ Invoice creation failed: ${result.error}`);
        }
      }
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

  // Complete and send email with invoice
  bot.action(/^complete_send:(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const data = getCompletionData(jobId);

    if (!data) {
      await ctx.answerCbQuery('Completion data expired. Please run /stage again.');
      return;
    }

    try {
      // Get thread info
      let threadId: string | null = null;
      if (data.gmailMessageId) {
        threadId = await getMessageThreadId(data.gmailMessageId);
      }

      if (threadId && data.gmailMessageId) {
        // Send email with PDF attachment
        const sentId = await replyToThread({
          threadId,
          messageId: data.gmailMessageId,
          to: data.contactEmail,
          subject: `Re: Job Complete - Invoice ${data.invoiceNumber}`,
          body: data.draftEmail,
          attachments: [{
            filename: `${data.invoiceNumber}.pdf`,
            mimeType: 'application/pdf',
            data: data.pdfBuffer,
          }],
        });

        if (sentId) {
          // Update invoice as sent
          const invoice = await getInvoiceByJobId(jobId);
          if (invoice) {
            await updateInvoiceSent(invoice.id);
          }

          // Update job to invoiced
          await updateJobStage(jobId, 'invoiced');

          await ctx.editMessageText(`✅ Completion email sent with invoice ${data.invoiceNumber}`);
        } else {
          await ctx.answerCbQuery('Failed to send email');
        }
      } else {
        await ctx.answerCbQuery('No email thread found for reply');
      }
    } catch (error) {
      console.error('Complete send failed:', error);
      await ctx.answerCbQuery('Failed to send email');
    } finally {
      clearCompletionData(jobId);
    }
  });

  // Edit completion email
  bot.action(/^complete_edit:(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];
    const data = getCompletionData(jobId);

    if (!data) {
      await ctx.answerCbQuery('Completion data expired');
      return;
    }

    await ctx.editMessageText(
      `📝 Current draft:\n\n${data.draftEmail}\n\n➡️ Reply with your edited version:`
    );

    // Store that we're expecting an edit for this job
    editingCompletionEmail.set(ctx.from?.id.toString() || '', jobId);
    await ctx.answerCbQuery();
  });

  // Skip sending email, just mark as invoiced
  bot.action(/^complete_skip:(.+)$/, async (ctx) => {
    const jobId = ctx.match[1];

    await updateJobStage(jobId, 'invoiced');
    clearCompletionData(jobId);

    await ctx.editMessageText(`✅ Job marked as invoiced (email skipped)`);
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

  // Mark job as paid
  bot.command('paid', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply('Usage: /paid <job_id>');
      return;
    }

    const job = await findJobByPrefix(args[1]);
    if (!job) {
      await ctx.reply(`❌ No job found starting with "${args[1]}"`);
      return;
    }

    // Check if job is invoiced
    if (job.stage !== 'invoiced') {
      if (job.stage === 'paid') {
        const invoice = await getInvoiceByJobId(job.id);
        const paidDate = invoice?.paid_at
          ? new Date(invoice.paid_at).toLocaleDateString()
          : 'unknown date';
        await ctx.reply(`ℹ️ Job already marked as paid on ${paidDate}`);
        return;
      }
      await ctx.reply(`❌ Job must be invoiced before marking paid. Current stage: ${job.stage}`);
      return;
    }

    // Get invoice and mark as paid
    const invoice = await getInvoiceByJobId(job.id);
    if (invoice) {
      await updateInvoicePaid(invoice.id);
    }

    // Update job stage
    const success = await updateJobStage(job.id, 'paid');
    if (success) {
      await ctx.reply(`✅ Job #${job.id.slice(0, 8)} marked as paid

Invoice: ${invoice?.quickbooks_doc_number || 'N/A'}
Amount: $${invoice?.total?.toLocaleString() || job.total_amount?.toLocaleString() || 'N/A'}`);
    } else {
      await ctx.reply(`❌ Failed to update job stage`);
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
