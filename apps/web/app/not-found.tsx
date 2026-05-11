import Link from "next/link";
import { MurmurMark } from "./components/MurmurMark";

export default function NotFound() {
  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 border border-accent/30 mb-8">
          <MurmurMark className="w-8 h-8 text-accent" />
        </div>
        <p className="font-mono text-xs tracking-[0.2em] text-text-muted mb-3">
          ERR · 404 · OFF_THE_SWARM
        </p>
        <h1 className="font-heading font-bold text-4xl sm:text-5xl text-white mb-4">
          The agents haven&apos;t scouted this path.
        </h1>
        <p className="text-text-secondary mb-8">
          The page you&apos;re looking for doesn&apos;t exist. Head back to the
          hive.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-dark transition-colors shadow-[0_0_24px_rgba(249,115,22,0.25)]"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
