import {ValidationResponse} from "@nomicfoundation/hardhat-verify/internal/utilities";
import {artifacts} from "hardhat";
import chalk from "chalk";
import proxyArtifact from
"@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/transparent/TransparentUpgradeableProxy.sol/TransparentUpgradeableProxy.json";
import proxyBuildInfo from "@openzeppelin/upgrades-core/artifacts/build-info-v5.json";

const DEFAULT_RETRIES_AMOUNT = 5;

export interface VerificationTarget {
    contractName: string;
    contractAddress: string;
}

export interface VerificationRequestParameters {
    solcInputJson: string;
    fullContractName: string;
    compilerVersion: string;
}

export abstract class ContractVerifier {
    public abstract name: string;
    private readonly PROXY_CONTRACT_NAME = "TransparentUpgradeableProxy";

    public verify = async (
        verificationTarget: VerificationTarget,
        attempts: number = DEFAULT_RETRIES_AMOUNT
    ) => {
        const limit = 0;
        if (attempts > limit) {
            if (!await this.attemptVerification(verificationTarget)) {
                const failedAttempts = 1;
                await this.verify(verificationTarget,
                    attempts - failedAttempts
                );
            }
        }
    };

    public async attemptVerification(verificationTarget: VerificationTarget): Promise<boolean> {
        if (await this.isAlreadyVerified(verificationTarget)) {
            console.log(
                chalk.cyan(
                    `${verificationTarget.contractName} is already verified on ${this.name}:\n${this.getContractUrl(
                        verificationTarget
                    )}`
                )
            );
            return true;
        }

        const params = await this.getVerifyParameters(verificationTarget.contractName);
        try {
            const response = await this.submitVerificationRequest(verificationTarget, params);
            return this.checkVerificationStatus(verificationTarget, response);
        } catch (error) {
            console.log(
                chalk.yellow(
                    `Verification attempt for ${
                        verificationTarget.contractName
                    } failed on ${
                        this.name
                    } with error: ${
                        error
                    }`
                )
            );
            return false;
        }
    }

    // Protected

    protected abstract isAlreadyVerified(verificationTarget: VerificationTarget): Promise<boolean>;
    protected abstract submitVerificationRequest(target: VerificationTarget, params: VerificationRequestParameters): Promise<ValidationResponse>;
    protected abstract getContractUrl(verificationTarget: VerificationTarget): string;

    protected async getVerifyParameters(contractName: string) {
        if (contractName === this.PROXY_CONTRACT_NAME) {
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

    // Private

    private checkVerificationStatus(verificationTarget: VerificationTarget,response: ValidationResponse): boolean {
        if (response.isFailure() as unknown as boolean) {
            console.log(
                chalk.red(`Failed to verify contract ${verificationTarget.contractName}`)
            );
            return false;
        }
        console.log(
            chalk.cyan(
                `${verificationTarget.contractName} is successfully verified on ${this.name}:\n${this.getContractUrl(
                    verificationTarget
                )}`
            )
        );
        return true;
    }
}
