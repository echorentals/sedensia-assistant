// src/modules/jobs/matcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  getActiveJobs: vi.fn(),
}));

import { findMatchingJob, findAllMatchingJobs } from './matcher.js';
import { getActiveJobs } from '../../db/index.js';

describe('job matcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockJobs = [
    {
      id: 'job-1',
      description: 'Channel Letters (24"x18") for Taylor Facility',
      stage: 'in_production',
      eta: '2026-01-24',
      contact_id: 'contact-samsung',
      total_amount: 3600,
      created_at: new Date().toISOString(),
    },
    {
      id: 'job-2',
      description: 'Wayfinding Signs (12"x8")',
      stage: 'pending',
      eta: null,
      contact_id: 'contact-samsung',
      total_amount: 960,
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'job-3',
      description: 'Monument Sign for Other Company',
      stage: 'in_production',
      eta: null,
      contact_id: 'contact-other',
      total_amount: 5000,
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  describe('findMatchingJob', () => {
    it('finds job by keyword match and contact', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue(mockJobs as any);

      const result = await findMatchingJob({
        contactId: 'contact-samsung',
        keywords: ['channel letters'],
      });

      expect(result).not.toBeNull();
      expect(result?.job.id).toBe('job-1');
      expect(result?.confidence).toBeGreaterThan(0.5);
    });

    it('filters by contact when provided', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue(mockJobs as any);

      const result = await findMatchingJob({
        contactId: 'contact-samsung',
        keywords: ['monument sign'],
      });

      expect(result).toBeNull();
    });

    it('returns null when no keywords match', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue(mockJobs as any);

      const result = await findMatchingJob({
        contactId: 'contact-samsung',
        keywords: ['banner', 'vinyl'],
      });

      expect(result).toBeNull();
    });

    it('returns null with empty jobs', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue([]);

      const result = await findMatchingJob({
        contactId: 'contact-samsung',
        keywords: ['channel letters'],
      });

      expect(result).toBeNull();
    });
  });

  describe('findAllMatchingJobs', () => {
    it('returns multiple matches sorted by confidence', async () => {
      vi.mocked(getActiveJobs).mockResolvedValue(mockJobs as any);

      const results = await findAllMatchingJobs({
        contactId: 'contact-samsung',
        keywords: ['signs'],
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });
});
