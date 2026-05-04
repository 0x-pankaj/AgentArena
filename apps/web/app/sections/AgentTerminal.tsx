"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Play, Pause, RotateCcw, Bot } from "lucide-react";

const demoLogs = [
  { agent: "Crypto Agent", msg: "Scanning Jupiter Predict markets...", color: "text-accent", delay: 0 },
  { agent: "Crypto Agent", msg: "Signal: BTC ETF approval odds shifted +15%", color: "text-accent", delay: 800 },
  { agent: "Crypto Agent", msg: "Keyword detected: 'tariffs' -> Delegating to Politics Agent", color: "text-politics", delay: 1600 },
  { agent: "Politics Agent", msg: "Analyzing tariff impact on crypto markets...", color: "text-politics", delay: 2400 },
  { agent: "Politics Agent", msg: "Confidence: 60% (moderate bullish)", color: "text-politics", delay: 3200 },
  { agent: "Crypto Agent", msg: "Merged confidence: (85% + 60%) / 2 = 72.5%", color: "text-accent", delay: 4000 },
  { agent: "Swarm", msg: "Triggering consensus vote (cross-domain + high confidence)", color: "text-geo", delay: 4800 },
  { agent: "General Agent", msg: "Vote: YES (72% alignment with macro trends)", color: "text-geo", delay: 5600 },
  { agent: "Sports Agent", msg: "Vote: ABSTAIN (insufficient domain expertise)", color: "text-sports", delay: 6400 },
  { agent: "Swarm", msg: "Consensus: 2 YES, 0 NO, 1 ABSTAIN -> APPROVED", color: "text-success", delay: 7200 },
  { agent: "Crypto Agent", msg: "Executing trade: Buy 500 USDC @ 72% confidence", color: "text-accent", delay: 8000 },
  { agent: "System", msg: "Trade confirmed. Position opened. Monitoring...", color: "text-text-muted", delay: 8800 },
];

export function AgentTerminal() {
  const [logs, setLogs] = useState<typeof demoLogs>([]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout>(null);
  const terminalBodyRef = useRef<HTMLDivElement>(null);

  // Scroll terminal internally — NEVER use scrollIntoView (hijacks page scroll)
  useEffect(() => {
    const el = terminalBodyRef.current;
    if (el && logs.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  const runLog = (index: number) => {
    if (index >= demoLogs.length) {
      timeoutRef.current = setTimeout(() => {
        setLogs([]);
        setCurrentIndex(0);
        if (isPlaying) runLog(0);
      }, 3000);
      return;
    }

    const log = demoLogs[index];
    timeoutRef.current = setTimeout(() => {
      setLogs((prev) => [...prev, log]);
      setCurrentIndex(index + 1);
      if (isPlaying) runLog(index + 1);
    }, index === 0 ? 500 : log.delay - demoLogs[index - 1].delay);
  };

  useEffect(() => {
    if (isPlaying && logs.length === 0 && currentIndex === 0) {
      runLog(0);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isPlaying]);

  const handleReset = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setLogs([]);
    setCurrentIndex(0);
    if (isPlaying) {
      setTimeout(() => runLog(0), 100);
    }
  };

  return (
    <section className="relative py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-elevated border border-border-accent mb-4">
            <Terminal className="w-4 h-4 text-accent" />
            <span className="text-sm text-text-secondary font-mono">
              Interactive Demo
            </span>
          </div>
          <h2 className="font-heading font-bold text-3xl sm:text-4xl mb-4">
            See the <span className="text-accent">Swarm</span> in Action
          </h2>
          <p className="text-text-secondary text-lg max-w-xl mx-auto">
            Watch how agents collaborate, delegate, and reach consensus before
            executing a trade — all in real-time.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="rounded-2xl overflow-hidden border border-border bg-surface shadow-[0_0_60px_rgba(249,115,22,0.05)]"
        >
          {/* Terminal header */}
          <div className="flex items-center justify-between px-4 py-3 bg-surface-elevated border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-danger" />
                <div className="w-3 h-3 rounded-full bg-warning" />
                <div className="w-3 h-3 rounded-full bg-success" />
              </div>
              <span className="text-xs text-text-muted font-mono ml-2">
                swarm-consensus-demo.ts
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-white hover:border-text-muted transition-colors"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button
                onClick={handleReset}
                className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-white hover:border-text-muted transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Terminal body */}
          <div
            ref={terminalBodyRef}
            className="p-4 h-96 overflow-y-auto font-mono text-sm scroll-smooth"
          >
            <div className="text-text-muted mb-4">
              <span className="text-success">$</span> bun run agent:swarm-demo --agent=crypto --market=BTC-ETF
            </div>

            <AnimatePresence>
              {logs.map((log, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-start gap-3 mb-2"
                >
                  <span className="text-text-muted shrink-0">[{new Date().toLocaleTimeString("en-US", { hour12: false })}]</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Bot className={`w-3.5 h-3.5 ${log.color}`} />
                    <span className={`font-semibold text-xs ${log.color}`}>
                      {log.agent}
                    </span>
                  </div>
                  <span className="text-text-secondary">{log.msg}</span>
                </motion.div>
              ))}
            </AnimatePresence>

            {logs.length === demoLogs.length && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 mt-4 text-success"
              >
                <span className="text-success">$</span>
                <span className="animate-pulse">_</span>
              </motion.div>
            )}

            {logs.length === 0 && isPlaying && (
              <div className="flex items-center gap-2 text-text-muted">
                <span className="text-success">$</span>
                <span className="animate-pulse">_</span>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-border">
            <motion.div
              className="h-full bg-accent"
              initial={{ width: "0%" }}
              animate={{ width: `${(logs.length / demoLogs.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
