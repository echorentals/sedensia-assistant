import { supabase } from './client.js';

export interface PricingSuggestion {
  suggestedPricePerSqft: number;
  suggestedTotal: number;
  confidence: 'high' | 'medium' | 'low';
  sampleSize: number;
  winRate: number;
}

export interface PricingQuery {
  signTypeId?: string;
  materialId?: string;
  sqft: number;
}

export async function getPricingSuggestion(query: PricingQuery): Promise<PricingSuggestion | null> {
  const minSqft = query.sqft * 0.7;
  const maxSqft = query.sqft * 1.3;

  let dbQuery = supabase
    .from('pricing_history')
    .select('unit_price, total_price, width_inches, height_inches, outcome');

  if (query.signTypeId) {
    dbQuery = dbQuery.eq('sign_type_id', query.signTypeId);
  }

  if (query.materialId) {
    dbQuery = dbQuery.eq('material_id', query.materialId);
  }

  const { data, error } = await dbQuery.neq('outcome', 'pending');

  if (error || !data || data.length === 0) {
    return null;
  }

  // Filter by sqft range in memory (since sqft is computed)
  const filtered = data.filter(row => {
    const rowSqft = (row.width_inches * row.height_inches) / 144;
    return rowSqft >= minSqft && rowSqft <= maxSqft;
  });

  if (filtered.length === 0) {
    return null;
  }

  // Calculate average price per sqft
  const pricesPerSqft = filtered.map(row => {
    const rowSqft = (row.width_inches * row.height_inches) / 144;
    return row.unit_price / (rowSqft || 1);
  });

  const avgPricePerSqft = pricesPerSqft.reduce((a, b) => a + b, 0) / pricesPerSqft.length;

  // Calculate win rate
  const wins = filtered.filter(row => row.outcome === 'won').length;
  const winRate = wins / filtered.length;

  // Adjust based on win rate
  let adjustedPrice = avgPricePerSqft;
  if (winRate > 0.7) {
    adjustedPrice *= 1.1; // Room for margin
  } else if (winRate < 0.4) {
    adjustedPrice *= 0.9; // Need to be more competitive
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low';
  if (filtered.length >= 10) {
    confidence = 'high';
  } else if (filtered.length >= 3) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    suggestedPricePerSqft: Math.round(adjustedPrice * 100) / 100,
    suggestedTotal: Math.round(adjustedPrice * query.sqft * 100) / 100,
    confidence,
    sampleSize: filtered.length,
    winRate: Math.round(winRate * 100) / 100,
  };
}

export interface RecordPricingInput {
  signTypeId?: string;
  materialId?: string;
  description: string;
  widthInches: number;
  heightInches: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  outcome?: 'won' | 'lost' | 'pending';
  quickbooksEstimateId?: string;
  contactId?: string;
}

export async function recordPricingHistory(input: RecordPricingInput): Promise<boolean> {
  const { error } = await supabase
    .from('pricing_history')
    .insert({
      sign_type_id: input.signTypeId || null,
      material_id: input.materialId || null,
      description: input.description,
      width_inches: input.widthInches,
      height_inches: input.heightInches,
      quantity: input.quantity,
      unit_price: input.unitPrice,
      total_price: input.totalPrice,
      outcome: input.outcome || 'pending',
      quickbooks_estimate_id: input.quickbooksEstimateId || null,
      contact_id: input.contactId || null,
    });

  if (error) {
    console.error('Failed to record pricing history:', error);
    return false;
  }

  return true;
}

export async function updatePricingOutcome(
  quickbooksEstimateId: string,
  outcome: 'won' | 'lost'
): Promise<boolean> {
  const { error } = await supabase
    .from('pricing_history')
    .update({ outcome })
    .eq('quickbooks_estimate_id', quickbooksEstimateId);

  if (error) {
    console.error('Failed to update pricing outcome:', error);
    return false;
  }

  return true;
}

export interface SignType {
  id: string;
  name: string;
  category: string | null;
  base_price_per_sqft: number | null;
  min_price: number | null;
}

export async function getSignTypes(): Promise<SignType[]> {
  const { data, error } = await supabase
    .from('sign_types')
    .select('*')
    .order('name');

  if (error || !data) {
    console.error('Failed to fetch sign types:', error);
    return [];
  }

  return data as SignType[];
}

export async function findSignTypeByName(name: string): Promise<SignType | null> {
  const { data, error } = await supabase
    .from('sign_types')
    .select('*')
    .ilike('name', `%${name}%`)
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data as SignType;
}

export interface Material {
  id: string;
  name: string;
  price_multiplier: number;
}

export async function getMaterials(): Promise<Material[]> {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .order('name');

  if (error || !data) {
    console.error('Failed to fetch materials:', error);
    return [];
  }

  return data as Material[];
}

export async function findMaterialByName(name: string): Promise<Material | null> {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .ilike('name', `%${name}%`)
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Material;
}
