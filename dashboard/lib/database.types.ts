export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  is_active: boolean;
  created_at: string;
}

export interface EstimateItem {
  description: string;
  signType?: string;
  material?: string;
  width?: number;
  height?: number;
  quantity: number;
  unitPrice: number;
  suggestedPrice?: number;
  confidence?: 'high' | 'medium' | 'low';
}

export interface Estimate {
  id: string;
  contact_id: string | null;
  gmail_message_id: string | null;
  quickbooks_estimate_id: string | null;
  quickbooks_doc_number: string | null;
  quickbooks_customer_id: string | null;
  status: 'draft' | 'sent' | 'won' | 'lost' | 'expired';
  total_amount: number | null;
  items: EstimateItem[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  estimate_id: string | null;
  contact_id: string | null;
  description: string;
  stage: 'pending' | 'in_production' | 'ready' | 'installed' | 'completed';
  eta: string | null;
  total_amount: number | null;
  quickbooks_invoice_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignType {
  id: string;
  name: string;
  category: string | null;
  base_price_per_sqft: number | null;
  min_price: number | null;
}

export interface Material {
  id: string;
  name: string;
  price_multiplier: number;
}

export interface PricingHistory {
  id: string;
  sign_type_id: string | null;
  material_id: string | null;
  description: string | null;
  width_inches: number | null;
  height_inches: number | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  outcome: 'won' | 'lost' | 'pending';
  quickbooks_estimate_id: string | null;
  contact_id: string | null;
  created_at: string;
}

// Joined types for UI
export interface EstimateWithContact extends Estimate {
  contact: Contact | null;
}

export interface JobWithContact extends Job {
  contact: Contact | null;
  estimate: Estimate | null;
}
