// src/modules/ai/drafter.ts
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/index.js';

let client: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

const STAGE_NAMES_KO: Record<string, string> = {
  pending: '대기 중',
  in_production: '제작 중',
  ready: '완료 (배송 대기)',
  installed: '설치 완료',
  completed: '완료',
};

const STAGE_NAMES_EN: Record<string, string> = {
  pending: 'Pending',
  in_production: 'In Production',
  ready: 'Ready for Delivery',
  installed: 'Installed',
  completed: 'Completed',
};

export interface StatusResponseInput {
  language: 'ko' | 'en';
  recipientName: string;
  jobDescription: string;
  currentStage: string;
  eta?: string | null;
}

export async function draftStatusResponse(input: StatusResponseInput): Promise<string> {
  const stageName = input.language === 'ko'
    ? STAGE_NAMES_KO[input.currentStage] || input.currentStage
    : STAGE_NAMES_EN[input.currentStage] || input.currentStage;

  const etaText = input.eta
    ? input.language === 'ko'
      ? `예상 완료일: ${input.eta}`
      : `Estimated completion: ${input.eta}`
    : '';

  const systemPrompt = input.language === 'ko'
    ? `You are writing a professional status update email in Korean for a sign fabrication company (세덴시아 사인).
Keep it concise and polite. Use formal Korean (존댓말).
Sign off with "감사합니다,\n세덴시아 사인"`
    : `You are writing a professional status update email in English for a sign fabrication company (Sedensia Signs).
Keep it concise and professional.
Sign off with "Best regards,\nSedensia Signs"`;

  const userMessage = input.language === 'ko'
    ? `Write a brief status update email to ${input.recipientName} about their order:
Job: ${input.jobDescription}
Status: ${stageName}
${etaText}

Keep it to 3-4 sentences maximum.`
    : `Write a brief status update email to ${input.recipientName} about their order:
Job: ${input.jobDescription}
Status: ${stageName}
${etaText}

Keep it to 3-4 sentences maximum.`;

  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textContent.text.trim();
}

export interface ReorderResponseInput {
  language: 'ko' | 'en';
  recipientName: string;
  previousOrderDescription: string;
  previousTotal: number;
}

export async function draftReorderConfirmation(input: ReorderResponseInput): Promise<string> {
  const systemPrompt = input.language === 'ko'
    ? `You are writing a professional email in Korean for a sign fabrication company (세덴시아 사인).
Keep it concise and polite. Use formal Korean (존댓말).
Sign off with "감사합니다,\n세덴시아 사인"`
    : `You are writing a professional email in English for a sign fabrication company (Sedensia Signs).
Keep it concise and professional.
Sign off with "Best regards,\nSedensia Signs"`;

  const userMessage = input.language === 'ko'
    ? `Write a brief email to ${input.recipientName} confirming we received their reorder request:
Previous order: ${input.previousOrderDescription}
Previous total: $${input.previousTotal.toLocaleString()}

Ask them to confirm they want the same items at the same price. Keep it to 3-4 sentences.`
    : `Write a brief email to ${input.recipientName} confirming we received their reorder request:
Previous order: ${input.previousOrderDescription}
Previous total: $${input.previousTotal.toLocaleString()}

Ask them to confirm they want the same items at the same price. Keep it to 3-4 sentences.`;

  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textContent.text.trim();
}

export interface CompletionEmailInput {
  contactName: string;
  companyName: string;
  jobDescription: string;
  invoiceNumber: string;
  invoiceTotal: number;
  language: 'ko' | 'en';
}

export async function draftCompletionEmail(input: CompletionEmailInput): Promise<string> {
  const languageInstructions =
    input.language === 'ko'
      ? '한국어로 작성해주세요. 정중하고 비즈니스적인 톤을 유지하세요.'
      : 'Write in English. Maintain a professional and courteous tone.';

  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `You are drafting a job completion email for a sign fabrication company.

${languageInstructions}

Details:
- Customer name: ${input.contactName}
- Company: ${input.companyName}
- Project: ${input.jobDescription}
- Invoice number: ${input.invoiceNumber}
- Total amount: $${input.invoiceTotal.toLocaleString()}

Write a brief, professional email that:
1. Confirms the job has been completed and delivered
2. References the attached invoice
3. Thanks them for their business
4. Mentions payment terms (Net 30)

Keep it concise (3-4 short paragraphs). Do not include subject line or signature - just the body text.`,
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textContent.text.trim();
}

export interface EstimateEmailInput {
  contactName: string;
  companyName: string;
  itemsSummary: string;
  estimateNumber: string;
  estimateTotal: number;
  turnaroundDays: number;
  language: 'ko' | 'en';
}

export async function draftEstimateEmail(input: EstimateEmailInput): Promise<string> {
  const languageInstructions =
    input.language === 'ko'
      ? '한국어로 작성해주세요. 정중하고 비즈니스적인 톤을 유지하세요.'
      : 'Write in English. Maintain a professional and courteous tone.';

  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `You are drafting an estimate email for a sign fabrication company.

${languageInstructions}

Details:
- Customer name: ${input.contactName}
- Company: ${input.companyName}
- Items: ${input.itemsSummary}
- Estimate number: ${input.estimateNumber}
- Total amount: $${input.estimateTotal.toLocaleString()}
- Turnaround time: ${input.turnaroundDays} days

Write a brief, professional email that:
1. Thanks them for their inquiry
2. References the attached estimate PDF
3. Mentions the turnaround time
4. Invites them to reach out with questions or to approve

Keep it concise (3-4 short paragraphs). Do not include subject line or signature - just the body text.`,
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textContent.text.trim();
}

export interface ApprovalConfirmationInput {
  contactName: string;
  companyName: string;
  itemsSummary: string;
  estimateNumber: string;
  turnaroundDays: number;
}

export async function draftApprovalConfirmation(input: ApprovalConfirmationInput): Promise<string> {
  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `You are drafting an order confirmation email for a sign fabrication company.

한국어로 작성해주세요. 정중하고 비즈니스적인 톤을 유지하세요.

Details:
- Customer name: ${input.contactName}
- Company: ${input.companyName}
- Items: ${input.itemsSummary}
- Estimate number: ${input.estimateNumber}
- Turnaround time: ${input.turnaroundDays} days

Write a brief, professional email that:
1. Thanks them for confirming the order
2. Confirms we will begin production
3. Reminds them of the turnaround time
4. Mentions we will notify them when ready

Keep it concise (2-3 short paragraphs). Do not include subject line or signature - just the body text.`,
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  return textContent.text.trim();
}
