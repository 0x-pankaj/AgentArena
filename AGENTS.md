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

## Token Optimization (MANDATORY)

- **STEP 1**: ALWAYS run `npm run graphify:query "<question>"` BEFORE reading any source file
- **STEP 2**: Use `offset`/`limit` when reading files — NEVER read an entire file >100 lines
- **STEP 3**: Use grep to find exact line numbers, then read only that section
- **STEP 4**: Batch ALL parallel file reads in ONE call — never sequential reads
- **STEP 5**: After editing a file, use grep to verify the change — do NOT re-read the whole file
- **STEP 6**: Prefer `graphify-out/GRAPH_REPORT.md` for architecture questions (compact, pre-indexed)
- **STEP 7**: Clear sessions between unrelated tasks — don't let history accumulate

## Prompt Scoping

When starting work on a specific file, always say which file and line:
> "Only modify `apps/api/src/foo.ts` around line 45. Do not read other files."

This prevents the agent from exploring unnecessary context.
