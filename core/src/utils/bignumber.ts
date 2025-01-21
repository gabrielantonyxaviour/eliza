import BigNumber from "bignumber.js";

// Re-export BigNumber constructor
export const BN = BigNumber;

// Helper function to create new BigNumber instances
export function toBN(value: string | number | BigNumber): BigNumber {
    return new BigNumber(value);
}

export function formatNumber(num: number): string {
    if (num >= 1_000_000_000) {
        return `${(num / 1_000_000_000).toFixed(2)}b`; // Billion
    } else if (num >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(2)}m`; // Million
    } else if (num >= 1_000) {
        return `${(num / 1_000).toFixed(2)}k`; // Thousand
    } else {
        return num.toString(); // Less than 1,000
    }
}
