
-- Preferences table (one row per user)
CREATE TABLE public.proximity_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_radius_km numeric NOT NULL DEFAULT 50,
  enabled_categories jsonb NOT NULL DEFAULT '["conflicts","hotspots","natural","outages","sanctions","iranAttacks","weather"]'::jsonb,
  severity_threshold text NOT NULL DEFAULT 'low',
  audible_ping boolean NOT NULL DEFAULT false,
  sync_coordinates boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proximity_preferences TO authenticated;
GRANT ALL ON public.proximity_preferences TO service_role;

ALTER TABLE public.proximity_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prox_prefs_select_own" ON public.proximity_preferences
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "prox_prefs_insert_own" ON public.proximity_preferences
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "prox_prefs_update_own" ON public.proximity_preferences
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "prox_prefs_delete_own" ON public.proximity_preferences
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_prox_prefs_updated_at
  BEFORE UPDATE ON public.proximity_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Asset sets table
CREATE TABLE public.proximity_asset_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#22d3ee',
  default_radius_km numeric NOT NULL DEFAULT 50,
  asset_count integer NOT NULL DEFAULT 0,
  private_assets jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prox_asset_sets_user ON public.proximity_asset_sets(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proximity_asset_sets TO authenticated;
GRANT ALL ON public.proximity_asset_sets TO service_role;

ALTER TABLE public.proximity_asset_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prox_sets_select_own" ON public.proximity_asset_sets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "prox_sets_insert_own" ON public.proximity_asset_sets
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "prox_sets_update_own" ON public.proximity_asset_sets
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "prox_sets_delete_own" ON public.proximity_asset_sets
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_prox_sets_updated_at
  BEFORE UPDATE ON public.proximity_asset_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
