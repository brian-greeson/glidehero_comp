# Worktree setup

Run the following commands from the worktree root. The worktree creation workflow exports
`CODEX_WORKTREE_PATH` to the absolute worktree path before running them.

```bash
set -e

npm install

# Create a database name unique to this worktree.
WORKTREE_NAME="$(basename "$CODEX_WORKTREE_PATH")"
SAFE_NAME="$(echo "$WORKTREE_NAME" | tr '.-' '*' | tr -cd '[:alnum:]*')"
DB_NAME="gh_${SAFE_NAME}"

createdb "$DB_NAME" 2>/dev/null || true

cp .env.worktree .env
echo "DATABASE_URL=postgresql://localhost:5432/${DB_NAME}" >> .env

npm run db:push
```
