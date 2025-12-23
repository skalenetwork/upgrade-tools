import {ethers, network} from "hardhat";
import {AddressLike} from "ethers";
import {BlockscoutVerifier} from "./verifiers/blockscoutVerifier";
import {ContractVerifier} from "./contractVerifier";
import {EtherscanVerifier} from "./verifiers/etherscanVerifier";
import Semaphore from "semaphore-async-await";
import {SkaleBlockscoutVerifier} from "./verifiers/skaleBlockscoutVerifier";
import chalk from "chalk";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";


const setupEtherscan = async (chainId: bigint) => {
    if (process.env.ETHERSCAN) {
        if (await EtherscanVerifier.isChainSupported(chainId)) {
            return new EtherscanVerifier(
                process.env.ETHERSCAN,
                chainId
            );
        }
        console.log(
            chalk.gray(
                `Etherscan does not support chainId ${chainId}. Skipping verification on Etherscan.`
            )
        );
    } else {
        console.log(
            chalk.yellow(
                `No etherscan API key provided. Skipping verification on Etherscan.`
            )
        );
    }
    return null;
}

const setupBlockscout = (chainId: bigint) => {
    const verifier = BlockscoutVerifier.createFromChainId(chainId);
    if (verifier) {
        return verifier;
    }
    console.log(chalk.gray(`Blockscout API url is not known for chainId ${chainId}.`));
    if (process.env.EXPLORER_URL) {
        console.log(chalk.gray("Using EXPLORER_URL to setup verification."));
        return new BlockscoutVerifier(`${process.env.EXPLORER_URL}/api`, process.env.EXPLORER_URL);
    }
    console.log(chalk.gray("Skipping verification on Blockscout."));
    return null;
}

const setupSkale = async () => {
    if (process.env.ENDPOINT) {
        try {
            const verifier = await SkaleBlockscoutVerifier.createFromEndpoint(process.env.ENDPOINT);
            if (verifier) {
                return verifier;
            }
        } catch (error) {
            console.log(chalk.yellow(error));
        }
    } else {
        console.log(
            chalk.gray(
                "ENDPOINT is not provided. Can't determine SKALE block explorer API url."
            )
        );
    }
    console.log(
        chalk.gray(
            "Skipping verification on SKALE block explorer."
        )
    );
    return null;
}

const verifiers: ContractVerifier[] = [];
let verifiersSetup = false;
// Semaphore to limit concurrent creation of verifiers
const MAX_CONCURRENCY = 1;
const lock = new Semaphore(MAX_CONCURRENCY);

const setupVerifiers = async () => {
    try {
        await lock.acquire();
        if (!verifiersSetup) {
            verifiersSetup = true;
            const {chainId} = await ethers.provider.getNetwork();
            const candidates = [
                await setupEtherscan(chainId),
                setupBlockscout(chainId),
                await setupSkale()
            ];
            verifiers.push(...candidates.filter(item => item !== null));
        }
    } finally {
        lock.release();
    }
}

export const verify = async (contractName: string, contractAddress: AddressLike, constructorArguments?: string) => {
    await setupVerifiers();
    const contractAddressString = await ethers.resolveAddress(contractAddress);
    // Try all, don't fail if one fails
    await Promise.allSettled(verifiers.map(verifier => verifier.verify({
        constructorArguments,
        contractAddress: contractAddressString,
        contractName
    })));
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
