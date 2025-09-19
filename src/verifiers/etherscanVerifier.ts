// Cspell:words apiurl blockexplorer chainname

import {ContractVerifier, VerificationRequestParameters, VerificationTarget} from '../contractVerifier';
import {ChainConfig} from '@nomicfoundation/hardhat-verify/types';
import {Etherscan} from '@nomicfoundation/hardhat-verify/etherscan';
import Semaphore from 'semaphore-async-await';
import {ValidationResponse} from '@nomicfoundation/hardhat-verify/internal/utilities';


const MAX_CONCURRENCY = 1;
const lock = new Semaphore(MAX_CONCURRENCY);

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

    protected async submitVerificationRequest(target: VerificationTarget, params: VerificationRequestParameters): Promise<ValidationResponse> {
        try {
            await lock.acquire();
            return await this.etherscan.verify(
                target.contractAddress,
                params.solcInputJson,
                params.fullContractName,
                params.compilerVersion,
                ""
            );
        } finally {
            lock.release();
        }
    }

    protected getContractUrl(verificationTarget: VerificationTarget): string {
        return this.etherscan.getContractUrl(verificationTarget.contractAddress);
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
}
