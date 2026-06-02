-- Order Form Attachments — adds structured-data column to prospect_attachments
-- so each order-form photo can carry its AI-extracted JSON (PRN number,
-- product, amounts, payment, card details, etc.) alongside the photo URL.
--
-- Used by: script.js scanOrderFormWithAI flow + supabase/functions/order-form-ocr
--
-- Safe to re-run.

-- 1. Add metadata JSONB column if it doesn't already exist.
ALTER TABLE public.prospect_attachments
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Add scanned_at + scan_confidence summary so we can sort / filter
ALTER TABLE public.prospect_attachments
    ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;
ALTER TABLE public.prospect_attachments
    ADD COLUMN IF NOT EXISTS scan_confidence NUMERIC(3,2);
        -- 0.00 .. 1.00, mean of per-field confidences (high=1, medium=0.6, low=0.3)

-- 3. Index for fast lookup of order-form attachments per prospect
CREATE INDEX IF NOT EXISTS prospect_attachments_order_form_idx
    ON public.prospect_attachments (prospect_id, attachment_type)
    WHERE attachment_type = 'order_form';

-- 4. Optional GIN index on metadata so we can search by PRN number etc.
CREATE INDEX IF NOT EXISTS prospect_attachments_metadata_gin
    ON public.prospect_attachments USING GIN (metadata);

-- 5. Comment for future readers
COMMENT ON COLUMN public.prospect_attachments.metadata IS
    'Structured data extracted from the attachment. For attachment_type=''order_form'' this is { form_type, prn_number, fields:{...}, confidence:{...}, raw_text, edited_by_agent:[...] }';
