-- Enable RLS on all tables
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sign_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_history ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users (allow all for now, single-tenant)
CREATE POLICY "Authenticated users can read contacts" ON contacts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert contacts" ON contacts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update contacts" ON contacts
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read estimates" ON estimates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read jobs" ON jobs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update jobs" ON jobs
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read sign_types" ON sign_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read materials" ON materials
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read pricing_history" ON pricing_history
  FOR SELECT TO authenticated USING (true);

-- Service role bypasses RLS for backend operations
