// --- The Odds API Integration ---
// Free tier: 500 requests/month, no API key needed for basic endpoints
// Provides: game odds, scores, team stats, injuries, standings

import { cachedFetch } from "../utils/cache";

const BASE_URL = "https://api.the-odds-api.com/v4";

// --- Types ---

export interface SportEvent {
  id: string;
  sportKey: string;
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: Array<{
    key: string;
    title: string;
    lastUpdate: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

export interface SportScore {
  id: string;
  sportKey: string;
  sportTitle: string;
  commenceTime: string;
  completed: boolean;
  homeTeam: string;
  awayTeam: string;
  scores: Array<{
    name: string;
    score: string;
  }>;
  lastUpdate: string;
}

export interface SportsSignal {
  sport: string;
  totalEvents: number;
  avgOddsMovement: number;
  sharpMoneyIndicator: number; // -1 to 1, positive = sharp on favorite
  upcomingGames: Array<{
    matchup: string;
    commenceTime: string;
    homeOdds: number;
    awayOdds: number;
    impliedProbHome: number;
    impliedProbAway: number;
    oddsMovement: number;
  }>;
  fetchedAt: string;
}

// --- API Client ---

const API_KEY = process.env.ODDS_API_KEY ?? "";

async function oddsApiRequest<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const searchParams = new URLSearchParams({ ...params, apiKey: API_KEY });
  const url = `${BASE_URL}${path}?${searchParams.toString()}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  if (!response.ok) {
    throw new Error(`Odds API error ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

// --- Sport Keys (what Jupiter/Polymarket might cover) ---

const SPORT_KEYS: Record<string, string[]> = {
  nfl: ["americanfootball_nfl"],
  nba: ["basketball_nba"],
  mlb: ["baseball_mlb"],
  soccer: ["soccer_epl", "soccer_uefa_champs_league", "soccer_fifa_world_cup"],
  mma: ["mma_mixed_martial_arts"],
  tennis: ["tennis_atp_us_open", "tennis_wta_us_open"],
};

// --- Fetch upcoming events for a sport ---

export async function getUpcomingEvents(
  sport: string = "all"
): Promise<SportEvent[]> {
  const keys = sport === "all"
    ? Object.values(SPORT_KEYS).flat()
    : (SPORT_KEYS[sport] ?? []);

  const events: SportEvent[] = [];

  for (const sportKey of keys.slice(0, 3)) { // limit to 3 sports to stay within rate limits
    try {
      const data = await oddsApiRequest<SportEvent[]>(
        `/sports/${sportKey}/odds`,
        { regions: "us", markets: "h2h", oddsFormat: "decimal" }
      );
      events.push(...data);
    } catch {
      // skip failed sport key
    }
  }

  return events;
}

// --- Get scores (for settled markets) ---

export async function getScores(
  sportKey: string,
  daysFrom: number = 3
): Promise<SportScore[]> {
  try {
    return await oddsApiRequest<SportScore[]>(
      `/sports/${sportKey}/scores`,
      { daysFrom: String(daysFrom) }
    );
  } catch {
    return [];
  }
}

// --- Build sports signals for the sports agent ---

export async function getSportsSignals(): Promise<Record<string, SportsSignal>> {
  return cachedFetch("sports", ["signals"], async () => {
    const signals: Record<string, SportsSignal> = {};

    for (const [sport, keys] of Object.entries(SPORT_KEYS)) {
      try {
        const events: SportEvent[] = [];
        for (const key of keys.slice(0, 1)) { // 1 key per sport to save rate limits
        try {
          const data = await oddsApiRequest<SportEvent[]>(
            `/sports/${key}/odds`,
            { regions: "us", markets: "h2h", oddsFormat: "decimal" }
          );
          events.push(...data);
        } catch {
          // skip
        }
      }

      if (events.length === 0) continue;

      // Calculate odds movement and sharp money indicators
      let totalMovement = 0;
      let sharpIndicator = 0;
      const upcomingGames: SportsSignal["upcomingGames"] = [];

      for (const event of events.slice(0, 10)) {
        const firstBook = event.bookmakers[0];
        if (!firstBook) continue;

        const h2h = firstBook.markets.find((m) => m.key === "h2h");
        if (!h2h || h2h.outcomes.length < 2) continue;

        const homeOutcome = h2h.outcomes.find(
          (o) => o.name === event.homeTeam
        );
        const awayOutcome = h2h.outcomes.find(
          (o) => o.name === event.awayTeam
        );

        if (!homeOutcome || !awayOutcome) continue;

        const homeOdds = homeOutcome.price;
        const awayOdds = awayOutcome.price;
        const impliedProbHome = 1 / homeOdds;
        const impliedProbAway = 1 / awayOdds;

        // Odds movement: compare first book vs average of all books
        let avgHomeOdds = homeOdds;
        if (event.bookmakers.length > 1) {
          const allHomePrices = event.bookmakers
            .map((b) => b.markets.find((m) => m.key === "h2h")?.outcomes.find((o) => o.name === event.homeTeam)?.price)
            .filter((p): p is number => p !== undefined);
          avgHomeOdds = allHomePrices.reduce((a, b) => a + b, 0) / allHomePrices.length;
        }

        const movement = Math.abs(homeOdds - avgHomeOdds) / homeOdds;
        totalMovement += movement;

        // Sharp money: if odds are shorter than market average, sharp money is on that side
        if (homeOdds < avgHomeOdds) sharpIndicator += impliedProbHome;
        else sharpIndicator -= impliedProbAway;

        upcomingGames.push({
          matchup: `${event.homeTeam} vs ${event.awayTeam}`,
          commenceTime: event.commenceTime,
          homeOdds,
          awayOdds,
          impliedProbHome: Math.round(impliedProbHome * 10000) / 10000,
          impliedProbAway: Math.round(impliedProbAway * 10000) / 10000,
          oddsMovement: Math.round(movement * 10000) / 10000,
        });
      }

      signals[sport] = {
        sport,
        totalEvents: events.length,
        avgOddsMovement: events.length > 0 ? totalMovement / events.length : 0,
        sharpMoneyIndicator: Math.max(-1, Math.min(1, sharpIndicator)),
        upcomingGames,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      // skip failed sport
    }
  }

    return signals;
  });
}

// --- Get available sport keys (for Jupiter mapping) ---

export function getAvailableSports(): string[] {
  return Object.keys(SPORT_KEYS);
}
