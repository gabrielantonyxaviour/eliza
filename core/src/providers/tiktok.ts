import { DeadTicker, IAgentRuntime, Memory, Mention, Provider, State } from "../core/types.ts";
import settings from "../core/settings.ts";
import NodeCache from "node-cache";
import * as fs from "fs";
import * as path from "path";
import { TikTokData, TokenData } from "../types/tiktok.ts";

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


    private async fetchTickerAddress(keyword: string): Promise<{ address: string, chain: string } | null> {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'X-API-KEY': process.env.BIRDEYE_API_KEY || ''
            }
        };

        const url = `https://public-api.birdeye.so/defi/v3/search?keyword=${encodeURIComponent(keyword)}&target=token&sort_by=price&sort_type=desc&offset=0&limit=20`;

        try {
            const response = await fetch(url, options);
            const data = await response.json();

            if (!data.success || !data.data?.items?.[0]?.result || data.data.items[0].result.length == 0) {
                return null;
            }

            let i = 0
            while (i < data.data.items[0].result.length) {
                if (data.data.items[0].result[i].symbol == keyword) return { address: data.data.items[0].result[i].address, chain: data.data.items[0].result[i].network }
                i++
            }
            return null
        } catch (error) {
            console.error('Error fetching token data:', error);
            return null;
        }
    }


    private analyzeTokenHealth(tokenData: TokenData): TikTokData {
        const {
            name, symbol, address,
            trade24h,
            v24hUSD,
            holder,
            lastTradeUnixTime,
            liquidity,
            price,
            mc,
            numberMarkets
        } = tokenData;

        const currentTime = Math.floor(Date.now() / 1000);
        const hoursSinceLastTrade = (currentTime - lastTradeUnixTime) / 3600;

        const DEAD_CRITERIA = {
            MIN_24H_TRADES: 10,
            MIN_24H_VOLUME_USD: 100, // $100 minimum daily volume
            MIN_HOLDERS: 5,
            MAX_HOURS_NO_TRADE: 24,
            MIN_LIQUIDITY: 1000, // $1000 minimum liquidity
            MIN_MARKET_CAP: 10000, // $10,000 minimum market cap
            MIN_MARKETS: 1
        };

        // Calculate individual death factors
        const deathFactors = {
            noRecentTrades: trade24h <= DEAD_CRITERIA.MIN_24H_TRADES,
            lowVolume: v24hUSD <= DEAD_CRITERIA.MIN_24H_VOLUME_USD,
            fewHolders: holder <= DEAD_CRITERIA.MIN_HOLDERS,
            tradingInactive: hoursSinceLastTrade >= DEAD_CRITERIA.MAX_HOURS_NO_TRADE,
            noLiquidity: liquidity <= DEAD_CRITERIA.MIN_LIQUIDITY,
            tinyMarketCap: mc <= DEAD_CRITERIA.MIN_MARKET_CAP,
            limitedMarkets: numberMarkets < DEAD_CRITERIA.MIN_MARKETS
        };

        // Token is considered dead if it meets multiple death criteria
        const deathScore = Object.values(deathFactors).filter(Boolean).length;
        const isDead = deathScore >= 3; // Token is dead if it meets 3 or more death criteria

        return {
            name,
            symbol,
            address,
            isDead,
            deathScore,
            keyMetrics: {
                price,
                marketCap: mc,
                dailyTrades: trade24h,
                dailyVolumeUSD: v24hUSD,
                holders: holder,
                hoursSinceLastTrade: Math.round(hoursSinceLastTrade),
                liquidity,
            },
            deathFactors
        };
    }

    private async fetchTokenData(token: { address: string, chain: string }): Promise<TikTokData | null> {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'X-API-KEY': process.env.BIRDEYE_API_KEY || '',
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

        // Check cache
        const cached = this.getCachedData<TikTokData[]>(cacheKey);
        if (cached) return cached;

        const mentions = await this.getTrendingMentions();
        const tokens = await Promise.all(
            mentions.map(async mention => {
                const token = await this.fetchTickerAddress(mention.mention);
                if (token === null) {
                    return null;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
                const tokenData = await this.fetchTokenData(token);
                if (tokenData === null) {
                    return null;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
                return tokenData;
            })
        ).then(results => results.filter(result => result !== null));
        const nonDeadTokens = tokens.filter(token => !token.isDead);

        if (nonDeadTokens.length == 0) {
            console.log("No Trending Tickers in Tiktok at the moment.")
        }

        const postedAt = new Date()
        const pushData = tokens.map(token => {
            return {
                name: token.symbol,
                posted_at: token.isDead ? new Date(0) : postedAt,
                is_dead: token.isDead,
            }
        })
        await this.runtime.databaseAdapter.updateDeadTickers(pushData)

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
        let output = "**Trending Ticker mentions on TikTok with Market Data**\n\n";
        if (!data?.length) return "No token data available";

        return data.map(token =>
            `Token: ${token.name} (${token.symbol})
          Address: ${token.address}
          Price: $${token.keyMetrics.price.toFixed(6)}
          Market Cap: $${token.keyMetrics.marketCap.toLocaleString()}
          24h Trades: ${token.keyMetrics.dailyTrades}
          24h Volume: $${token.keyMetrics.dailyVolumeUSD.toLocaleString()}
          Holders: ${token.keyMetrics.holders}
          Hours Since Last Trade: ${token.keyMetrics.hoursSinceLastTrade}
          Liquidity: $${token.keyMetrics.liquidity.toLocaleString()}`
        ).join('\n\n');
    }

    async getFormattedTikTokData(): Promise<string> {
        try {
            const tikTokData = await this.getTikTokData();
            return this.formatTikTokData(tikTokData);
        } catch (error) {
            console.error("Error formatting news:", error);
            return "Unable to fetch news at this time. Please try again later.";
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
            return "Unable to fetch news at this time. Please try again later.";
        }
    },
};

export { tiktokProvider };
