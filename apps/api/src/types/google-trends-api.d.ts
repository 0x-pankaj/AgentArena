declare module "google-trends-api" {
  export function interestOverTime(options: {
    keyword: string | string[];
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
  }): Promise<string>;

  export function interestByRegion(options: {
    keyword: string | string[];
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
    resolution?: "COUNTRY" | "REGION" | "CITY" | "DMA";
  }): Promise<string>;

  export function relatedQueries(options: {
    keyword: string | string[];
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
  }): Promise<string>;

  export function relatedTopics(options: {
    keyword: string | string[];
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
  }): Promise<string>;

  export function realTimeTrends(options: {
    geo?: string;
    category?: string;
  }): Promise<string>;

  export function dailyTrends(options: {
    geo?: string;
    hl?: string;
    timezone?: number;
    trendDate?: Date;
  }): Promise<string>;
}
