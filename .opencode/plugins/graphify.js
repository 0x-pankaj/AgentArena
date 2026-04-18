// graphify OpenCode plugin
// Injects knowledge-graph reminder before file-reading tool calls to prevent
// the agent from loading unnecessary context and burning tokens.
import { existsSync } from "fs";
import { join } from "path";

export const GraphifyPlugin = async ({ directory }) => {
  let callCount = 0;
  const REMIND_EVERY = 5; // re-inject reminder every N qualifying tool calls
  const graphExists = existsSync(join(directory, "graphify-out", "graph.json"));

  // Tools that are likely to read large amounts of context
  const CONTEXT_TOOLS = new Set([
    "bash",
    "read",
    "glob",
    "grep",
    "list",
    "find",
    "cat",
  ]);

  const REMINDER = [
    "╔══ [GRAPHIFY TOKEN GUARD] ══════════════════════════════╗",
    "║ Knowledge graph is available — use it BEFORE reading files! ║",
    "║  Query: npm run graphify:query \"<your question>\"         ║",
    "║  Report: graphify-out/GRAPH_REPORT.md (god nodes/arch)  ║",
    "║  Wiki:   graphify-out/wiki/index.md                     ║",
    "║                                                          ║",
    "║ TOKEN RULES:                                             ║",
    "║  1. Query graphify FIRST — get exact file + line range   ║",
    "║  2. Read only those lines (offset/limit), NOT full files ║",
    "║  3. Use grep to find line numbers, then read that section ║",
    "║  4. Batch parallel reads — never sequential one-by-one  ║",
    "║  5. After editing, grep to verify — don't re-read file  ║",
    "╚══════════════════════════════════════════════════════════╝",
  ].join("\n");

  return {
    "tool.execute.before": async (input, output) => {
      if (!graphExists) return;
      if (!CONTEXT_TOOLS.has(input.tool)) return;

      callCount++;
      if (callCount % REMIND_EVERY !== 1) return; // remind on 1st, 6th, 11th...

      if (input.tool === "bash") {
        output.args.command = `echo '${REMINDER}' && ` + output.args.command;
      }
      // For non-bash tools we can't inject into args, but the before-hook
      // itself being logged in the trace acts as a visible reminder.
    },
  };
};
