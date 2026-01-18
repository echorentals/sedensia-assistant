// src/modules/jobs/matcher.ts
import { getActiveJobs, type Job } from '../../db/index.js';

export interface JobMatch {
  job: Job;
  confidence: number;
  matchedKeywords: string[];
}

export interface FindJobInput {
  contactId?: string;
  keywords: string[];
  maxResults?: number;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9가-힣\s]/g, ' ').trim();
}

function calculateMatchScore(description: string, keywords: string[]): { score: number; matched: string[] } {
  const normalizedDesc = normalizeText(description);
  const matched: string[] = [];
  let score = 0;

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedDesc.includes(normalizedKeyword)) {
      matched.push(keyword);
      score += normalizedKeyword.length / 10;
    }
  }

  const maxPossibleScore = keywords.reduce((sum, k) => sum + normalizeText(k).length / 10, 0);
  const normalizedScore = maxPossibleScore > 0 ? score / maxPossibleScore : 0;

  return { score: normalizedScore, matched };
}

function getRecencyBonus(createdAt: string): number {
  const daysAgo = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo <= 30) return 0.2;
  if (daysAgo <= 60) return 0.1;
  if (daysAgo <= 90) return 0.05;
  return 0;
}

export async function findMatchingJob(input: FindJobInput): Promise<JobMatch | null> {
  const jobs = await getActiveJobs();

  if (!jobs.length || !input.keywords.length) {
    return null;
  }

  const filteredJobs = input.contactId
    ? jobs.filter(job => job.contact_id === input.contactId)
    : jobs;

  if (!filteredJobs.length) {
    return null;
  }

  const scored: JobMatch[] = [];

  for (const job of filteredJobs) {
    const { score, matched } = calculateMatchScore(job.description, input.keywords);

    if (matched.length > 0) {
      const recencyBonus = getRecencyBonus(job.created_at);
      const confidence = Math.min(score + recencyBonus, 1);

      scored.push({
        job,
        confidence,
        matchedKeywords: matched,
      });
    }
  }

  if (!scored.length) {
    return null;
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored[0];
}

export async function findAllMatchingJobs(input: FindJobInput): Promise<JobMatch[]> {
  const jobs = await getActiveJobs();

  if (!jobs.length || !input.keywords.length) {
    return [];
  }

  const filteredJobs = input.contactId
    ? jobs.filter(job => job.contact_id === input.contactId)
    : jobs;

  const scored: JobMatch[] = [];

  for (const job of filteredJobs) {
    const { score, matched } = calculateMatchScore(job.description, input.keywords);

    if (matched.length > 0) {
      const recencyBonus = getRecencyBonus(job.created_at);
      const confidence = Math.min(score + recencyBonus, 1);

      scored.push({
        job,
        confidence,
        matchedKeywords: matched,
      });
    }
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  const maxResults = input.maxResults || 3;
  return scored.slice(0, maxResults);
}
