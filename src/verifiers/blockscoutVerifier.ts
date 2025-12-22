// Cspell:words holesky hoodi

import {ContractVerifier, VerificationRequestParameters, VerificationTarget} from "../contractVerifier";
import {Blockscout} from '@nomicfoundation/hardhat-verify/blockscout';
import {ChainConfig} from "@nomicfoundation/hardhat-verify/types";
import {ValidationResponse} from "@nomicfoundation/hardhat-verify/internal/utilities";

const BLOCKSCOUT_CHAINS: ChainConfig[] = [
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
    },
    {
        chainId: 8453,
        network: "base",
        urls: {
            apiURL: "https://base.blockscout.com/api",
            browserURL: "https://base.blockscout.com",
        }
    },
    {
        chainId: 84532,
        network: "base-sepolia",
        urls: {
            apiURL: "https://base-sepolia.blockscout.com/api",
            browserURL: "https://base-sepolia.blockscout.com",
        }
    },

]

export class BlockscoutVerifier extends ContractVerifier {
    public name = "Blockscout";
    private readonly blockscout: Blockscout;

    constructor(apiURL: string, browserURL: string) {
        super();
        this.blockscout = new Blockscout(apiURL, browserURL);
    }

    public static createFromChainId(chainId: bigint): BlockscoutVerifier | null {
        const config = BLOCKSCOUT_CHAINS.find(chain => chain.chainId === Number(chainId));
        if (config) {
            return new BlockscoutVerifier(config.urls.apiURL, config.urls.browserURL);
        }
        return null;
    }

    protected async isAlreadyVerified(verificationTarget: VerificationTarget): Promise<boolean> {
        return await this.blockscout.isVerified(verificationTarget.contractAddress);
    }

    protected async submitVerificationRequest(target: VerificationTarget, params: VerificationRequestParameters): Promise<ValidationResponse> {
        if (target.constructorArguments) {
            // TODO: remove this exception when Blockscout supports constructor arguments
            throw new Error("Constructor arguments are not supported for Blockscout verification.");
        }
        return await this.blockscout.verify(
            target.contractAddress,
            params.solcInputJson,
            params.fullContractName,
            params.compilerVersion
        );
    }

    protected getContractUrl(verificationTarget: VerificationTarget): string {
        return this.blockscout.getContractUrl(verificationTarget.contractAddress);
    }
}
