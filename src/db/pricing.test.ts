import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          neq: vi.fn(() => Promise.resolve({
            data: [
              { unit_price: 45, outcome: 'won', width_inches: 24, height_inches: 36 },
              { unit_price: 50, outcome: 'won', width_inches: 24, height_inches: 36 },
              { unit_price: 55, outcome: 'lost', width_inches: 24, height_inches: 36 },
            ],
            error: null,
          })),
        })),
        ilike: vi.fn(() => ({
          limit: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({
              data: { id: 'sign-123', name: 'Channel Letters' },
              error: null,
            })),
          })),
        })),
        order: vi.fn(() => Promise.resolve({
          data: [{ id: '1', name: 'Channel Letters' }],
          error: null,
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
  },
}));

describe('pricing repository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports getPricingSuggestion function', async () => {
    const pricing = await import('./pricing.js');
    expect(pricing.getPricingSuggestion).toBeDefined();
  });

  it('exports recordPricingHistory function', async () => {
    const pricing = await import('./pricing.js');
    expect(pricing.recordPricingHistory).toBeDefined();
  });

  it('exports getSignTypes function', async () => {
    const pricing = await import('./pricing.js');
    expect(pricing.getSignTypes).toBeDefined();
  });

  it('exports getMaterials function', async () => {
    const pricing = await import('./pricing.js');
    expect(pricing.getMaterials).toBeDefined();
  });
});
