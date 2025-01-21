export interface CryptoPanicNewsItem {
    sentiment: number;
    source: string; // Just the domain of the source
    title: string;
    published_at: string;
    currencies: string[]; // Just the currency code
    url: string;
    created_at: string;
}

export interface TwitterNewsItem {
    title: string;
    created_at: string;
    url: string;
}

export interface AggregatedNewsData {
    cryptoPanic: CryptoPanicNewsItem[];
    twitter: TwitterNewsItem[];
    lastUpdated: number;
}
