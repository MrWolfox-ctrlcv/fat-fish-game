# Reviewing an uncertain prop debit

`prop_receipts.status='pending'` means the debit outcome could not be confirmed. The server will not send that debit again; it blocks other prop purchases by the same account until this receipt is resolved.

## Inspect first

Make a consistent database backup before any resolution. For a live SQLite database, use SQLite's online backup command:

```text
sqlite3 path/to/game.sqlite ".backup 'path/to/game.before-prop-review.sqlite'"
```

List pending game receipts with a read-only query:

```sql
SELECT request_id, receipt_id, user_id, run_id, week_id, name, quota, kind,
       body_ids, step, move_count, prop_revision, created_at, updated_at,
       json_extract(summary, '$.score') AS score,
       json_extract(summary, '$.max_level') AS max_level
FROM prop_receipts
WHERE status = 'pending'
ORDER BY created_at;
```

The wallet request does **not** send `receipt_id` as a New API idempotency key, and New API audit logs do not contain that value. Correlate using the account user ID, billing actor, 5,000 quota change, and a narrow time window around `created_at`; check for concurrent account activity. A balance delta alone is insufficient. If the audit does not prove whether this debit happened, do not mark the receipt committed. Keep it pending and arrange a manual refund/credit review with the billing owner.

## Resolve only after the billing audit is conclusive

Use a controlled local Node script with the same `GAME_DB` path and the repository's `GameStore`; do not edit receipt or weekly tables directly. The script should print the receipt identity and require the operator to verify it before applying one of these operations:

- **Debit definitely did not happen, or a refund is confirmed:** call `store.failPropReceipt(requestId, Date.now())`. This closes the purchase without marking the run as prop-used.
- **Debit definitely happened and will not be refunded:** load `const r = store.propReceipt(requestId)`, require `r.status === 'pending'`, then call:

```js
store.commitPropReceipt({
  requestId: r.request_id,
  now: Date.now(),
  state: r.state,
  summary: r.summary,
  profile: r.profile,
  rewards: r.rewards,
  play: r.play,
  week: r.week_id,
  userId: r.user_id,
  name: r.name,
  runId: r.run_id,
  usedProps: true,
});
```

`commitPropReceipt` applies profile progress, the durable used-prop marker, weekly score handling, and the committed receipt in one SQLite transaction. It also preserves the serialized response for safe retries. Close the store in a `finally` block and retain the backup until the account and receipt have been checked.

Never resolve a receipt by changing `status` with SQL alone: that can skip the progress and weekly-score transaction. Do not change `weekly_scores`; it is retained for compatibility with older game versions.
