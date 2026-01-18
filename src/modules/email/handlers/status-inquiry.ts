// src/modules/email/handlers/status-inquiry.ts
import { findMatchingJob, findAllMatchingJobs, type JobMatch } from '../../jobs/index.js';
import { draftStatusResponse } from '../../ai/index.js';
import type { Contact } from '../../../db/index.js';

export interface StatusInquiryInput {
  contact: Contact;
  keywords: string[];
  emailLanguage: 'ko' | 'en';
  gmailMessageId: string;
  subject: string;
}

export interface StatusInquiryResult {
  success: boolean;
  matchedJob?: JobMatch;
  multipleMatches?: JobMatch[];
  noMatch?: boolean;
  draftResponse?: string;
  error?: string;
}

export async function handleStatusInquiry(input: StatusInquiryInput): Promise<StatusInquiryResult> {
  try {
    // Find matching job
    const match = await findMatchingJob({
      contactId: input.contact.id,
      keywords: input.keywords,
    });

    if (!match) {
      // Check if there are any partial matches
      const allMatches = await findAllMatchingJobs({
        contactId: input.contact.id,
        keywords: input.keywords,
        maxResults: 3,
      });

      if (allMatches.length > 1) {
        return {
          success: true,
          multipleMatches: allMatches,
        };
      }

      return {
        success: true,
        noMatch: true,
      };
    }

    // Draft response in email language
    const draftResponse = await draftStatusResponse({
      language: input.emailLanguage,
      recipientName: input.contact.name.split(' ')[0], // First name
      jobDescription: match.job.description,
      currentStage: match.job.stage,
      eta: match.job.eta,
    });

    return {
      success: true,
      matchedJob: match,
      draftResponse,
    };
  } catch (error) {
    console.error('Status inquiry handling failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
