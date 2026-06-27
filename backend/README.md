# POS ERP Self-Hosted Backend

This Next.js API replaces Supabase for cloud synchronization and product image
storage. The desktop app remains offline-first and continues using SQLite.

## VPS deployment with Docker

1. Copy the repository to the VPS and open the `backend` directory.
2. Create `.env`:

   ```env
   POSTGRES_PASSWORD=use-a-strong-database-password
   CLOUD_API_KEY=use-a-long-random-api-secret
   PUBLIC_BASE_URL=https://api.example.com
   ```

3. Start PostgreSQL and the API:

   ```bash
   docker compose up -d --build
   ```

4. Put Nginx or Caddy in front of `127.0.0.1:3000` and enable HTTPS.
5. In the desktop app, open **Settings → Self-Hosted Cloud Sync**:

   - Cloud API URL: `https://api.example.com`
   - Cloud API Key: the same `CLOUD_API_KEY`

6. Use **Sync Monitor → Diagnose** to verify API, PostgreSQL, and SQLite.

The PostgreSQL schema is created automatically only when the database volume is
new. For an existing database, run:

```bash
docker compose exec -T postgres \
  psql -U pos_erp -d pos_erp -f /docker-entrypoint-initdb.d/01-schema.sql
```

## Security requirements

- Do not expose PostgreSQL port 5432 publicly.
- Serve the API only over HTTPS.
- Use a random API key of at least 32 bytes.
- Back up both Docker volumes: `postgres_data` and `uploads_data`.
