// Cspell:words skalenodes

import {BlockscoutVerifier} from "./blockscoutVerifier";

const BASE_EXPLORER_URLS = {
    legacy: "legacy-explorer.skalenodes.com",
    mainnet: "explorer.mainnet.skalenodes.com",
    testnet: "explorer.testnet.skalenodes.com"
};

export class SkaleBlockscoutVerifier extends BlockscoutVerifier {
    public name = "SKALE Blockscout";

    public static async createFromEndpoint(endpoint: string): Promise<SkaleBlockscoutVerifier | null> {
        const {schainName, networkType} = SkaleBlockscoutVerifier.parseEndpoint(endpoint);
        const browserURL = `https://${schainName}.${BASE_EXPLORER_URLS[networkType]}`;
        const apiURL = `${browserURL}/api`;
        if (!await SkaleBlockscoutVerifier.pingExplorer(browserURL)) {
            throw new Error(`SKALE block explorer (${browserURL}) is not reachable, set EXPLORER_URL`);
        }
        return new SkaleBlockscoutVerifier(apiURL, browserURL);
    }

    // Private

    private static parseEndpoint(endpoint: string) {
        const {host, pathname} = new URL(endpoint);
        const schainName = pathname.split("/").filter(Boolean).pop()!;

        let networkType: keyof typeof BASE_EXPLORER_URLS = "mainnet";
        if (host.includes("mainnet.")) {
            networkType = "mainnet";
        } else if (host.includes("testnet.")) {
            networkType = "testnet";
        } else if (host.includes("legacy-proxy.")) {
            networkType = "legacy";
        } else {
            throw new Error(`Unknown network in ENDPOINT: ${endpoint}`);
        }
        return {networkType, schainName};
    }

    private static async pingExplorer (baseUrl: string): Promise<boolean> {
        const url = `${baseUrl}/api/health`;
        try {
            const res = await fetch(url);
            if (!res.ok) {
                return false;
            }
            const jsonResponse = await res.json();
            return jsonResponse.healthy;
        } catch {
            return false;
        }
    }
}
