"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import {
  Shield,
  ExternalLink,
  Award,
  Radio,
  ChevronDown,
  ChevronUp,
  Link as LinkIcon,
  Fingerprint,
} from "lucide-react";
import { fetchAgentList, getSolanaExplorerUrl, fetchAgentNftMetadata } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Agent {
  id: string;
  name: string;
  category: string;
  description: string;
  assetAddress: string | null;
  atomStatsAddress: string | null;
  reputationScore: string | null;
  trustTier: string | null;
  atomEnabled: boolean | null;
  isActive: boolean | null;
  isVerified: boolean | null;
  createdAt: string;
}

interface NftData {
  image?: string;
  name?: string;
  loading: boolean;
  error: boolean;
}

const categoryColors: Record<string, string> = {
  crypto: "text-accent",
  politics: "text-politics",
  sports: "text-sports",
  general: "text-geo",
};

const categoryBorders: Record<string, string> = {
  crypto: "border-accent/20 hover:border-accent/50",
  politics: "border-politics/20 hover:border-politics/50",
  sports: "border-sports/20 hover:border-sports/50",
  general: "border-geo/20 hover:border-geo/50",
};

const categoryGlows: Record<string, string> = {
  crypto: "hover:shadow-[0_0_40px_rgba(249,115,22,0.12)]",
  politics: "hover:shadow-[0_0_40px_rgba(168,85,247,0.12)]",
  sports: "hover:shadow-[0_0_40px_rgba(34,197,94,0.12)]",
  general: "hover:shadow-[0_0_40px_rgba(59,130,246,0.12)]",
};

const tierColors: Record<string, string> = {
  Platinum: "bg-gradient-to-r from-slate-300 to-slate-100 text-slate-900",
  Gold: "bg-gradient-to-r from-yellow-500 to-yellow-300 text-yellow-900",
  Silver: "bg-gradient-to-r from-gray-400 to-gray-300 text-gray-900",
  Bronze: "bg-gradient-to-r from-amber-700 to-amber-600 text-white",
  Unknown: "bg-surface-elevated text-text-muted",
};

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function AgentCard({ agent, index }: { agent: Agent; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const [nftData, setNftData] = useState<NftData>({ loading: !!agent.assetAddress, error: false });

  useEffect(() => {
    if (!agent.assetAddress) return;
    let mounted = true;

    fetchAgentNftMetadata(agent.assetAddress).then((data) => {
      if (!mounted) return;
      if (data?.image) {
        setNftData({ image: data.image, name: data.name, loading: false, error: false });
      } else {
        setNftData({ loading: false, error: true });
      }
    }).catch(() => {
      if (!mounted) return;
      setNftData({ loading: false, error: true });
    });

    return () => { mounted = false; };
  }, [agent.assetAddress]);

  const score = agent.reputationScore ? parseFloat(agent.reputationScore) : 0;
  const isRegistered = !!agent.assetAddress;
  const tier = agent.trustTier || "Unknown";

  const registryUrl = getSolanaExplorerUrl(agent.assetAddress, "address");
  const statsUrl = getSolanaExplorerUrl(agent.atomStatsAddress, "address");

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
      whileHover={{ y: -4 }}
      className={cn(
        "group relative rounded-2xl bg-surface border transition-all duration-300 overflow-hidden",
        categoryBorders[agent.category] || categoryBorders.general,
        categoryGlows[agent.category] || categoryGlows.general
      )}
    >
      <div className="p-5">
        <div className="flex items-start gap-4 mb-4">
          <div className="relative shrink-0">
            {nftData.loading ? (
              <div className="w-16 h-16 rounded-xl bg-surface-elevated animate-pulse border border-border" />
            ) : nftData.image ? (
              <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-border group-hover:border-accent/30 transition-colors">
                <Image
                  src={nftData.image}
                  alt={agent.name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            ) : (
              <div className={cn(
                "w-16 h-16 rounded-xl flex items-center justify-center text-xl font-bold border",
                agent.category === "crypto" && "bg-accent/10 text-accent border-accent/20",
                agent.category === "politics" && "bg-politics/10 text-politics border-politics/20",
                agent.category === "sports" && "bg-sports/10 text-sports border-sports/20",
                agent.category === "general" && "bg-geo/10 text-geo border-geo/20"
              )}>
                {agent.name.charAt(0)}
              </div>
            )}
            {agent.isVerified && (
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-accent border-2 border-surface flex items-center justify-center">
                <Fingerprint className="w-2.5 h-2.5 text-white" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-heading font-semibold text-base text-white truncate">
              {agent.name}
            </h3>
            <span className={cn("text-xs font-mono uppercase", categoryColors[agent.category] || "text-text-secondary")}>
              {agent.category}
            </span>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {isRegistered && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 border border-success/20 text-success text-[10px] font-semibold">
                  <Shield className="w-3 h-3" />
                  8004
                </span>
              )}
              {agent.atomEnabled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-[10px] font-semibold">
                  <Award className="w-3 h-3" />
                  ATOM
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="text-text-secondary text-sm leading-relaxed mb-4 line-clamp-2">
          {agent.description}
        </p>

        {score > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-text-muted font-mono">Reputation</span>
              <span className="text-xs font-bold text-white font-mono">{score.toFixed(1)}/100</span>
            </div>
            <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${score}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1, delay: 0.3 }}
                className={cn(
                  "h-full rounded-full",
                  score >= 80 ? "bg-success" : score >= 50 ? "bg-accent" : "bg-danger"
                )}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3">
          <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide", tierColors[tier] || tierColors.Unknown)}>
            {tier}
          </span>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-text-muted text-xs hover:text-white transition-colors"
        >
          {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Hide on-chain details</> : <><ChevronDown className="w-3.5 h-3.5" /> Show on-chain details</>}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border mx-5" />
            <div className="p-5 space-y-3">
              {registryUrl && (
                <a
                  href={registryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-xl bg-surface-elevated border border-border hover:border-success/30 transition-colors group/link"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                      <LinkIcon className="w-4 h-4 text-success" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">8004 Agent Registry</div>
                      <div className="text-[10px] text-text-muted font-mono">{truncateAddress(agent.assetAddress!)}</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-text-muted group-hover/link:text-success transition-colors" />
                </a>
              )}
              {statsUrl && (
                <a
                  href={statsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-xl bg-surface-elevated border border-border hover:border-accent/30 transition-colors group/link"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                      <Award className="w-4 h-4 text-accent" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">ATOM Reputation Stats</div>
                      <div className="text-[10px] text-text-muted font-mono">{truncateAddress(agent.atomStatsAddress!)}</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-text-muted group-hover/link:text-accent transition-colors" />
                </a>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg bg-surface-elevated">
                  <div className="text-sm font-bold text-white">{score >= 50 ? "High" : "Low"}</div>
                  <div className="text-[10px] text-text-muted">Confidence</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-surface-elevated">
                  <div className="text-sm font-bold text-white">{agent.isActive ? "Live" : "Idle"}</div>
                  <div className="text-[10px] text-text-muted">Status</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-surface-elevated">
                  <div className="text-sm font-bold text-white">{tier === "Unknown" ? "—" : tier}</div>
                  <div className="text-[10px] text-text-muted">Tier</div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function OnChainAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "registered" | "verified">("all");

  useEffect(() => {
    let mounted = true;
    async function load() {
      const data = await fetchAgentList();
      if (!mounted) return;
      setAgents(data?.agents || []);
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, []);

  const filtered = agents.filter((a) => {
    if (filter === "registered") return !!a.assetAddress;
    if (filter === "verified") return a.isVerified;
    return true;
  });

  const registeredCount = agents.filter((a) => !!a.assetAddress).length;
  const verifiedCount = agents.filter((a) => a.isVerified).length;

  return (
    <section id="onchain" className="relative py-24 sm:py-32 px-4">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-elevated border border-border-accent mb-6">
            <Shield className="w-4 h-4 text-success" />
            <span className="text-sm text-text-secondary font-mono">On-Chain Verified</span>
          </div>
          <h2 className="font-heading font-bold text-3xl sm:text-4xl md:text-5xl mb-4">
            Registered on <span className="text-accent">Solana</span>
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto mb-8">
            Every agent is a unique on-chain asset via the 8004 Agent Registry.
            Reputation is permanently recorded via the ATOM Protocol.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-6 mb-10">
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-surface border border-border">
              <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                <LinkIcon className="w-5 h-5 text-success" />
              </div>
              <div className="text-left">
                <div className="font-heading font-bold text-xl text-white">{registeredCount}</div>
                <div className="text-[10px] text-text-muted font-mono uppercase">8004 Registered</div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-surface border border-border">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <Award className="w-5 h-5 text-accent" />
              </div>
              <div className="text-left">
                <div className="font-heading font-bold text-xl text-white">{verifiedCount}</div>
                <div className="text-[10px] text-text-muted font-mono uppercase">ATOM Verified</div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-surface border border-border">
              <div className="w-10 h-10 rounded-lg bg-geo/10 flex items-center justify-center">
                <Radio className="w-5 h-5 text-geo" />
              </div>
              <div className="text-left">
                <div className="font-heading font-bold text-xl text-white">{agents.length}</div>
                <div className="text-[10px] text-text-muted font-mono uppercase">Total Agents</div>
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 p-1 rounded-xl bg-surface-elevated border border-border">
            {(["all", "registered", "verified"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize",
                  filter === tab
                    ? "bg-accent text-white shadow-[0_0_20px_rgba(249,115,22,0.25)]"
                    : "text-text-secondary hover:text-white"
                )}
              >
                {tab === "all" ? "All Agents" : tab === "registered" ? "8004 Registered" : "ATOM Verified"}
              </button>
            ))}
          </div>
        </motion.div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-surface border border-border p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-16 h-16 rounded-xl bg-surface-elevated" />
                  <div className="space-y-2">
                    <div className="w-32 h-4 bg-surface-elevated rounded" />
                    <div className="w-20 h-3 bg-surface-elevated rounded" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="w-full h-3 bg-surface-elevated rounded" />
                  <div className="w-3/4 h-3 bg-surface-elevated rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-text-secondary">No agents match this filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((agent, i) => (
              <AgentCard key={agent.id} agent={agent} index={i} />
            ))}
          </div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="mt-16 flex flex-wrap items-center justify-center gap-4"
        >
          <a href="https://github.com/Solana-Agent-Standard/8004" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-elevated border border-border hover:border-success/30 transition-colors">
            <Shield className="w-4 h-4 text-success" />
            <span className="text-xs text-text-secondary font-mono">8004 Agent Registry</span>
          </a>
          <a href="#" className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-elevated border border-border hover:border-accent/30 transition-colors">
            <Award className="w-4 h-4 text-accent" />
            <span className="text-xs text-text-secondary font-mono">ATOM Reputation Protocol</span>
          </a>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-elevated border border-border">
            <Radio className="w-4 h-4 text-geo" />
            <span className="text-xs text-text-secondary font-mono">Solana Devnet</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
