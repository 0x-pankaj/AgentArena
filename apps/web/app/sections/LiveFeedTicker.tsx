"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { fetchFeedRecent } from "@/lib/api";
import {
  TrendingUp,
  Share2,
  Vote,
  Activity,
  Bot,
  Zap,
  Clock,
} from "lucide-react";

const typeIcons: Record<string, React.ElementType> = {
  TRADE: TrendingUp,
  DELEGATION: Share2,
  CONSENSUS: Vote,
  SCAN: Activity,
  AGENT: Bot,
  SIGNAL: Zap,
};

const typeColors: Record<string, string> = {
  TRADE: "text-accent",
  DELEGATION: "text-politics",
  CONSENSUS: "text-geo",
  SCAN: "text-success",
  AGENT: "text-accent",
  SIGNAL: "text-warning",
};

interface FeedItem {
  id: string;
  type: string;
  agentName: string;
  message: string;
  timestamp: string;
}

const demoItems: FeedItem[] = [
  { id: "1", type: "TRADE", agentName: "Crypto Agent", message: "Bought 500 USDC of BTC ETF market @ 72% confidence", timestamp: new Date().toISOString() },
  { id: "2", type: "DELEGATION", agentName: "Politics Agent", message: "Delegated tariff analysis to General Agent", timestamp: new Date(Date.now() - 120000).toISOString() },
  { id: "3", type: "CONSENSUS", agentName: "Swarm", message: "Consensus reached: 3 YES, 1 NO on SOL price market", timestamp: new Date(Date.now() - 240000).toISOString() },
  { id: "4", type: "SCAN", agentName: "Sports Agent", message: "Detected signal: NBA Finals MVP odds shifted +12%", timestamp: new Date(Date.now() - 360000).toISOString() },
  { id: "5", type: "SIGNAL", agentName: "General Agent", message: "High-confidence cross-domain opportunity detected", timestamp: new Date(Date.now() - 480000).toISOString() },
  { id: "6", type: "TRADE", agentName: "Crypto Agent", message: "Position closed: +45 USDC profit on ETH market", timestamp: new Date(Date.now() - 600000).toISOString() },
  { id: "7", type: "SCAN", agentName: "Politics Agent", message: "New election market: 2026 Midterms - 3 candidates", timestamp: new Date(Date.now() - 720000).toISOString() },
  { id: "8", type: "DELEGATION", agentName: "Crypto Agent", message: "Merged confidence: Crypto 85% + Politics 60% = 72.5%", timestamp: new Date(Date.now() - 840000).toISOString() },
];

function FeedRow({ item, index }: { item: FeedItem; index: number }) {
  const Icon = typeIcons[item.type] || Activity;
  const colorClass = typeColors[item.type] || "text-text-secondary";

  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-start gap-3 p-3 rounded-lg bg-surface-elevated/50 hover:bg-surface-elevated transition-colors group shrink-0"
    >
      <div className={`mt-0.5 ${colorClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-white">
            {item.agentName}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated ${colorClass}`}>
            {item.type}
          </span>
        </div>
        <p className="text-text-secondary text-xs truncate group-hover:whitespace-normal transition-all">
          {item.message}
        </p>
      </div>
      <div className="flex items-center gap-1 text-text-muted text-[10px] shrink-0">
        <Clock className="w-3 h-3" />
        {formatTime(item.timestamp)}
      </div>
    </motion.div>
  );
}

export function LiveFeedTicker() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const data = await fetchFeedRecent(15);
      if (!mounted) return;

      const feedItems: FeedItem[] =
        data?.items?.map((item: any, i: number) => ({
          id: item.id || `feed-${i}`,
          type: item.type || "AGENT",
          agentName: item.agentName || item.agent?.name || "System",
          message: item.message || item.content || "Activity detected",
          timestamp: item.timestamp || new Date().toISOString(),
        })) || [];

      setItems(feedItems.length > 0 ? feedItems : demoItems);
      setLoading(false);
    }

    load();
    const interval = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Double the items for seamless CSS loop
  const displayItems = items.length > 0 ? [...items, ...items] : [];

  return (
    <section className="relative py-16 px-4 overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-elevated border border-border-accent mb-4">
            <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
            <span className="text-sm text-text-secondary font-mono">
              Live Agent Activity Feed
            </span>
          </div>
          <h2 className="font-heading font-bold text-2xl sm:text-3xl">
            Real-Time <span className="text-accent">Activity</span>
          </h2>
        </motion.div>

        <div className="relative max-w-3xl mx-auto">
          {/* Terminal header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-surface-elevated rounded-t-xl border border-border border-b-0">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-danger" />
              <div className="w-3 h-3 rounded-full bg-warning" />
              <div className="w-3 h-3 rounded-full bg-success" />
            </div>
            <span className="ml-3 text-xs text-text-muted font-mono">
              murmur-swarm --tail --on-chain
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-xs text-text-muted font-mono">CONNECTED</span>
            </div>
          </div>

          {/* Feed content — CSS auto-scroll, no JS scroll hijack */}
          <div className="h-80 overflow-hidden bg-surface border border-border rounded-b-xl p-4 font-mono text-sm relative">
            {loading ? (
              <div className="flex items-center justify-center h-full text-text-muted">
                <Activity className="w-5 h-5 animate-spin mr-2" />
                Connecting to agent feed...
              </div>
            ) : (
              <div
                className="flex flex-col gap-3"
                style={{
                  animation: "feedScroll 25s linear infinite",
                }}
              >
                {displayItems.map((item, i) => (
                  <FeedRow key={`${item.id}-${i}`} item={item} index={i % items.length} />
                ))}
              </div>
            )}

            {/* Fade overlays */}
            <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-surface to-transparent pointer-events-none z-10" />
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-surface to-transparent pointer-events-none z-10" />
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes feedScroll {
          0% {
            transform: translateY(0);
          }
          100% {
            transform: translateY(-50%);
          }
        }
      `}</style>
    </section>
  );
}
