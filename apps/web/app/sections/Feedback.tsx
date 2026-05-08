"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bug, Lightbulb, MessageSquare, Heart, Star, Send, CheckCircle2 } from "lucide-react";
import { submitFeedback, type FeedbackType, TRPCMutationError } from "../../lib/api";

const TYPES: { value: FeedbackType; label: string; icon: typeof Bug; color: string }[] = [
  { value: "bug", label: "Bug", icon: Bug, color: "text-red-400" },
  { value: "feature", label: "Feature", icon: Lightbulb, color: "text-amber-400" },
  { value: "general", label: "General", icon: MessageSquare, color: "text-sky-400" },
  { value: "praise", label: "Praise", icon: Heart, color: "text-pink-400" },
];

export function Feedback() {
  const [type, setType] = useState<FeedbackType>("general");
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const messageTooShort = message.trim().length < 3;
  const messageTooLong = message.length > 2000;
  const disabled = status === "submitting" || messageTooShort || messageTooLong;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    if (website.length > 0) return; // honeypot tripped — silently no-op

    setStatus("submitting");
    setErrorMsg(null);

    try {
      await submitFeedback({
        type,
        message: message.trim(),
        rating: rating > 0 ? rating : undefined,
        contact: contact.trim() || undefined,
        pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
      });
      setStatus("success");
      setMessage("");
      setContact("");
      setRating(0);
    } catch (err) {
      setStatus("error");
      if (err instanceof TRPCMutationError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Something went wrong. Please try again.");
      }
    }
  }

  return (
    <section id="feedback" className="relative py-24 sm:py-32 px-4">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <p className="text-accent text-sm font-mono uppercase tracking-wider mb-3">
            help us ship faster
          </p>
          <h2 className="font-heading font-bold text-4xl sm:text-5xl text-white mb-4">
            Shape the swarm
          </h2>
          <p className="text-text-secondary text-lg max-w-xl mx-auto">
            Found a bug? Got a feature idea? Just want to say hi? Drop us a note —
            every submission lands directly with the team.
          </p>
        </motion.div>

        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="rounded-2xl border border-border bg-surface-elevated/40 backdrop-blur-sm p-6 sm:p-8"
        >
          {status === "success" ? (
            <div className="flex flex-col items-center text-center py-12">
              <div className="w-16 h-16 rounded-full bg-success/10 border border-success/30 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-success" />
              </div>
              <h3 className="font-heading font-bold text-2xl text-white mb-2">
                Thanks — we got it
              </h3>
              <p className="text-text-secondary mb-6 max-w-sm">
                Your feedback is in our queue. If you left contact info, we&apos;ll
                follow up when we ship the fix or feature.
              </p>
              <button
                type="button"
                onClick={() => setStatus("idle")}
                className="text-sm text-accent hover:text-accent/80 transition-colors font-mono"
              >
                Send another →
              </button>
            </div>
          ) : (
            <>
              {/* Type selector */}
              <label className="block text-sm font-mono uppercase tracking-wider text-text-muted mb-3">
                Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
                {TYPES.map((t) => {
                  const Icon = t.icon;
                  const active = type === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setType(t.value)}
                      className={`flex flex-col items-center gap-2 py-3 px-2 rounded-lg border transition-all ${
                        active
                          ? "border-accent bg-accent/10"
                          : "border-border bg-surface-elevated/40 hover:border-text-muted"
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${active ? "text-accent" : t.color}`} />
                      <span className={`text-sm font-medium ${active ? "text-white" : "text-text-secondary"}`}>
                        {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Rating */}
              <label className="block text-sm font-mono uppercase tracking-wider text-text-muted mb-3">
                Rating <span className="normal-case text-text-muted/60">(optional)</span>
              </label>
              <div className="flex items-center gap-1 mb-6">
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = (hoverRating || rating) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n === rating ? 0 : n)}
                      onMouseEnter={() => setHoverRating(n)}
                      onMouseLeave={() => setHoverRating(0)}
                      aria-label={`${n} star${n > 1 ? "s" : ""}`}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <Star
                        className={`w-7 h-7 transition-colors ${
                          filled ? "fill-amber-400 text-amber-400" : "text-text-muted/40"
                        }`}
                      />
                    </button>
                  );
                })}
                {rating > 0 && (
                  <button
                    type="button"
                    onClick={() => setRating(0)}
                    className="ml-2 text-xs text-text-muted hover:text-text-secondary"
                  >
                    clear
                  </button>
                )}
              </div>

              {/* Message */}
              <label htmlFor="fb-message" className="block text-sm font-mono uppercase tracking-wider text-text-muted mb-2">
                Message
              </label>
              <textarea
                id="fb-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What's on your mind?"
                rows={5}
                maxLength={2000}
                className="w-full bg-surface-elevated/60 border border-border rounded-lg px-4 py-3 text-white placeholder:text-text-muted/60 focus:outline-none focus:border-accent transition-colors resize-none"
              />
              <div className="flex justify-between items-center mt-1 mb-6 text-xs text-text-muted">
                <span>{messageTooShort ? "At least 3 characters" : ""}</span>
                <span className={messageTooLong ? "text-red-400" : ""}>{message.length}/2000</span>
              </div>

              {/* Contact (optional) */}
              <label htmlFor="fb-contact" className="block text-sm font-mono uppercase tracking-wider text-text-muted mb-2">
                Contact <span className="normal-case text-text-muted/60">(optional — email or @handle)</span>
              </label>
              <input
                id="fb-contact"
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="you@example.com or @yourhandle"
                maxLength={200}
                className="w-full bg-surface-elevated/60 border border-border rounded-lg px-4 py-3 text-white placeholder:text-text-muted/60 focus:outline-none focus:border-accent transition-colors mb-6"
              />

              {/* Honeypot — hidden from users, baited for bots */}
              <input
                type="text"
                name="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
              />

              {/* Error */}
              {status === "error" && errorMsg && (
                <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                  {errorMsg}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={disabled}
                className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {status === "submitting" ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send feedback
                  </>
                )}
              </button>

              <p className="text-center text-xs text-text-muted mt-4">
                Public — your message may appear on our roadmap. Personal info stays private.
              </p>
            </>
          )}
        </motion.form>
      </div>
    </section>
  );
}
