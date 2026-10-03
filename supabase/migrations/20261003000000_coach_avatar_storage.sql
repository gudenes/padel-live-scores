-- Coach identity and avatar_url already live in public.coaches.
-- Uploads are validated by the operator-only API and saved on that record.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('coach-avatars', 'coach-avatars', true, 2097152, ARRAY['image/webp'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Public read coach avatar images" ON storage.objects
  FOR SELECT USING (bucket_id = 'coach-avatars');
