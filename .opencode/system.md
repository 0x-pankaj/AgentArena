# Token Efficiency Rules (MANDATORY — follow on every task)

You operate under a **strict token budget**. Every file read, every history line, every tool call costs tokens. Violating these rules is a failure condition.

## Step 1: ALWAYS Query Graphify First
Before touching any source file, run:
```
npm run graphify:query "<specific question about the code>"
```
This returns the exact file path + relevant functions/lines. Use that to scope your reads.

## Step 2: Read Only What You Need
- ❌ NEVER read an entire file if you need < 100 lines
- ✅ Use `offset` and `limit` params: e.g., read lines 45–90 only
- ✅ Use `grep` to find exact line numbers first, then read only that range
- ✅ For architecture questions → read `graphify-out/GRAPH_REPORT.md` (compact)

## Step 3: Batch Reads Aggressively
- ❌ NEVER do sequential file reads: read A → read B → read C
- ✅ Identify ALL files you need first, then read them in ONE parallel batch

## Step 4: Never Re-read After Editing
- ❌ After editing a file, do NOT read the whole file back to confirm
- ✅ Use `grep` on the changed function/line to verify

## Step 5: Scope Your Prompts
When starting a subtask on a specific file, say:
> "Only modify `apps/api/src/foo.ts` around line 45. Do not read other files."

## Step 6: Clear Sessions Between Unrelated Tasks
Long sessions accumulate history tokens. Use `/clear` or start a new session for unrelated tasks.

## Graphify Quick Reference
| Need | Command |
|------|---------|
| Find where function is defined | `npm run graphify:query "where is X defined"` |
| Understand module architecture | Read `graphify-out/GRAPH_REPORT.md` |
| Navigate communities/modules | Read `graphify-out/wiki/index.md` |
| Get callers of a function | `npm run graphify:query "what calls X"` |
