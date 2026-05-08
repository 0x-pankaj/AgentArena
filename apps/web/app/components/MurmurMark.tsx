import { cn } from "@/lib/utils";

interface MurmurMarkProps {
  className?: string;
}

// Stylized swarm cluster — a flock of dots evoking murmuration.
export function MurmurMark({ className }: MurmurMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("w-5 h-5", className)}
      aria-hidden="true"
    >
      <circle cx="5" cy="6" r="1.6" />
      <circle cx="11" cy="4" r="1.2" />
      <circle cx="17" cy="7" r="1.8" />
      <circle cx="9" cy="10" r="1.5" />
      <circle cx="15" cy="12" r="1.3" />
      <circle cx="20" cy="11" r="1" />
      <circle cx="5" cy="14" r="1.2" />
      <circle cx="11" cy="17" r="1.7" />
      <circle cx="17" cy="19" r="1.4" />
    </svg>
  );
}
