-- Add invoiced and paid stages to jobs
ALTER TABLE jobs
DROP CONSTRAINT IF EXISTS jobs_stage_check;

ALTER TABLE jobs
ADD CONSTRAINT jobs_stage_check
CHECK (stage IN ('pending', 'in_production', 'ready', 'installed', 'completed', 'invoiced', 'paid'));

-- Create invoices table
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  estimate_id UUID REFERENCES estimates(id),
  quickbooks_invoice_id TEXT,
  quickbooks_doc_number TEXT,
  total DECIMAL(10, 2) NOT NULL,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for job lookup
CREATE INDEX idx_invoices_job_id ON invoices(job_id);

-- RLS policies
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to invoices"
  ON invoices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
