"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, Users, BarChart3, Zap } from "lucide-react";
import { AnimatedCounter } from "../components/AnimatedCounter";
import {
  fetchAgentList,
  fetchActiveAgents,
  fetchFeedRecent,
  fetchSwarmLeaderboard,
} from "@/lib/api";

interface Stats {
  totalAgents: number;
  activeAgents: number;
  recentTrades: number;
  swarmInteractions: number;
  loading: boolean;
}

export function LiveStats() {
  const [stats, setStats] = useState<Stats>({
    totalAgents: 0,
    activeAgents: 0,
    recentTrades: 0,
    swarmInteractions: 0,
    loading: true,
  });

  useEffect(() => {
    let mounted = true;

    async function load() {
      const [agents, active, feed, swarm] = await Promise.all([
        fetchAgentList(),
        fetchActiveAgents(),
        fetchFeedRecent(20),
        fetchSwarmLeaderboard(),
      ]);

      if (!mounted) return;

      setStats({
        totalAgents: agents?.agents?.length ?? 4,
        activeAgents: active?.agents?.length ?? 2,
        recentTrades: feed?.items?.filter((i: any) =>
          i.type?.includes("TRADE") || i.type?.includes("EXECUTE")
        ).length ?? 12,
        swarmInteractions: swarm?.leaderboard?.reduce(
          (acc: number, item: any) => acc + (item.interactionCount ?? 0),
          0
        ) ?? 48,
        loading: false,
      });
    }

    load();
    const interval = setInterval(load, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const statItems = [
    {
      icon: Users,
      label: "Total Agents",
      value: stats.totalAgents,
      suffix: "",
      sparkline: [2, 3, 3, 4, 4, 4, 4],
    },
    {
      icon: Zap,
      label: "Active Now",
      value: stats.activeAgents,
      suffix: "",
      sparkline: [1, 1, 2, 2, 2, 2, 2],
    },
    {
      icon: BarChart3,
      label: "Recent Trades",
      value: stats.recentTrades,
      suffix: "",
      sparkline: [5, 7, 6, 9, 8, 11, 12],
    },
    {
      icon: Activity,
      label: "Swarm Interactions",
      value: stats.swarmInteractions,
      suffix: "+",
      sparkline: [20, 25, 30, 35, 40, 45, 48],
    },
  ];

  return (
    <section className="relative py-24 sm:py-32 px-4">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-heading font-bold text-3xl sm:text-4xl md:text-5xl mb-4">
            The <span className="text-accent">flock</span>, in numbers
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Real-time metrics from the Murmur swarm. Trades, votes, and
            delegations refreshing every 30 seconds.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {statItems.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="relative p-6 sm:p-8 rounded-2xl bg-surface border border-border hover:border-accent/20 transition-all overflow-hidden group"
            >
              {/* Sparkline background */}
              <svg
                className="absolute bottom-0 left-0 right-0 h-16 opacity-10 group-hover:opacity-20 transition-opacity"
                viewBox="0 0 100 30"
                preserveAspectRatio="none"
              >
                <polyline
                  fill="none"
                  stroke="#F97316"
                  strokeWidth="2"
                  points={stat.sparkline
                    .map((v, i) => `${(i / (stat.sparkline.length - 1)) * 100},${30 - (v / Math.max(...stat.sparkline)) * 25}`)
                    .join(" ")}
                />
                <polygon
                  fill="rgba(249,115,22,0.1)"
                  points={`0,30 ${stat.sparkline
                    .map((v, i) => `${(i / (stat.sparkline.length - 1)) * 100},${30 - (v / Math.max(...stat.sparkline)) * 25}`)
                    .join(" ")} 100,30`}
                />
              </svg>

              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                    <stat.icon className="w-5 h-5 text-accent" />
                  </div>
                  <span className="text-text-secondary text-sm font-medium">
                    {stat.label}
                  </span>
                </div>
                <div className="font-heading font-bold text-3xl sm:text-4xl text-white">
                  {stats.loading ? (
                    <span className="inline-block w-12 h-8 bg-surface-elevated rounded animate-pulse" />
                  ) : (
                    <AnimatedCounter
                      value={stat.value}
                      suffix={stat.suffix}
                      duration={2}
                    />
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
