# Catalog lock incident recovery

XLSX applies and admin product/image writes use the unique running
`sync_runs` row for provider `xlsx:kiotviet` as a lock. An interrupted
invocation or a failure while recording its outcome can leave that row
running indefinitely. **Age is not evidence that its owner has stopped.**
There is no automatic expiry, and deleting or updating a live owner's row
can allow overlapping writes and corrupt the catalog.

Recovery is an offline operator procedure, not an API operation:

1. Disable access to every catalog writer, including XLSX, admin, other
   deployments, scripts and direct database writers. Merely removing traffic
   or deploying a new Worker does not prove old invocations stopped.
2. Establish, using platform-level operational evidence, that **all** prior
   writer invocations have terminated and all their outstanding D1 operations
   have settled. If this cannot be established, do not clear the lock; keep
   writes disabled and escalate to the platform operator. Never use elapsed
   time alone as proof.
3. Back up the database and inspect the catalog and `sync_runs`. An interrupted
   admin operation may have committed before its status update failed; do not
   assume it rolled back. Reconcile any uncertain changes before resuming.
4. Identify the exact abandoned run ID and record the incident and evidence.
   With writers still disabled and quiescent, run a parameterized equivalent of:

   ```sql
   UPDATE sync_runs
   SET status = 'failed', completed_at = ?, failed_count = 1,
       error_summary = 'Interrupted catalog write; operator recovery'
   WHERE id = ? AND provider = 'xlsx:kiotviet' AND status = 'running';
   ```

   Supply the current UTC ISO timestamp and the verified run ID. Confirm exactly
   one row changed and inspect for any other running catalog lock. Do not mark
   the run completed: its outcome is uncertain.
5. Re-enable writers only after reconciliation and verification. Generate a new
   XLSX preview before retrying an import; never blindly replay an uncertain
   operation.

This procedure does not coordinate external writers that bypass the lock.
Those writers must remain disabled or be independently coordinated.
