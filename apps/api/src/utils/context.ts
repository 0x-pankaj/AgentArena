import type { Context } from "./trpc";

export function createContext({ req }: { req: Request }): Context {
  const walletAddress = req.headers.get("x-wallet-address") ?? undefined;
  // Best-effort client IP for rate-limiting public endpoints. Trusts the
  // standard proxy headers — in production, terminate at a known proxy
  // (Cloudflare/Fly/Vercel) so these aren't spoofable.
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  return { walletAddress, ip, userAgent };
}
