## graphify

This project has a graphify knowledge graph at graphify-out/.

Commands:
- `npm run graphify` - Rebuild the knowledge graph (extracts code relationships)
- `npm run graphify:query "question"` - Query the graph for context
- `npm run graphify:watch` - Watch for file changes and auto-rebuild

Rules:
- Before answering architecture or codebase questions, run `npm run graphify:query "<your question>"` to get context from the graph
- Check graphify-out/wiki/index.md for community navigation (wiki)
- Check graphify-out/GRAPH_REPORT.md for god nodes and community structure
- After modifying code files, run `npm run graphify` to keep the graph current
- If graphify:query doesn't find relevant results, fallback to grep/glob search

## Token Optimization

- ALWAYS query graphify FIRST before reading entire files — it tells you which files and functions are relevant
- Use `offset`/`limit` parameters when reading files — never read 900-line files when you need 50 lines
- Use grep to find exact line numbers, then read only that section
- Batch parallel file reads in a single message instead of sequential reads
- After editing a file, don't re-read the entire file — use grep to find the changed section
- Prefer `npm run graphify:query` over reading source files for architecture questions
