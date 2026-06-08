-- Order Form Attachments — add collection_status column
-- Tracks whether the scanned order form data has been fully uploaded into CRM.
-- Default is 'pending'; agent sets to 'collected' once activity + prospect are done.

ALTER TABLE public.prospect_attachments
    ADD COLUMN IF NOT EXISTS collection_status TEXT
        NOT NULL DEFAULT 'pending'
        CHECK (collection_status IN ('pending', 'collected'));

CREATE INDEX IF NOT EXISTS prospect_attachments_collection_status_idx
    ON public.prospect_attachments (collection_status)
    WHERE attachment_type = 'order_form';

COMMENT ON COLUMN public.prospect_attachments.collection_status IS
    'pending = not yet uploaded to CRM; collected = agent has created the activity and linked the prospect.';
