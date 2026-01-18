import {
  getPricingSuggestion,
  findSignTypeByName,
  findMaterialByName,
  type PricingSuggestion,
  type SignType,
  type Material,
} from '../../db/index.js';

export interface PricedItem {
  description: string;
  signType: string | null;
  signTypeId: string | null;
  material: string | null;
  materialId: string | null;
  width: number;
  height: number;
  sqft: number;
  quantity: number;
  suggestedUnitPrice: number;
  suggestedTotal: number;
  confidence: 'high' | 'medium' | 'low';
  sampleSize: number;
  winRate: number;
  priceSource: 'history' | 'base_formula' | 'minimum';
}

export interface ItemInput {
  signType: string;
  size: string;
  quantity: number;
  description?: string;
  material?: string;
}

function parseDimensions(size: string): { width: number; height: number } {
  // Parse common formats: "24x36", "24\"x36\"", "24 x 36", "2'x3'"
  const match = size.match(/(\d+(?:\.\d+)?)\s*['"]?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*['"]?/);

  if (!match) {
    // Default to 24x24 if parsing fails
    return { width: 24, height: 24 };
  }

  let width = parseFloat(match[1]);
  let height = parseFloat(match[2]);

  // If dimensions seem to be in feet (small numbers), convert to inches
  if (width <= 10 && height <= 10) {
    width *= 12;
    height *= 12;
  }

  return { width, height };
}

export async function suggestPriceForItem(input: ItemInput): Promise<PricedItem> {
  const { width, height } = parseDimensions(input.size);
  const sqft = (width * height) / 144;

  // Look up sign type and material
  const signType: SignType | null = await findSignTypeByName(input.signType);
  const material: Material | null = input.material
    ? await findMaterialByName(input.material)
    : null;

  // Try to get pricing from history
  const suggestion = await getPricingSuggestion({
    signTypeId: signType?.id,
    materialId: material?.id,
    sqft,
  });

  let suggestedUnitPrice: number;
  let confidence: 'high' | 'medium' | 'low';
  let sampleSize = 0;
  let winRate = 0;
  let priceSource: 'history' | 'base_formula' | 'minimum';

  if (suggestion && suggestion.sampleSize >= 3) {
    // Use historical pricing
    suggestedUnitPrice = suggestion.suggestedTotal;
    confidence = suggestion.confidence;
    sampleSize = suggestion.sampleSize;
    winRate = suggestion.winRate;
    priceSource = 'history';

    // Apply material multiplier if available
    if (material) {
      suggestedUnitPrice *= material.price_multiplier;
    }
  } else if (signType?.base_price_per_sqft) {
    // Fall back to base formula
    suggestedUnitPrice = sqft * signType.base_price_per_sqft;

    // Apply material multiplier
    if (material) {
      suggestedUnitPrice *= material.price_multiplier;
    }

    // Enforce minimum
    if (signType.min_price && suggestedUnitPrice < signType.min_price) {
      suggestedUnitPrice = signType.min_price;
      priceSource = 'minimum';
    } else {
      priceSource = 'base_formula';
    }

    confidence = 'low';
  } else {
    // No data at all - use generic fallback
    suggestedUnitPrice = sqft * 30; // Generic $30/sqft
    confidence = 'low';
    priceSource = 'base_formula';
  }

  // Round to nearest dollar
  suggestedUnitPrice = Math.round(suggestedUnitPrice);

  return {
    description: input.description || `${input.signType} ${input.size}`,
    signType: signType?.name || input.signType,
    signTypeId: signType?.id || null,
    material: material?.name || input.material || null,
    materialId: material?.id || null,
    width,
    height,
    sqft: Math.round(sqft * 100) / 100,
    quantity: input.quantity,
    suggestedUnitPrice,
    suggestedTotal: suggestedUnitPrice * input.quantity,
    confidence,
    sampleSize,
    winRate,
    priceSource,
  };
}

export async function suggestPricesForEstimate(items: ItemInput[]): Promise<PricedItem[]> {
  return Promise.all(items.map(item => suggestPriceForItem(item)));
}

export function formatPriceConfidence(item: PricedItem): string {
  if (item.confidence === 'high') {
    return `⭐ High confidence (${item.sampleSize} similar jobs, ${Math.round(item.winRate * 100)}% win rate)`;
  } else if (item.confidence === 'medium') {
    return `📊 Medium confidence (${item.sampleSize} similar jobs)`;
  } else {
    if (item.priceSource === 'minimum') {
      return '⚠️ Low confidence (using minimum price)';
    }
    return '⚠️ Low confidence (using base formula)';
  }
}
