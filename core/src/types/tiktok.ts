export type TikTokData = {
    name: string;
    symbol: string;
    address: string;
    isDead: boolean;
    deathScore: number;
    tiktokMentions: number;
    keyMetrics: {
        price: number;
        marketCap: number;
        dailyTrades: number;
        dailyVolumeUSD: number;
        hoursSinceLastTrade: number;
        liquidityUSD: number;
        liquidityBaseToken: number;
        buySellRatio: number;
        priceChange24h: number;
    };
    deathFactors: {
        lowTradeActivity: boolean;
        lowVolume: boolean;
        noLiquidity: boolean;
        tinyMarketCap: boolean;
        tradingInactive: boolean;
    };
};


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

export type DexPairData = {
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    tiktokMentions: number;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    quoteToken: {
        address: string;
        name: string;
        symbol: string;
    };
    priceNative: string;
    priceUsd: string;
    txns: {
        m5: { buys: number; sells: number };
        h1: { buys: number; sells: number };
        h6: { buys: number; sells: number };
        h24: { buys: number; sells: number };
    };
    volume: {
        h24: number;
        h6: number;
        h1: number;
        m5: number;
    };
    priceChange: {
        m5: number;
        h1: number;
        h6: number;
        h24: number;
    };
    liquidity: {
        usd: number;
        base: number;
        quote: number;
    };
    fdv: number;
    marketCap: number;
    pairCreatedAt: number;
    info: {
        imageUrl: string;
        header: string;
        openGraph: string;
        websites: { label: string; url: string }[];
        socials: { type: string; url: string }[];
    };
    boosts: {
        active: number;
    };
};
