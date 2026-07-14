# Duplicate Flight Upload Prevention Design

## Goal

Prevent an identical IGC file from being uploaded more than once anywhere in Glidehero. A duplicate attempt must not leave a new object, IGC-file record, or flight record behind.

## Scope

- Deduplicate by the exact uploaded file bytes, globally across all pilots.
- Store the file digest on `flights`, as requested.
- Preserve the existing upload, processing, and cleanup boundaries.

This is pre-v1 work. Existing flights are not backfilled and no data-retention work is included.

## Data Model

Add `content_hash` to `flights` as a required text field with a global unique constraint. It contains the lowercase hexadecimal SHA-256 digest of the uploaded bytes.

SHA-256 is inexpensive for the existing 10 MB upload limit and makes accidental collisions impractical. The database constraint is the final authority for global uniqueness and concurrent uploads.

## Upload Flow

1. The IGC upload service computes the SHA-256 digest from the in-memory file bytes.
2. Before writing to object storage, it looks up an existing flight with that digest.
3. When found, it returns a first-class duplicate outcome with the message: `This flight has already been uploaded.` No object or metadata is created.
4. When absent, the service follows the existing flow: upload the object, insert the IGC-file metadata, then invoke flight processing with the digest.
5. Flight processing persists the digest while inserting the flight.
6. If another upload wins the race after the pre-check, the unique-constraint conflict is recognized as the same duplicate outcome. The losing upload's IGC-file metadata and object are deleted before returning.

The duplicate outcome is distinct from a parsing or storage failure. The web router renders it as a validation-style upload error rather than redirecting with the success toast.

## Error Handling and Cleanup

- A duplicate detected before storage performs no writes.
- A concurrent duplicate that reaches storage removes both its database metadata and S3 object.
- Existing cleanup for failures while inserting IGC-file metadata remains intact.
- A failed first processing attempt still occupies its digest because a matching flight entry exists; a later identical upload is a duplicate under the global-entry rule.

## Testing

- Unit test SHA-256-derived duplicate lookup and verify duplicate attempts do not call object storage or processing.
- Unit test the processor includes the digest in its flight insert.
- Unit test conflict cleanup and conversion to the duplicate outcome.
- Integration test that the first upload succeeds and a second upload with the same bytes produces the duplicate outcome with exactly one flight and one IGC-file record.
- Add router coverage that a duplicate response renders the duplicate message instead of the success redirect.

## Out of Scope

- Normalizing semantically equivalent but byte-different IGC files.
- Deduplicating existing database rows.
- Changing ownership or sharing behavior for the original flight.
