import { IAgentRuntime, Memory, Provider, State } from "../core/types.ts";
import settings from "../core/settings.ts";
import NodeCache from "node-cache";
import * as fs from "fs";
import * as path from "path";
import { AggregatedNewsData, CryptoPanicNewsItem } from "../types/news.ts";
import { TwitterNewsItem } from "../types/news.ts";
import { TikTokData } from "../types/tiktok.ts";

class TikTokProvider {
    private cache: NodeCache;
    private cacheDir: string;
    private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    private readonly API_CONFIG = {
        SUPABASE_URL: "",
        MAX_RETRIES: 3,
        RETRY_DELAY: 2000,
    };

    constructor() {
        this.cache = new NodeCache({ stdTTL: 300 });
        const __dirname = path.resolve();
        this.cacheDir = path.join(__dirname, "cache");
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir);
        }
    }
    private async getTikTokData(): Promise<TikTokData> {
        const cacheKey = `tiktokData`;

        // Check cache
        const cached = this.getCachedData<TikTokData>(cacheKey);
        if (cached) return cached;

        // const url = `${this.API_CONFIG.SUPABASE_URL}`;

        for (let i = 0; i < this.API_CONFIG.MAX_RETRIES; i++) {
            try {
                // const response = await fetch(url);
                let response;
                // TODO: Make supabase request to fetch Tiktok Mentions
                if (!response.ok)
                    throw new Error(`HTTP status ${response.status}`);

                const data = await response.json();
                this.setCachedData(cacheKey, data);
                return data;
            } catch (error) {
                if (i === this.API_CONFIG.MAX_RETRIES - 1) throw error;
                await new Promise((resolve) =>
                    setTimeout(
                        resolve,
                        this.API_CONFIG.RETRY_DELAY * Math.pow(2, i)
                    )
                );
            }
        }
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

    formatTikTokData(data: TikTokData): string {
        let output = "**TikTok Mentions update for Tickers**\n\n";
        const date = new Date(data.sinceTimestamp * 1000).toLocaleString(
            "en-US",
            {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
            }
        );
        output += `Since ${date}, Here are the ticker metrics on Tiktok\n\n**MENTIONS**\n\n`;
        data.metrics.forEach((ticker) => {
            output += `${ticker.ticker} - ${ticker.mentions}\n`;
        });
        output += `\n**VIEWS**\n\n`;
        data.metrics.forEach((ticker) => {
            output += `${ticker.ticker} - ${ticker.views}`;
        });

        return output;
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
            const bearerToken =
                runtime.getSetting("TWITTER_BEARER_TOKEN") || "";
            const provider = new TikTokProvider();
            return provider.getFormattedTikTokData();
        } catch (error) {
            console.error("Error fetching news:", error);
            return "Unable to fetch news at this time. Please try again later.";
        }
    },
};

export { tiktokProvider };
