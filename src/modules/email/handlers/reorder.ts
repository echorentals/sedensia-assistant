import { getRecentEstimates, type Estimate } from '../../../db/index.js';
import type { Contact } from '../../../db/index.js';

export interface ReorderInput {
  contact: Contact;
  keywords: string[];
  emailLanguage: 'ko' | 'en';
  gmailMessageId: string;
  originalMessage: string;
}

export interface ReorderResult {
  success: boolean;
  previousEstimate?: Estimate;
  noMatch?: boolean;
  error?: string;
}

export async function handleReorder(input: ReorderInput): Promise<ReorderResult> {
  try {
    // Find previous estimates from this contact
    const estimates = await getRecentEstimates(50);
    const contactEstimates = estimates.filter(e =>
      e.contact_id === input.contact.id && e.status === 'won'
    );

    if (!contactEstimates.length) {
      return { success: true, noMatch: true };
    }

    // Find best match by keywords
    let bestMatch: Estimate | undefined;
    let bestScore = 0;

    for (const estimate of contactEstimates) {
      const itemDescriptions = estimate.items.map(i => i.description.toLowerCase()).join(' ');

      for (const keyword of input.keywords) {
        if (itemDescriptions.includes(keyword.toLowerCase())) {
          const score = keyword.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = estimate;
          }
        }
      }
    }

    // If no keyword match, return most recent
    if (!bestMatch && contactEstimates.length > 0) {
      bestMatch = contactEstimates[0];
    }

    return {
      success: true,
      previousEstimate: bestMatch,
    };
  } catch (error) {
    console.error('Reorder handling failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
