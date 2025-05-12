import {
    VerificationTarget,
    getVerifyParameters,
    isVerifiedOnBlockscout
} from "./verification";
import {Etherscan} from "@nomicfoundation/hardhat-verify/etherscan";
import chalk from "chalk";

export class ContractVerifier {
    private readonly contractName: string;
    private readonly contractAddress: string;
    private readonly apiURL: string;
    private readonly browserURL: string;
    private readonly isEtherscan: boolean;
    private readonly etherscan: Etherscan;

    constructor(target: VerificationTarget) {
        this.contractName = target.contractName;
        this.contractAddress = target.contractAddress;
        this.apiURL = target.explorerUrls.apiURL;
        this.browserURL = target.explorerUrls.browserURL;
        this.isEtherscan = Boolean(target.isEtherscan);
        this.etherscan = new Etherscan(
            process.env.ETHERSCAN ?? "",
            this.apiURL,
            this.browserURL
        );
    }

    private async isAlreadyVerified(): Promise<boolean> {
        let verified = false;

        if (this.isEtherscan) {
            verified = await this.etherscan.isVerified(this.contractAddress);
        }
        if (!verified) {
            verified = await isVerifiedOnBlockscout(
                this.apiURL,
                this.contractAddress
            );
        }
        if (verified) {
            console.log(
                `${this.contractName} is already verified on: ${this.etherscan.getContractUrl(
                    this.contractAddress
                )}`
            );
        }
        return verified;
    }

    private async submitVerification(params: {
        solcInputJson: string;
        fullContractName: string;
        compilerVersion: string;
    }): Promise<string | null> {
        try {
            const res = await this.etherscan.verify(
                this.contractAddress,
                params.solcInputJson,
                params.fullContractName,
                params.compilerVersion,
                "0x"
            );
            return res.message;
        } catch (error) {
            console.log(
                chalk.yellow(
                    `Verification attempt for ${this.contractName} failed with error: ${error}`
                )
            );
            return null;
        }
    }

    private async checkVerificationStatus(guid: string): Promise<boolean> {
        const status = await this.etherscan.getVerificationStatus(guid);

        if (status.isFailure()) {
            console.log(
                chalk.red(`Failed to verify contract ${this.contractName}`)
            );
            return false;
        }

        console.log(
            `${this.contractName} is successfully verified on: ${this.etherscan.getContractUrl(
                this.contractAddress
            )}`
        );
        return true;
    }

    public async attempt(): Promise<boolean> {
        if (await this.isAlreadyVerified()) {
            return true;
        }

        const params = await getVerifyParameters(this.contractName);
        const guid = await this.submitVerification(params);
        if (!guid) {
            return false;
        }

        return this.checkVerificationStatus(guid);
    }
}
