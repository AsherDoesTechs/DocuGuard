-- Migration: Add full-text search on document content (OCR data + title)
-- Enables OCR-based search and indexing (study objective: search/retrieval).
--
-- A generated tsvector column combines the document title and the raw OCR
-- text extracted from ocr_data. A GIN index supports fast full-text queries.
-- Generated columns are maintained automatically by PostgreSQL; no trigger
-- is needed.

-- Build the search text from a document row. ocr_data stores the unparsed
-- Azure analyzer payload; .content holds the full document text.
CREATE OR REPLACE FUNCTION document_search_text(title text, ocr_data jsonb)
RETURNS tsvector AS $$
  SELECT
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(
      to_tsvector('english', COALESCE(
        ocr_data ->> 'content',
        (ocr_data -> 'raw' ->> 'content'),
        ''
      )),
      'B'
    );
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (document_search_text(title, ocr_data)) STORED;

CREATE INDEX IF NOT EXISTS idx_documents_search_vector
  ON documents USING GIN (search_vector);
