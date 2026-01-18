-- Jobs table for tracking won work
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  estimate_id UUID REFERENCES estimates(id),
  contact_id UUID REFERENCES contacts(id),
  description TEXT NOT NULL,
  stage TEXT CHECK (stage IN ('pending', 'in_production', 'ready', 'installed', 'completed')) DEFAULT 'pending',
  eta DATE,
  total_amount DECIMAL(10,2),
  quickbooks_invoice_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_jobs_stage ON jobs(stage);
CREATE INDEX idx_jobs_contact ON jobs(contact_id);
CREATE INDEX idx_jobs_estimate ON jobs(estimate_id);
