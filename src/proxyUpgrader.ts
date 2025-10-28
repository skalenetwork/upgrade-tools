import {AddressLike, ContractFactory, Transaction} from "ethers";
import {ethers, network, upgrades} from "hardhat";
import {NonceProvider} from "./nonceProvider";
import chalk from "chalk";
import {getContractFactoryAndUpdateManifest} from "./contractFactory";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";


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

    // Private

    private async prepareUpgrade(contractFactory: ContractFactory) {
        const currentImplementationAddress = await getImplementationAddress(
            network.provider,
            await ethers.resolveAddress(this.proxyAddress)
        );

        const nonce = this.nonceProvider?.reserveNonce();

        const newImplementationAddress = await upgrades.prepareUpgrade(
            await ethers.resolveAddress(this.proxyAddress),
            contractFactory,
            {
                "timeout": deployTimeout,
                "txOverrides": {
                    nonce
                },
                "unsafeAllowLinkedLibraries": true,
                "unsafeAllowRenames": true
            }
        ) as AddressLike;
        if (newImplementationAddress === currentImplementationAddress) {
            console.log(chalk.gray(`Contract ${this.contractName} is up to date`));
        } else {
            this.newImplementationAddress = newImplementationAddress;
        }
        if (nonce) {
            this.nonceProvider?.releaseNonce(nonce);
        }
    }
}
