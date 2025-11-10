// Cspell:words apiurl blockexplorer chainname

import {ContractVerifier, VerificationRequestParameters, VerificationTarget} from '../contractVerifier';
import {ChainConfig} from '@nomicfoundation/hardhat-verify/types';
import {ContractVerificationMissingBytecodeError} from '@nomicfoundation/hardhat-verify/internal/errors';
import {Etherscan} from '@nomicfoundation/hardhat-verify/etherscan';
import Semaphore from 'semaphore-async-await';
import {ValidationResponse} from '@nomicfoundation/hardhat-verify/internal/utilities';
import chalk from 'chalk';
import {ethers} from 'hardhat';


const MAX_CONCURRENCY = 1;
const DEFAULT_RETRIES_AMOUNT = 5;
const BLOCKS_TO_WAIT = 5;
const ZERO_ATTEMPTS = 0;
const ONE_ATTEMPT = 1;
const lock = new Semaphore(MAX_CONCURRENCY);

interface VerificationRequestData {
    target: VerificationTarget,
    params: VerificationRequestParameters,
}

export class EtherscanVerifier extends ContractVerifier {
    public readonly name = "Etherscan";
    private readonly etherscan: Etherscan;


    constructor(apiKey: string, chainId: bigint) {
        super();
        this.etherscan = new Etherscan(
            apiKey,
            // API url is set automatically because chainId is provided
            "",
            "https://etherscan.io",
            Number(chainId)
        );
    }

    public static async isChainSupported(chainId: bigint): Promise<boolean> {
        const supportedChains = await EtherscanVerifier.loadEtherscanSupportedChains();
        return supportedChains.some(config => config.chainId === Number(chainId));
    }

    // Protected

    protected async isAlreadyVerified(verificationTarget: VerificationTarget): Promise<boolean> {
        return await this.etherscan.isVerified(verificationTarget.contractAddress);
    }

    protected async submitVerificationRequest(
        target: VerificationTarget,
        params: VerificationRequestParameters,
        retries = DEFAULT_RETRIES_AMOUNT,
    ): Promise<ValidationResponse> {
        try {
            await lock.acquire();
            return await this.etherscan.verify(
                target.contractAddress,
                params.solcInputJson,
                params.fullContractName,
                params.compilerVersion,
                target.constructorArguments || ""
            );
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'ContractVerificationMissingBytecodeError') {
                lock.release();
                return await this.processContractVerificationMissingBytecodeError(
                    error as ContractVerificationMissingBytecodeError,
                    {params, target},
                    retries);
            }
            throw error;
        } finally {
            lock.release();
        }
    }

    protected getContractUrl(verificationTarget: VerificationTarget): string {
        return this.etherscan.getContractUrl(verificationTarget.contractAddress);
    }

    protected async getVerifyParameters(contractName: string) {
        const parameters = await super.getVerifyParameters(contractName);
        return {...parameters, compilerVersion: `v${parameters.compilerVersion}`};
    }

    // Private

    private static async loadEtherscanSupportedChains(): Promise<ChainConfig[]> {
        await lock.acquire();
        try {
            const resp = await fetch("https://api.etherscan.io/v2/chainlist");
            if (!resp.ok) {
                throw new Error(`Etherscan API error: ${resp.status} ${resp.statusText}`);
            }
            const data = await resp.json();
            return data.result.map(
                (element: {
                    chainid: string,
                    chainname: string,
                    blockexplorer: string,
                    apiurl: string
                }) => ({
                        chainId: parseInt(element.chainid, 10),
                        network: element.chainname,
                        urls: {
                            apiURL: element.apiurl,
                            browserURL: element.blockexplorer
                        }
                    } as ChainConfig)
            );
        } finally {
            lock.release();
        }
    }

    private async processContractVerificationMissingBytecodeError(
        error: ContractVerificationMissingBytecodeError,
        data: VerificationRequestData,
        retries: number) {
            if (retries > ZERO_ATTEMPTS) {
                console.log(chalk.gray(error.message));
                console.log(chalk.gray(`Waiting for ${BLOCKS_TO_WAIT} blocks before retrying...`));
                await EtherscanVerifier.waitForBlocks(BLOCKS_TO_WAIT);
                return this.submitVerificationRequest(data.target, data.params, retries - ONE_ATTEMPT);
            }
            throw error;
    }

    private static waitForBlocks(numBlocks: number): Promise<void> {
        return new Promise((resolve) => {
            ethers.provider.getBlockNumber().then((currentBlockNumber) => {
                const targetBlock = currentBlockNumber + numBlocks;

                const listener = (blockNumber: number) => {
                    if (blockNumber >= targetBlock) {
                        ethers.provider.removeListener("block", listener);
                        resolve();
                    }
                };

                ethers.provider.on("block", listener);
            });
        });
    }
}
