## graphify

Knowledge graph at `graphify-out/`.

Commands:
- `npm run graphify` — rebuild graph (run ONLY after code changes, not on session start)
- `npm run graphify:query "question"` — query for exact file:line locations
- `npm run graphify:watch` — auto-rebuild on file changes

Workflow:
1. `graphify:query` → get file paths + line numbers → read only those lines
2. For architecture questions, read `GRAPH_REPORT.md` god nodes section (once per session max)
3. After code changes → `npm run graphify` to keep graph current
4. If query finds nothing → fall back to grep/glob