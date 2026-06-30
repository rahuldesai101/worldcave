-- Remove publicly-readable storage policy on the private event-images bucket.
DROP POLICY IF EXISTS "Public can view event images" ON storage.objects;

-- Restrict event registration visibility: event creators can only see aggregate info,
-- not attendee user_ids. Drop the broad creator-read policy; attendees see only their own row.
DROP POLICY IF EXISTS "Event creators can view registrations" ON public.event_registrations;