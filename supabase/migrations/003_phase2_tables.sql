-- Sign types catalog with base pricing formulas
CREATE TABLE sign_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  base_price_per_sqft DECIMAL(10,2),
  min_price DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Materials with price multipliers
CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  price_multiplier DECIMAL(4,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Historical pricing from past jobs
CREATE TABLE pricing_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sign_type_id UUID REFERENCES sign_types(id),
  material_id UUID REFERENCES materials(id),
  description TEXT,
  width_inches DECIMAL(8,2),
  height_inches DECIMAL(8,2),
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  outcome TEXT CHECK (outcome IN ('won', 'lost', 'pending')) DEFAULT 'pending',
  quickbooks_estimate_id TEXT,
  quickbooks_invoice_id TEXT,
  contact_id UUID REFERENCES contacts(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Estimates we create
CREATE TABLE estimates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID REFERENCES contacts(id),
  gmail_message_id TEXT,
  quickbooks_estimate_id TEXT,
  quickbooks_doc_number TEXT,
  quickbooks_customer_id TEXT,
  status TEXT CHECK (status IN ('draft', 'sent', 'won', 'lost', 'expired')) DEFAULT 'draft',
  total_amount DECIMAL(10,2),
  items JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_pricing_history_sign_type ON pricing_history(sign_type_id);
CREATE INDEX idx_pricing_history_outcome ON pricing_history(outcome);
CREATE INDEX idx_estimates_status ON estimates(status);
CREATE INDEX idx_estimates_contact ON estimates(contact_id);
CREATE INDEX idx_estimates_qb_id ON estimates(quickbooks_estimate_id);

-- Seed common sign types
INSERT INTO sign_types (name, category, base_price_per_sqft, min_price) VALUES
  ('Channel Letters', 'Illuminated', 45.00, 500),
  ('Monument Sign', 'Ground', 35.00, 1500),
  ('Pylon Sign', 'Ground', 40.00, 3000),
  ('Wall Sign', 'Flat', 25.00, 300),
  ('Wayfinding Sign', 'Directional', 20.00, 150),
  ('ADA Sign', 'Compliance', 15.00, 75),
  ('Vinyl Graphics', 'Flat', 12.00, 100),
  ('Vehicle Wrap', 'Vehicle', 18.00, 500),
  ('Banner', 'Temporary', 8.00, 50),
  ('A-Frame', 'Portable', 0, 150);

-- Seed common materials
INSERT INTO materials (name, price_multiplier) VALUES
  ('Aluminum', 1.0),
  ('Acrylic', 1.1),
  ('Dibond', 0.9),
  ('PVC', 0.8),
  ('Coroplast', 0.5),
  ('HDU (High Density Urethane)', 1.3),
  ('Stainless Steel', 1.5),
  ('Bronze', 2.0),
  ('LED Module', 1.2),
  ('Neon', 1.4);
