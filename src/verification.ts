import {artifacts, ethers, network} from "hardhat";
import {ChainConfig} from "@nomicfoundation/hardhat-verify/types";
import {Etherscan} from "@nomicfoundation/hardhat-verify/etherscan";
import {
    builtinChains
} from "@nomicfoundation/hardhat-verify/internal/chain-config";
import chalk from "chalk";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";
import proxyArtifact from
"@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/transparent/TransparentUpgradeableProxy.sol/TransparentUpgradeableProxy.json";
import proxyBuildInfo from "@openzeppelin/upgrades-core/artifacts/build-info-v5.json";

const RETRIES_AMOUNT = 5;

interface VerificationTarget {
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
    const schain = pathname.split("/").filter(Boolean).pop()!;

    let networkType: keyof typeof BASE_EXPLORER_URLS;
    if (host.includes("mainnet.")) {
        networkType = "mainnet";
    } else if (host.includes("testnet.")) {
        networkType = "testnet";
    } else if (host.includes("legacy-proxy.")) {
        networkType = "legacy";
    } else {
        throw new Error(`Unknown network in ENDPOINT: ${endpoint}`);
    }
    return {networkType, schain};
}

const getExplorerUrls = async (chainConfig?: ChainConfig) => {
    if (process.env.EXPLORER_URL) {
        const browserURL = process.env.EXPLORER_URL;
        const apiURL = `${browserURL}/api`;
        return {apiURL, browserURL};
    }
    if (chainConfig) {
        return chainConfig.urls;
    }
    const endpoint = process.env.ENDPOINT;
    if (!endpoint) {
        throw new Error("ENDPOINT is not set");
    }
    const {schain, networkType} = parseEndpoint(endpoint);
    const browserURL = `https://${schain}.${BASE_EXPLORER_URLS[networkType]}`;
    const apiURL = `${browserURL}/api`;
    if (!(await pingExplorer(browserURL))) {
        throw new Error(`Explorer is not reachable, set EXPLORER_URL`);
    }
    return {apiURL, browserURL};
}

const isVerifiedOnBlockscout = async (apiURL: string, address: string): Promise<boolean> => {
    const url = `${apiURL}/v2/smart-contracts/${address}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data?.is_verified;
    } catch {
        return false;
    }
};

const getVerifyParameters = async (contractName: string) => {
    let fullContractName: string;
    let compilerVersion: string;
    let solcInputJson: string;
    if (contractName === "TransparentUpgradeableProxy") {
        fullContractName = `${proxyArtifact.sourceName}:${contractName}`;
        compilerVersion = proxyBuildInfo.solcLongVersion;
        solcInputJson = JSON.stringify(proxyBuildInfo.input);
    } else {
        const artifact = await artifacts.readArtifact(contractName);
        fullContractName = `${artifact.sourceName}:${contractName}`;
        const buildinfo = await artifacts.getBuildInfo(fullContractName);
        if (!buildinfo) {
            throw new Error(`No build-info for ${contractName}`);
        }
        compilerVersion = buildinfo.solcLongVersion;
        solcInputJson = JSON.stringify(buildinfo.input);
    }
    return {
        compilerVersion,
        fullContractName,
        solcInputJson
    }
}

const verificationAttempt = async (verificationTarget: VerificationTarget) => {
    const {contractName, contractAddress, explorerUrls, isEtherscan} = verificationTarget;
    const {browserURL, apiURL} = explorerUrls;
    const escan = new Etherscan(
        process.env.ETHERSCAN || "",
        apiURL,
        browserURL,
    );
    const {fullContractName, compilerVersion, solcInputJson} = await getVerifyParameters(contractName);
    const isVerifiedOnEtherscan = isEtherscan && await escan.isVerified(contractAddress);
    if (isVerifiedOnEtherscan || await isVerifiedOnBlockscout(apiURL, contractAddress)) {
        const contractURL = escan.getContractUrl(contractAddress);
        console.log(
            `${contractName} is already verified on: ${contractURL}`
        );
        return true;
    }
    let guid: string;
    try {
        const result = await escan.verify(
            contractAddress,
            solcInputJson,
            fullContractName,
            compilerVersion,
            "0x"
        );
        guid = result.message;
    } catch (error) {
        console.log(chalk.yellow(`Verification attempt for ${contractName} failed with error: ${error}`));
        return false;
    }
    const verificationStatus = await escan.getVerificationStatus(guid);
    if (verificationStatus.isFailure()) {
        const errorMessage = `Failed to verify contract ${contractName}`;
        console.log(chalk.red(errorMessage));
        return false;
    }
    const contractURL = escan.getContractUrl(contractAddress);
    console.log(
        `${contractName} is successfully verified on: ${contractURL}`
    );
    return true;
};

const verifyWithRetry = async (
    verificationTarget: VerificationTarget,
    attempts: number
) => {
    if (attempts) {
        if (!await verificationAttempt(verificationTarget)) {
            const failedAttempts = 1;
            await verifyWithRetry(
                verificationTarget,
                attempts - failedAttempts
            );
        }
    }
};

export const verify = async (
    contractName: string,
    contractAddress: string
) => {
    const {chainId} = await ethers.provider.getNetwork();
    const etherscanChainConfig = builtinChains.find((chain) => chain.chainId === Number(chainId));
    const blockscoutChainConfig = blockscoutChains.find((chain) => chain.chainId === Number(chainId));
    const isSkaleChain = !etherscanChainConfig && !blockscoutChainConfig;
    if (etherscanChainConfig) {
        if (process.env.ETHERSCAN) {
            const explorerUrls = await getExplorerUrls(etherscanChainConfig);
            await verifyWithRetry(
                {
                    contractAddress,
                    contractName,
                    explorerUrls,
                    isEtherscan: true
                },
                RETRIES_AMOUNT
            );
        } else {
            console.log(
                chalk.yellow(
                    `No etherscan API key provided. Skipping verification for ${contractName} on Etherscan.`
                )
            );
        }
    }
    if (blockscoutChainConfig) {
        const explorerUrls = await getExplorerUrls(blockscoutChainConfig);
        await verifyWithRetry(
            {
                contractAddress,
                contractName,
                explorerUrls
            },
            RETRIES_AMOUNT
        );
    }
    if (isSkaleChain) {
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
};

export const verifyProxy = async (
    contractName: string,
    proxyAddress: string
) => {
    await verify(
        contractName,
        await getImplementationAddress(
            network.provider,
            proxyAddress
        )
    );
    await verify("TransparentUpgradeableProxy", proxyAddress);
};
