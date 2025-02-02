import { DeadTicker, IAgentRuntime, Memory, Mention, Provider, State } from "../core/types.ts";
import settings from "../core/settings.ts";
import NodeCache from "node-cache";
import * as fs from "fs";
import * as path from "path";
import { DexPairData, TikTokData, TokenData } from "../types/tiktok.ts";

class TikTokProvider {
    private cache: NodeCache;
    private cacheDir: string;
    private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    private runtime: IAgentRuntime;

    constructor(_runtime: IAgentRuntime) {
        this.runtime = _runtime;
        this.cache = new NodeCache({ stdTTL: 300 });
        const __dirname = path.resolve();
        this.cacheDir = path.join(__dirname, "cache");
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir);
        }
    }

    private async getTrendingMentions(): Promise<Mention[]> {
        try {
            return await this.runtime.databaseAdapter.getTrendingMentions();
        } catch (error) {
            console.error('Error getting trending mentions:', error);
            throw error;
        }
    };

    private async getAggregatedMentions(): Promise<Mention[]> {
        try {
            return await this.runtime.databaseAdapter.getAggregatedMentions();
        } catch (error) {
            console.error('Error getting aggregated mentions:', error);
            throw error;
        }
    }


    private async fetchTicker(keyword: string): Promise<DexPairData | null> {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'X-API-KEY': settings.BIRDEYE_API_KEY || ''
            }
        };

        const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(keyword)}`;
        try {
            const response = await fetch(url, options);
            const data = await response.json();
            if (!data || !data.pairs || data.pairs.length == 0) {
                return null;
            }

            return data.pairs[0]
        } catch (error) {
            console.error('Error fetching token data:', error);
            return null;
        }
    }

    private analyzeTokenHealth(tokenData: DexPairData): TikTokData {
        const {
            baseToken,
            pairAddress,
            txns,
            volume,
            liquidity,
            priceUsd,
            priceChange,
            marketCap,
        } = tokenData;

        const currentTime = Math.floor(Date.now() / 1000);
        const hoursSinceLastTrade = (currentTime - tokenData.pairCreatedAt / 1000) / 3600;

        const DEAD_CRITERIA = {
            MIN_24H_TRADES: 5,
            MIN_24H_VOLUME_USD: 50,
            MIN_LIQUIDITY: 500,
            MIN_MARKET_CAP: 5000,
            MAX_HOURS_NO_TRADE: 48
        };

        // Calculate individual death factors
        const totalTrades = txns.h24.buys + txns.h24.sells;
        const buySellRatio = totalTrades > 0 ? txns.h24.buys / totalTrades : 0;

        const deathFactors = {
            lowTradeActivity: totalTrades <= DEAD_CRITERIA.MIN_24H_TRADES,
            lowVolume: volume.h24 <= DEAD_CRITERIA.MIN_24H_VOLUME_USD,
            noLiquidity: liquidity.usd <= DEAD_CRITERIA.MIN_LIQUIDITY,
            tinyMarketCap: marketCap <= DEAD_CRITERIA.MIN_MARKET_CAP,
            tradingInactive: hoursSinceLastTrade >= DEAD_CRITERIA.MAX_HOURS_NO_TRADE
        };

        // Token is considered dead if it meets 3 or more death criteria
        const deathScore = Object.values(deathFactors).filter(Boolean).length;
        const isDead = deathScore >= 3;

        return {
            name: baseToken.name,
            symbol: baseToken.symbol,
            address: baseToken.address,
            isDead,
            deathScore,
            tiktokMentions: tokenData.tiktokMentions,
            keyMetrics: {
                price: parseFloat(priceUsd),
                marketCap,
                dailyTrades: totalTrades,
                dailyVolumeUSD: volume.h24,
                hoursSinceLastTrade: Math.round(hoursSinceLastTrade),
                liquidityUSD: liquidity.usd,
                liquidityBaseToken: liquidity.base, // Adding liquidity in base tokens
                buySellRatio, // Adding buy/sell ratio to assess trading behavior
                priceChange24h: priceChange.h24 // Including 24-hour price change %
            },
            deathFactors
        };
    }


    private async fetchTokenData(token: { address: string, chain: string }): Promise<TikTokData | null> {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'X-API-KEY': settings.BIRDEYE_API_KEY || '',
                'x-chain': token.chain
            }
        };
        await new Promise(resolve => setTimeout(resolve, 500));
        const url = `https://public-api.birdeye.so/defi/token_overview?address=${token.address}`;

        try {
            const response = await fetch(url, options);
            const data = await response.json();

            if (!data.success || !data.data) {
                return null;
            }
            return this.analyzeTokenHealth(data.data);

        } catch (error) {
            return null;
        }
    }



    private async getTikTokData(): Promise<TikTokData[]> {
        const cacheKey = `tiktokData`;

        console.log('Checking cache for TikTok data. DISABLED TEMPORARILY');
        const cached = this.getCachedData<TikTokData[]>(cacheKey);
        // if (cached) {
        //     console.log('Cache hit for TikTok data');
        //     return cached;
        // }

        // console.log('Fetching aggregated mentions from the database');
        // const mentions = await this.getAggregatedMentions();

        console.log('Fetching trending mentions from the database');
        const mentions = await this.getTrendingMentions();

        console.log('Fetching token data for each mention');

        const tokens: TikTokData[] = [];
        for (const mention of mentions) {
            console.log("Fetching token address for ticker:", mention.mention);
            const token = await this.fetchTicker(mention.mention);
            if (!token) {
                console.log(`No token found for mention: ${mention.mention}`);
                continue;
            }
            const analyzedToken = this.analyzeTokenHealth({ ...token, tiktokMentions: mention.total_count });
            tokens.push(analyzedToken);
            if (tokens.length >= 5) {
                break;
            }
        }

        const nonDeadTokens = tokens.filter(token => !token.isDead);

        if (nonDeadTokens.length == 0) {
            console.log("No Trending Tickers in Tiktok at the moment.");
        }

        const postedAt = new Date();
        const pushData = tokens.map(token => {
            console.log(token.symbol + " is " + (token.isDead ? '' : "not") + "dead");
            return {
                name: token.symbol,
                posted_at: token.isDead ? new Date(0) : postedAt,
                is_dead: token.isDead,
            }
        });

        console.log('Updating dead tickers in the database');
        await this.runtime.databaseAdapter.updateDeadTickers(pushData);

        console.log('Caching non-dead tokens');
        this.setCachedData(cacheKey, nonDeadTokens);

        return nonDeadTokens;
    }

    private getCachedData<T>(key: string): T | null {
        const cached = this.cache.get<T>(key);
        if (cached) return cached;

        const filePath = path.join(this.cacheDir, `${key}.json`);
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(fileContent);
            if (Date.now() < parsed.expiry) {
                this.cache.set(key, parsed.data);
                return parsed.data as T;
            }
            fs.unlinkSync(filePath);
        }
        return null;
    }

    private setCachedData<T>(key: string, data: T): void {
        this.cache.set(key, data);
        const filePath = path.join(this.cacheDir, `${key}.json`);
        fs.writeFileSync(
            filePath,
            JSON.stringify({
                data,
                expiry: Date.now() + this.CACHE_DURATION,
            })
        );
    }

    formatTikTokData(data: TikTokData[]): string {
        let output = "**Trending Ticker Mentions on TikTok with Market Data**\n\n";
        if (!data?.length) return "No token data available";
        return output + data.map(token =>
            `Token: ${token.name} (${token.symbol})
        Address: ${token.address}
        Tiktok Mentions: ${token.tiktokMentions}
        Price: $${token.keyMetrics.price ? token.keyMetrics.price.toFixed(6) : 'N/A'}
        Market Cap: $${token.keyMetrics.marketCap ? token.keyMetrics.marketCap.toLocaleString() : 'N/A'}
        24h Trades: ${token.keyMetrics.dailyTrades ? token.keyMetrics.dailyTrades : 'N/A'}
        24h Volume: $${token.keyMetrics.dailyVolumeUSD ? token.keyMetrics.dailyVolumeUSD.toLocaleString() : 'N/A'}
        Buy/Sell Ratio: ${(token.keyMetrics.buySellRatio ? token.keyMetrics.buySellRatio * 100 : 0).toFixed(2)}
        24h Price Change: ${(token.keyMetrics.priceChange24h ? token.keyMetrics.priceChange24h : 0).toFixed(2)}%
        Hours Since Last Trade: ${token.keyMetrics.hoursSinceLastTrade ? token.keyMetrics.hoursSinceLastTrade : 'N/A'}
        Liquidity: $${token.keyMetrics.liquidityUSD ? token.keyMetrics.liquidityUSD.toLocaleString() : 'N/A'}
        Liquidity (Base Token): ${token.keyMetrics.liquidityBaseToken ? token.keyMetrics.liquidityBaseToken.toLocaleString() : 'N/A'}`
        ).join('\n\n');
    }

    formatSingleTiktokData(token: TikTokData): string {
        return `Token: ${token.name} (${token.symbol})
    Address: ${token.address}
    Tiktok Mentions: ${token.tiktokMentions}
    Price: $${token.keyMetrics.price ? token.keyMetrics.price.toFixed(6) : 'N/A'}
    Market Cap: $${token.keyMetrics.marketCap ? token.keyMetrics.marketCap.toLocaleString() : 'N/A'}
    24h Trades: ${token.keyMetrics.dailyTrades ? token.keyMetrics.dailyTrades : 'N/A'}
    24h Volume: $${token.keyMetrics.dailyVolumeUSD ? token.keyMetrics.dailyVolumeUSD.toLocaleString() : 'N/A'}
    Buy/Sell Ratio: ${(token.keyMetrics.buySellRatio ? token.keyMetrics.buySellRatio * 100 : 0).toFixed(2)}
    24h Price Change: ${(token.keyMetrics.priceChange24h ? token.keyMetrics.priceChange24h : 0).toFixed(2)}%
    Hours Since Last Trade: ${token.keyMetrics.hoursSinceLastTrade ? token.keyMetrics.hoursSinceLastTrade : 'N/A'}
    Liquidity: $${token.keyMetrics.liquidityUSD ? token.keyMetrics.liquidityUSD.toLocaleString() : 'N/A'}
    Liquidity (Base Token): ${token.keyMetrics.liquidityBaseToken ? token.keyMetrics.liquidityBaseToken.toLocaleString() : 'N/A'}`
    }

    async getMentionsByTicker(ticker: string): Promise<number> {
        try {
            const total_count = await this.runtime.databaseAdapter.getMentionsByTicker(ticker);
            return total_count
        } catch (error) {
            console.error('Error fetching mentions by ticker:', error);
            return 0;
        }
    }

    async getTokenDataByTicker(tickers: string[]): Promise<string> {
        const responses = []
        for (const ticker of tickers) {
            const token = await this.fetchTicker(ticker);
            if (token === null) {
                responses.push("No token found for ticker: " + ticker);
                continue;
            }
            const mentions = await this.getMentionsByTicker(ticker);
            const analyzedToken = this.analyzeTokenHealth({ ...token, tiktokMentions: mentions });
            responses.push(this.formatSingleTiktokData(analyzedToken));
        }

        return responses.join('\n\n');
    }

    async getFormattedTikTokData(): Promise<string> {
        try {
            const tikTokData = await this.getTikTokData();
            return this.formatTikTokData(tikTokData);
        } catch (error) {
            console.error("Error formatting Tiktok Data:", error);
            return "Unable to fetch Tiktok Data at this time. Please try again later.";
        }
    }
}

const tiktokProvider: Provider = {
    get: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ): Promise<string> => {
        try {
            const provider = new TikTokProvider(runtime);
            return provider.getFormattedTikTokData();
        } catch (error) {
            console.error("Error fetching news:", error);
            return "Unable to fetch Tiktok Data at this time. Please try again later.";
        }
    },
};

export { tiktokProvider, TikTokProvider };
