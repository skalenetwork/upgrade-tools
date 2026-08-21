import {AddressLike, ContractFactory, Transaction, isAddress} from "ethers";
import {ethers, upgrades} from "hardhat";
import {DeployImplementationResponse} from "@openzeppelin/hardhat-upgrades/dist/deploy-implementation";
import {NonceProvider} from "./nonceProvider";
import chalk from "chalk";
import {getContractFactoryAndUpdateManifest} from "./contractFactory";


//                    10 minutes
const deployTimeout = 60e4;

export abstract class ProxyUpgrader {
    protected proxyAddress: AddressLike;
    protected newImplementationAddress: AddressLike | null = null;
    private contractName: string;
    private nonceProvider?: NonceProvider;

    constructor (
        contractName: string,
        proxyAddress: AddressLike,
        nonceProvider?: NonceProvider
    ) {
        this.contractName = contractName;
        this.proxyAddress = proxyAddress;
        this.nonceProvider = nonceProvider;
    }

    // Public

    public async deployNewImplementation() {
        const contractFactory = await getContractFactoryAndUpdateManifest(
            this.contractName,
            this.nonceProvider
        );
        console.log(`Prepare upgrade of ${this.contractName}`);
        return this.prepareUpgrade(contractFactory);
    }

    public needsUpgrade(): boolean {
        return this.newImplementationAddress !== null;
    }

    public async getUpgradeTransaction(): Promise<Transaction> {
        if (this.newImplementationAddress === null) {
            throw new Error(
                `Upgrade of ${this.contractName} is not prepared or not needed`
            );
        }
        const infoMessage =
            `Prepare transaction to upgrade ${this.contractName}` +
            ` at ${this.proxyAddress}` +
            ` to ${this.newImplementationAddress}`;
        console.log(chalk.yellowBright(infoMessage));
        return await this.makeUpgradeTransaction();
    }

    public getContractName(): string {
        return this.contractName;
    }

    public getNewImplementationAddress(): AddressLike {
        if (this.newImplementationAddress === null) {
            throw new Error(
                `There is no new implementation address for ${this.contractName}`
            );
        }
        return this.newImplementationAddress;
    }

    public abstract getOwner(): Promise<string>;

    // Protected

    protected abstract makeUpgradeTransaction(): Promise<Transaction>;
    protected abstract getCurrentImplementationAddress(): Promise<AddressLike>;

    // Private

    private async prepareUpgrade(contractFactory: ContractFactory) {
        const currentImplementationAddress = await this.getCurrentImplementationAddress();

        const nonce = this.nonceProvider?.reserveNonce();

        const response = await upgrades.prepareUpgrade(
            await ethers.resolveAddress(this.proxyAddress),
            contractFactory,
            {
                "getTxResponse": true,
                "timeout": deployTimeout,
                "txOverrides": {
                    nonce
                },
                "unsafeAllowLinkedLibraries": true,
                "unsafeAllowRenames": true
            }
        );
        // Resolves the deployment, getting the address and releasing nonce if needed
        const newImplementationAddress = await this.resolveDeployment(response, nonce);

        if (newImplementationAddress === currentImplementationAddress) {
            console.log(chalk.gray(`Contract ${this.contractName} is up to date`));
        } else {
            this.newImplementationAddress = newImplementationAddress;
        }
    }

    private async resolveDeployment(response: DeployImplementationResponse, nonce?: number): Promise<string> {
        if (typeof nonce !== "undefined" && (isAddress(response) || response.nonce < nonce)) {
            this.nonceProvider?.releaseNonce(nonce);
        }

        if (isAddress(response)) {
            return response;
        }

        const receipt = await response.wait();
        if(!receipt) {
            throw new Error(`Failed to get receipt for deployment transaction`);
        }
        if (!receipt.contractAddress) {
            throw new Error(`Failed to get contract address from deployment receipt`);
        }
        return receipt.contractAddress;
    }
}
