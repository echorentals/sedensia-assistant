import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  getPricingSuggestion: vi.fn(() => Promise.resolve({
    suggestedPricePerSqft: 45,
    suggestedTotal: 1800,
    confidence: 'high',
    sampleSize: 15,
    winRate: 0.75,
  })),
  findSignTypeByName: vi.fn(() => Promise.resolve({
    id: 'sign-123',
    name: 'Channel Letters',
    base_price_per_sqft: 45,
    min_price: 500,
  })),
  findMaterialByName: vi.fn(() => Promise.resolve({
    id: 'mat-123',
    name: 'Aluminum',
    price_multiplier: 1.0,
  })),
}));

describe('pricing engine', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports suggestPriceForItem function', async () => {
    const engine = await import('./engine.js');
    expect(engine.suggestPriceForItem).toBeDefined();
  });

  it('exports suggestPricesForEstimate function', async () => {
    const engine = await import('./engine.js');
    expect(engine.suggestPricesForEstimate).toBeDefined();
  });
});
