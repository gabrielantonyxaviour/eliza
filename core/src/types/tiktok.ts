export interface TikTokData {
    sinceTimestamp: number;
    metrics: TikTokMetrics[];
}

export interface TikTokMetrics {
    id: string;
    ticker: string;
    mentions: string;
    views: string;
}
