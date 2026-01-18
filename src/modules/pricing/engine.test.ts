import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PricingSuggestion, SignType, Material } from '../../db/index.js';

// Mock the database module
const mockGetPricingSuggestion = vi.fn<() => Promise<PricingSuggestion | null>>();
const mockFindSignTypeByName = vi.fn<() => Promise<SignType | null>>();
const mockFindMaterialByName = vi.fn<() => Promise<Material | null>>();

vi.mock('../../db/index.js', () => ({
  getPricingSuggestion: (...args: unknown[]) => mockGetPricingSuggestion(...args),
  findSignTypeByName: (...args: unknown[]) => mockFindSignTypeByName(...args),
  findMaterialByName: (...args: unknown[]) => mockFindMaterialByName(...args),
}));

describe('pricing engine', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('parseDimensions', () => {
    let parseDimensions: (size: string) => { width: number; height: number };
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = await import('./engine.js');
      parseDimensions = engine.parseDimensions;
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('parses simple format "24x36"', () => {
      expect(parseDimensions('24x36')).toEqual({ width: 24, height: 36 });
    });

    it('parses format with spaces "24 x 36"', () => {
      expect(parseDimensions('24 x 36')).toEqual({ width: 24, height: 36 });
    });

    it('parses format with inches "24\"x36\""', () => {
      expect(parseDimensions('24"x36"')).toEqual({ width: 24, height: 36 });
    });

    it('parses format with uppercase X "24X36"', () => {
      expect(parseDimensions('24X36')).toEqual({ width: 24, height: 36 });
    });

    it('parses multiplication sign "24×36"', () => {
      expect(parseDimensions('24×36')).toEqual({ width: 24, height: 36 });
    });

    it('parses decimal dimensions "24.5x36.5"', () => {
      expect(parseDimensions('24.5x36.5')).toEqual({ width: 24.5, height: 36.5 });
    });

    it('converts feet to inches for small dimensions "2x3"', () => {
      // Dimensions <= 10 are assumed to be feet
      expect(parseDimensions('2x3')).toEqual({ width: 24, height: 36 });
    });

    it('converts feet format "2\'x3\'"', () => {
      expect(parseDimensions("2'x3'")).toEqual({ width: 24, height: 36 });
    });

    it('does not convert dimensions > 10 (assumed inches)', () => {
      expect(parseDimensions('12x18')).toEqual({ width: 12, height: 18 });
    });

    it('returns default 24x24 for unparseable input and logs warning', () => {
      expect(parseDimensions('invalid')).toEqual({ width: 24, height: 24 });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to parse dimensions from size string: "invalid", defaulting to 24x24'
      );
    });

    it('returns default 24x24 for empty string and logs warning', () => {
      expect(parseDimensions('')).toEqual({ width: 24, height: 24 });
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });

  describe('suggestPriceForItem', () => {
    let suggestPriceForItem: typeof import('./engine.js').suggestPriceForItem;

    beforeEach(async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = await import('./engine.js');
      suggestPriceForItem = engine.suggestPriceForItem;
    });

    describe('when historical pricing is available (sampleSize >= 3)', () => {
      beforeEach(() => {
        mockGetPricingSuggestion.mockResolvedValue({
          suggestedPricePerSqft: 45,
          suggestedTotal: 180, // Price for ONE item at this sqft
          confidence: 'high',
          sampleSize: 15,
          winRate: 0.75,
        });
        mockFindSignTypeByName.mockResolvedValue({
          id: 'sign-123',
          name: 'Channel Letters',
          category: 'illuminated',
          base_price_per_sqft: 45,
          min_price: 500,
        });
        mockFindMaterialByName.mockResolvedValue(null);
      });

      it('uses historical pricing with priceSource "history"', async () => {
        const result = await suggestPriceForItem({
          signType: 'Channel Letters',
          size: '24x24',
          quantity: 2,
        });

        expect(result.priceSource).toBe('history');
        expect(result.suggestedUnitPrice).toBe(180); // From suggestedTotal
        expect(result.suggestedTotal).toBe(360); // 180 * 2 quantity
        expect(result.confidence).toBe('high');
        expect(result.sampleSize).toBe(15);
        expect(result.winRate).toBe(0.75);
      });

      it('applies material multiplier to historical pricing', async () => {
        mockFindMaterialByName.mockResolvedValue({
          id: 'mat-123',
          name: 'Stainless Steel',
          price_multiplier: 1.5,
        });

        const result = await suggestPriceForItem({
          signType: 'Channel Letters',
          size: '24x24',
          quantity: 1,
          material: 'Stainless Steel',
        });

        expect(result.priceSource).toBe('history');
        // 180 * 1.5 = 270
        expect(result.suggestedUnitPrice).toBe(270);
        expect(result.suggestedTotal).toBe(270);
      });
    });

    describe('when historical pricing has insufficient samples (sampleSize < 3)', () => {
      beforeEach(() => {
        mockGetPricingSuggestion.mockResolvedValue({
          suggestedPricePerSqft: 45,
          suggestedTotal: 180,
          confidence: 'low',
          sampleSize: 2, // Less than 3
          winRate: 0.5,
        });
      });

      it('falls back to base formula when sign type has base_price_per_sqft', async () => {
        mockFindSignTypeByName.mockResolvedValue({
          id: 'sign-123',
          name: 'Channel Letters',
          category: 'illuminated',
          base_price_per_sqft: 50,
          min_price: 100,
        });
        mockFindMaterialByName.mockResolvedValue(null);

        // 24x24 = 576 sq inches = 4 sqft
        const result = await suggestPriceForItem({
          signType: 'Channel Letters',
          size: '24x24',
          quantity: 1,
        });

        expect(result.priceSource).toBe('base_formula');
        // 4 sqft * $50/sqft = $200
        expect(result.suggestedUnitPrice).toBe(200);
        expect(result.confidence).toBe('low');
      });

      it('uses minimum price when base formula is below minimum', async () => {
        mockFindSignTypeByName.mockResolvedValue({
          id: 'sign-123',
          name: 'Small Sign',
          category: 'basic',
          base_price_per_sqft: 10,
          min_price: 500,
        });
        mockFindMaterialByName.mockResolvedValue(null);

        // 12x12 = 144 sq inches = 1 sqft
        // Base formula: 1 * $10 = $10, but min is $500
        const result = await suggestPriceForItem({
          signType: 'Small Sign',
          size: '12x12',
          quantity: 1,
        });

        expect(result.priceSource).toBe('minimum');
        expect(result.suggestedUnitPrice).toBe(500);
        expect(result.confidence).toBe('low');
      });

      it('applies material multiplier to base formula', async () => {
        mockFindSignTypeByName.mockResolvedValue({
          id: 'sign-123',
          name: 'Channel Letters',
          category: 'illuminated',
          base_price_per_sqft: 50,
          min_price: 100,
        });
        mockFindMaterialByName.mockResolvedValue({
          id: 'mat-123',
          name: 'Aluminum',
          price_multiplier: 1.2,
        });

        // 24x24 = 4 sqft, base = 4 * 50 = 200, with multiplier = 240
        const result = await suggestPriceForItem({
          signType: 'Channel Letters',
          size: '24x24',
          quantity: 1,
          material: 'Aluminum',
        });

        expect(result.priceSource).toBe('base_formula');
        expect(result.suggestedUnitPrice).toBe(240);
      });
    });

    describe('when no pricing data is available', () => {
      beforeEach(() => {
        mockGetPricingSuggestion.mockResolvedValue(null);
        mockFindSignTypeByName.mockResolvedValue(null);
        mockFindMaterialByName.mockResolvedValue(null);
      });

      it('uses generic fallback of $30/sqft', async () => {
        // 24x24 = 4 sqft, 4 * $30 = $120
        const result = await suggestPriceForItem({
          signType: 'Unknown Sign',
          size: '24x24',
          quantity: 1,
        });

        expect(result.priceSource).toBe('base_formula');
        expect(result.suggestedUnitPrice).toBe(120);
        expect(result.confidence).toBe('low');
        expect(result.sampleSize).toBe(0);
        expect(result.winRate).toBe(0);
      });

      it('uses generic fallback when sign type has no base_price_per_sqft', async () => {
        mockFindSignTypeByName.mockResolvedValue({
          id: 'sign-123',
          name: 'Custom Sign',
          category: 'custom',
          base_price_per_sqft: null,
          min_price: null,
        });

        // 24x24 = 4 sqft, 4 * $30 = $120
        const result = await suggestPriceForItem({
          signType: 'Custom Sign',
          size: '24x24',
          quantity: 1,
        });

        expect(result.priceSource).toBe('base_formula');
        expect(result.suggestedUnitPrice).toBe(120);
      });
    });

    describe('confidence levels from historical data', () => {
      beforeEach(() => {
        mockFindSignTypeByName.mockResolvedValue({
          id: 'sign-123',
          name: 'Channel Letters',
          category: 'illuminated',
          base_price_per_sqft: 45,
          min_price: 500,
        });
        mockFindMaterialByName.mockResolvedValue(null);
      });

      it('returns high confidence when sampleSize >= 10', async () => {
        mockGetPricingSuggestion.mockResolvedValue({
          suggestedPricePerSqft: 45,
          suggestedTotal: 180,
          confidence: 'high',
          sampleSize: 10,
          winRate: 0.75,
        });

        const result = await suggestPriceForItem({
          signType: 'Channel Letters',
          size: '24x24',
          quantity: 1,
        });

        expect(result.confidence).toBe('high');
      });

      it('returns medium confidence when sampleSize >= 3 and < 10', async () => {
        mockGetPricingSuggestion.mockResolvedValue({
          suggestedPricePerSqft: 45,
          suggestedTotal: 180,
          confidence: 'medium',
          sampleSize: 5,
          winRate: 0.6,
        });

        const result = await suggestPriceForItem({
          signType: 'Channel Letters',
          size: '24x24',
          quantity: 1,
        });

        expect(result.confidence).toBe('medium');
      });
    });

    describe('output structure', () => {
      beforeEach(() => {
        mockGetPricingSuggestion.mockResolvedValue(null);
        mockFindSignTypeByName.mockResolvedValue({
          id: 'sign-123',
          name: 'Channel Letters',
          category: 'illuminated',
          base_price_per_sqft: 45,
          min_price: 100,
        });
        mockFindMaterialByName.mockResolvedValue({
          id: 'mat-456',
          name: 'Aluminum',
          price_multiplier: 1.0,
        });
      });

      it('returns all expected fields with correct values', async () => {
        const result = await suggestPriceForItem({
          signType: 'Channel Letters',
          size: '24x36',
          quantity: 3,
          description: 'Custom channel letters',
          material: 'Aluminum',
        });

        expect(result).toEqual({
          description: 'Custom channel letters',
          signType: 'Channel Letters',
          signTypeId: 'sign-123',
          material: 'Aluminum',
          materialId: 'mat-456',
          width: 24,
          height: 36,
          sqft: 6, // 24*36/144 = 6
          quantity: 3,
          suggestedUnitPrice: 270, // 6 sqft * $45
          suggestedTotal: 810, // 270 * 3
          confidence: 'low',
          sampleSize: 0,
          winRate: 0,
          priceSource: 'base_formula',
        });
      });

      it('uses default description when not provided', async () => {
        const result = await suggestPriceForItem({
          signType: 'Channel Letters',
          size: '24x36',
          quantity: 1,
        });

        expect(result.description).toBe('Channel Letters 24x36');
      });

      it('rounds sqft to 2 decimal places', async () => {
        const result = await suggestPriceForItem({
          signType: 'Channel Letters',
          size: '25x37', // 925/144 = 6.4236...
          quantity: 1,
        });

        expect(result.sqft).toBe(6.42);
      });
    });
  });

  describe('suggestPricesForEstimate', () => {
    let suggestPricesForEstimate: typeof import('./engine.js').suggestPricesForEstimate;

    beforeEach(async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockGetPricingSuggestion.mockResolvedValue(null);
      mockFindSignTypeByName.mockResolvedValue(null);
      mockFindMaterialByName.mockResolvedValue(null);

      const engine = await import('./engine.js');
      suggestPricesForEstimate = engine.suggestPricesForEstimate;
    });

    it('prices multiple items', async () => {
      const results = await suggestPricesForEstimate([
        { signType: 'Sign A', size: '24x24', quantity: 1 },
        { signType: 'Sign B', size: '24x24', quantity: 2 },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].signType).toBe('Sign A');
      expect(results[1].signType).toBe('Sign B');
    });

    it('returns empty array for empty input', async () => {
      const results = await suggestPricesForEstimate([]);
      expect(results).toEqual([]);
    });
  });

  describe('formatPriceConfidence', () => {
    let formatPriceConfidence: typeof import('./engine.js').formatPriceConfidence;
    let basePricedItem: import('./engine.js').PricedItem;

    beforeEach(async () => {
      const engine = await import('./engine.js');
      formatPriceConfidence = engine.formatPriceConfidence;
      basePricedItem = {
        description: 'Test',
        signType: 'Test',
        signTypeId: null,
        material: null,
        materialId: null,
        width: 24,
        height: 24,
        sqft: 4,
        quantity: 1,
        suggestedUnitPrice: 100,
        suggestedTotal: 100,
        confidence: 'low',
        sampleSize: 0,
        winRate: 0,
        priceSource: 'base_formula',
      };
    });

    it('formats high confidence with sample size and win rate', () => {
      const item = { ...basePricedItem, confidence: 'high' as const, sampleSize: 15, winRate: 0.75 };
      const result = formatPriceConfidence(item);
      expect(result).toContain('High confidence');
      expect(result).toContain('15 similar jobs');
      expect(result).toContain('75% win rate');
    });

    it('formats medium confidence with sample size', () => {
      const item = { ...basePricedItem, confidence: 'medium' as const, sampleSize: 5 };
      const result = formatPriceConfidence(item);
      expect(result).toContain('Medium confidence');
      expect(result).toContain('5 similar jobs');
    });

    it('formats low confidence with minimum price source', () => {
      const item = { ...basePricedItem, confidence: 'low' as const, priceSource: 'minimum' as const };
      const result = formatPriceConfidence(item);
      expect(result).toContain('Low confidence');
      expect(result).toContain('using minimum price');
    });

    it('formats low confidence with base formula source', () => {
      const item = { ...basePricedItem, confidence: 'low' as const, priceSource: 'base_formula' as const };
      const result = formatPriceConfidence(item);
      expect(result).toContain('Low confidence');
      expect(result).toContain('using base formula');
    });
  });
});
