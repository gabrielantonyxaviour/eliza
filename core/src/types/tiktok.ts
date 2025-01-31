export interface TikTokData {
    name: string;
    symbol: string;
    address: string;
    isDead: boolean;
    deathScore: number;
    deathFactors: DeathFactors;
    keyMetrics: TikTokMetrics;
}

export interface TikTokMetrics {
    price: number;
    marketCap: number;
    dailyTrades: number;
    dailyVolumeUSD: number;
    holders: number;
    hoursSinceLastTrade: number;
    liquidity: number;
}

export interface DeathFactors {
    noRecentTrades: boolean;
    lowVolume: boolean;
    fewHolders: boolean;
    tradingInactive: boolean;
    noLiquidity: boolean;
    tinyMarketCap: boolean;
    limitedMarkets: boolean;
}

export interface TokenData {
    name: string;
    symbol: string;
    address: string;
    trade24h: number;
    v24hUSD: number;
    holder: number;
    lastTradeUnixTime: number;
    liquidity: number;
    price: number;
    mc: number;
    numberMarkets: number;
}