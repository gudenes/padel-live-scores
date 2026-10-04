-- Wardrobe introduction is separate from prediction onboarding; completion is account-scoped.
CREATE TABLE IF NOT EXISTS public.play_shop_guide (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.play_shop_guide ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.play_shop_guide FROM anon, authenticated;
GRANT ALL ON public.play_shop_guide TO service_role;
