-- RLS on SearchHistory, like every other table.
--
-- Its own migration rather than an edit to the one that created the table:
-- that one had already been applied, and changing an applied migration breaks
-- its checksum for every database that ran the original.
--
-- No policy is defined, which is deliberate and matches the rest of the schema:
-- PostgREST reaches nothing, and the backend's owner connection bypasses RLS.
ALTER TABLE "SearchHistory" ENABLE ROW LEVEL SECURITY;
