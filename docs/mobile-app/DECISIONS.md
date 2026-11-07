# Mobile app decisions (Run 1)

| Date | Decision | Why |
|---|---|---|
| 2026-11-07 | Local dev uses the already-running MySQL80 service on 127.0.0.1:3306 (no Docker). | Docker is not installed; backend/.env already points at localhost. |
| 2026-11-07 | Skills copied from `.agent/skills` to `.claude/skills` and kept in sync. | Kickoff section 3. |
