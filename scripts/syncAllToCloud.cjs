// The old utility changed stock identities and marked uploads synced manually.
// All repairs now use the application's durable, conflict-aware outbox.
console.error('This unsafe bulk-push utility has been retired. Open the ERP Sync Dashboard and use Sync Now. Historical cloud recovery runs automatically.');
process.exitCode = 1;
