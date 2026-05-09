"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Radio } from "lucide-react";
import { fetchSwarmActivity, type SwarmActivityItem } from "../../lib/api";

interface TickerEvent {
  agent: string;
  category: string;
  body: string;
  seconded: number;
  backed: number;
}

const FALLBACK_EVENTS: TickerEvent[] = [
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
  geo: "text-geo",
  swarm: "text-accent",
};

function trimQuestion(q: string | null, max = 70): string {
  if (!q) return "an active market";
  return q.length > max ? q.slice(0, max - 1) + "…" : q;
}

function describeActivity(item: SwarmActivityItem): TickerEvent {
  const market = trimQuestion(item.marketQuestion);
  const conf = item.confidence != null ? Math.round(item.confidence) : null;

  let body: string;
  switch (item.type) {
    case "delegation":
      body = `delegated "${market}" → ${item.to.name}${conf ? ` · ${conf}% conf` : ""}`;
      break;
    case "consensus": {
      // metadata.vote/reasoning is recorded per-voter in collectSwarmVotes
      const v = item?.metadata?.vote;
      const tag = v === "yes" ? "YES" : v === "no" ? "NO" : "ABSTAIN";
      body = `swarm voted ${tag} on "${market}"${conf ? ` (${conf}% conf)` : ""}`;
      break;
    }
    case "peer_check":
      body = `pinged ${item.to.name} on "${market}"`;
      break;
    case "rating":
      body = `rated ${item.to.name}${conf ? ` (${conf}/100)` : ""}`;
      break;
    default:
      body = `${item.type.replace(/_/g, " ")} → ${item.to.name} on "${market}"`;
  }

  return {
    agent: item.from.name,
    category: item.from.category,
    body,
    // Soft synthetic counts so the strip still has texture; replace with
    // real reactions/backs once those endpoints exist.
    seconded: 0,
    backed: 0,
  };
}

export function SwarmTicker() {
  const [events, setEvents] = useState<TickerEvent[]>(FALLBACK_EVENTS);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const data = await fetchSwarmActivity(12);
      if (cancelled) return;
      const items = data?.items ?? [];
      if (items.length >= 3) {
        setEvents(items.map(describeActivity));
      }
    }
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Build a long enough strip that the marquee feels seamless.
  const reel = useMemo(() => [...events, ...events, ...events], [events]);

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
