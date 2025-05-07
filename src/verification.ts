import {artifacts, ethers, network} from "hardhat";
import {ChainConfig} from "@nomicfoundation/hardhat-verify/types";
import {ContractVerifier} from "./contractVerifier";
import {
    builtinChains
} from "@nomicfoundation/hardhat-verify/internal/chain-config";
import chalk from "chalk";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";
import proxyArtifact from
"@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/transparent/TransparentUpgradeableProxy.sol/TransparentUpgradeableProxy.json";
import proxyBuildInfo from "@openzeppelin/upgrades-core/artifacts/build-info-v5.json";

const RETRIES_AMOUNT = 5;

export interface VerificationTarget {
    contractName: string;
    contractAddress: string;
    explorerUrls: {
        browserURL: string;
        apiURL: string;
    }
    isEtherscan?: boolean;
}

const BASE_EXPLORER_URLS = {
    legacy: "legacy-explorer.skalenodes.com",
    mainnet: "explorer.mainnet.skalenodes.com",
    testnet: "explorer.testnet.skalenodes.com"
};

const blockscoutChains: ChainConfig[] = [
    {
        chainId: 1,
        network: "mainnet",
        urls: {
            apiURL: "https://eth.blockscout.com/api",
            browserURL: "https://eth.blockscout.com",
        }
    },
    {
        chainId: 11155111,
        network: "sepolia",
        urls: {
            apiURL: "https://eth-sepolia.blockscout.com/api",
            browserURL: "https://eth-sepolia.blockscout.com",
        }
    },
    {
        chainId: 17000,
        network: "holesky",
        urls: {
            apiURL: "https://eth-holesky.blockscout.com/api",
            browserURL: "https://eth-holesky.blockscout.com",
        }
    },
    {
        chainId: 560048,
        network: "hoodi",
        urls: {
            apiURL: "https://eth-hoodi.blockscout.com/api",
            browserURL: "https://eth-hoodi.blockscout.com",
        }
    }
]

const pingExplorer = async (baseUrl: string): Promise<boolean> => {
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
};

const parseEndpoint = (endpoint: string) => {
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

const getSchainExplorerUrls = async () => {
    if (!process.env.ENDPOINT) {
        throw new Error("ENDPOINT is not set");
    }
    const {schainName, networkType} = parseEndpoint(process.env.ENDPOINT);
    const browserURL = `https://${schainName}.${BASE_EXPLORER_URLS[networkType]}`;
    const apiURL = `${browserURL}/api`;
    if (!await pingExplorer(browserURL)) {
        throw new Error(`Explorer is not reachable, set EXPLORER_URL`);
    }
    return {apiURL, browserURL};
}

const getExplorerUrls = async (chainConfig?: ChainConfig) => {
    if (process.env.EXPLORER_URL) {
        return {
            apiURL: `${process.env.EXPLORER_URL}/api`,
            browserURL: process.env.EXPLORER_URL
        };
    }
    if (chainConfig) {
        return chainConfig.urls;
    }
    return await getSchainExplorerUrls();
}

export const isVerifiedOnBlockscout = async (apiURL: string, address: string): Promise<boolean> => {
    const url = `${apiURL}/v2/smart-contracts/${address}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data?.is_verified;
    } catch {
        return false;
    }
};

export const getVerifyParameters = async (contractName: string) => {
    if (contractName === "TransparentUpgradeableProxy") {
        return {
            compilerVersion: proxyBuildInfo.solcLongVersion,
            fullContractName: `${proxyArtifact.sourceName}:${contractName}`,
            solcInputJson: JSON.stringify(proxyBuildInfo.input)
        };
    }
    const artifact = await artifacts.readArtifact(contractName);
    const fullContractName = `${artifact.sourceName}:${contractName}`;
    const buildInfo = await artifacts.getBuildInfo(fullContractName);
    if (!buildInfo) {
        throw new Error(`No build-info for ${contractName}`);
    }
    return {
        compilerVersion: buildInfo.solcLongVersion,
        fullContractName,
        solcInputJson: JSON.stringify(buildInfo.input)
    };
}

const verifyWithRetry = async (
    verificationTarget: VerificationTarget,
    attempts: number
) => {
    if (attempts) {
        const verifier = new ContractVerifier(verificationTarget);
        if (!await verifier.attempt()) {
            const failedAttempts = 1;
            await verifyWithRetry(
                verificationTarget,
                attempts - failedAttempts
            );
        }
    }
};

const verifyOnEtherscan = async (
    contractName: string,
    contractAddress: string,
    chainConfig: ChainConfig
) => {
    if (!process.env.ETHERSCAN) {
        console.log(
            chalk.yellow(
                `No etherscan API key provided. Skipping verification for ${contractName}.`
            )
        );
        return;
    }
    const explorerUrls = await getExplorerUrls(chainConfig);
    await verifyWithRetry(
        {
            contractAddress,
            contractName,
            explorerUrls,
            isEtherscan: true
        },
        RETRIES_AMOUNT
    );
}

const verifyOnBlockscout = async (
    contractName: string,
    contractAddress: string,
    chainConfig: ChainConfig
) => {
    const explorerUrls = await getExplorerUrls(chainConfig);
    await verifyWithRetry(
        {
            contractAddress,
            contractName,
            explorerUrls
        },
        RETRIES_AMOUNT
    );
}

const verifyOnSkale = async (
    contractName: string,
    contractAddress: string
) => {
    const explorerUrls = await getExplorerUrls();
    await verifyWithRetry(
        {
            contractAddress,
            contractName,
            explorerUrls
        },
        RETRIES_AMOUNT
    );
}

export const verify = async (contractName: string, contractAddress: string) => {
    const {chainId} = await ethers.provider.getNetwork();
    const etherscanConfig = builtinChains.find(config => config.chainId === Number(chainId));
    const blockscoutConfig = blockscoutChains.find(config => config.chainId === Number(chainId));
    const isSkaleChain = !etherscanConfig && !blockscoutConfig;

    if (etherscanConfig) {
        await verifyOnEtherscan(contractName, contractAddress, etherscanConfig);
    }
    if (blockscoutConfig) {
        await verifyOnBlockscout(contractName, contractAddress, blockscoutConfig);
    }
    if (isSkaleChain) {
        await verifyOnSkale(contractName, contractAddress);
    }
};

export const verifyProxy = async (contractName: string, proxyAddress: string) => {
    await verify(
        contractName,
        await getImplementationAddress(
            network.provider,
            proxyAddress
        )
    );
    await verify("TransparentUpgradeableProxy", proxyAddress);
};
