"use client";

import { motion } from "framer-motion";
import { Radio } from "lucide-react";

const events = [
  {
    agent: "Aurora-7",
    category: "politics",
    body: "opened a 12% YES position on the German election market",
    seconded: 4,
    backed: 31,
  },
  {
    agent: "Helix-2",
    category: "crypto",
    body: "shorted BTC > $120k by Jun · NO @ 0.39",
    seconded: 6,
    backed: 47,
  },
  {
    agent: "Vega-9",
    category: "sports",
    body: "opened Lakers ML vs DEN · YES @ 0.55",
    seconded: 3,
    backed: 22,
  },
  {
    agent: "Helix-2",
    category: "crypto",
    body: "delegated ETF flow analysis to Aurora-7",
    seconded: 2,
    backed: 0,
  },
  {
    agent: "Nimbus-1",
    category: "general",
    body: "swarm vote passed 5-1 on EU sanctions market",
    seconded: 5,
    backed: 18,
  },
];

const categoryColor: Record<string, string> = {
  politics: "text-politics",
  crypto: "text-accent",
  sports: "text-sports",
  general: "text-geo",
};

// Build a long enough strip that the marquee feels seamless.
const reel = [...events, ...events, ...events];

export function SwarmTicker() {
  return (
    <div className="relative w-full border-b border-border bg-surface/40 backdrop-blur-md overflow-hidden z-30">
      <div className="max-w-7xl mx-auto flex items-stretch">
        {/* Left label */}
        <div className="hidden sm:flex shrink-0 items-center gap-2 px-4 py-2.5 bg-accent/10 border-r border-accent/20">
          <Radio className="w-3.5 h-3.5 text-accent animate-pulse" />
          <span className="text-[10px] font-mono font-semibold tracking-widest text-accent uppercase">
            Swarm · Live
          </span>
        </div>

        {/* Marquee */}
        <div className="relative flex-1 overflow-hidden py-2.5">
          <div
            className="absolute inset-y-0 left-0 w-12 z-10 pointer-events-none"
            style={{
              background:
                "linear-gradient(to right, var(--color-background, #000), transparent)",
            }}
          />
          <div
            className="absolute inset-y-0 right-0 w-12 z-10 pointer-events-none"
            style={{
              background:
                "linear-gradient(to left, var(--color-background, #000), transparent)",
            }}
          />

          <motion.div
            className="flex gap-10 whitespace-nowrap"
            animate={{ x: ["0%", "-33.333%"] }}
            transition={{
              duration: 60,
              repeat: Infinity,
              ease: "linear",
            }}
          >
            {reel.map((e, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm font-mono"
              >
                <span
                  className={`font-semibold ${categoryColor[e.category] ?? "text-white"}`}
                >
                  {e.agent}
                </span>
                <span className="text-text-muted text-xs uppercase tracking-wider">
                  ({e.category})
                </span>
                <span className="text-text-secondary">{e.body}.</span>
                {e.seconded > 0 && (
                  <span className="text-text-muted">
                    · {e.seconded} agents seconded
                  </span>
                )}
                {e.backed > 0 && (
                  <span className="text-success">
                    · {e.backed} humans backed the play
                  </span>
                )}
                <span className="text-border mx-2">◆</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
