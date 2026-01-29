import {ethers, network} from "hardhat";
import {AbstractTransparentProxyUpgrader} from "./upgraders/abstractTransparentProxyUpgrader";
import {AutoSubmitter} from "./submitters/auto-submitter";
import {EXIT_CODES} from "./exitCodes";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v6";
import {NonceProvider} from "./nonceProvider";
import {Project} from "./types/upgrader";
import {ProxyUpgrader} from "./proxyUpgrader";
import Semaphore from 'semaphore-async-await';
import {Submitter} from "./submitters/submitter";
import {Transaction} from "ethers";
import {TransparentProxyUpgrader} from "./upgraders/transparentProxyUpgrader";
import {V4TransparentProxyUpgrader} from "./upgraders/v4TransparentProxyUpgrader";
import chalk from "chalk";
import {promises as fs} from "fs";
import {getVersion} from "./version";
import {verify} from "./verification";

const withoutNull = <T>(array: Array<T | null>) => array.
    filter((element) => element !== null) as Array<T>;

// TODO: Set to 8 when upgrade plugins become thread safe
const maxSimultaneousDeployments = 1;

export abstract class Upgrader {
    private targetVersion: string;
    private contractNamesToUpgrade: string[];
    private addressForContractsToUpgrade: {[key: string]: string[]};
    private projectName: string;
    private submitter: Submitter;
    private deploySemaphore: Semaphore;
    private proxyUpgraders: ProxyUpgrader[] = [];

    protected nonceProvider?: NonceProvider;
    protected instance: Instance;
    protected transactions: Transaction[];

    constructor (
        project: Project,
        submitter?: Submitter
    ) {
        this.targetVersion = project.version;
        if (!project.version.includes("-")) {
            this.targetVersion = `${project.version}-stable.0`;
        }
        this.instance = project.instance;
        this.contractNamesToUpgrade = project.contractNamesToUpgrade;
        this.addressForContractsToUpgrade = project.addressForContractsToUpgrade ?? {};
        this.projectName = project.name;
        this.transactions = [];
        this.submitter = submitter ?? new AutoSubmitter(this);
        this.deploySemaphore = new Semaphore(maxSimultaneousDeployments);
    }

    // Abstract

    abstract getDeployedVersion: () => Promise<string | undefined>

    abstract setVersion: (newVersion: string) => Promise<void>

    // Protected

    deployNewContracts?: () => Promise<void>;

    initialize?: () => Promise<void>;

    protected async createProxyUpgrader(contractName: string, proxyAddress: string) {
        const proxyAdmin = await AbstractTransparentProxyUpgrader.getProxyAdmin(proxyAddress);
        const proxyAdminVersion = await AbstractTransparentProxyUpgrader.getProxyAdminVersion(proxyAdmin);
        const defaultProxyAdminVersion = "5.0.0";
        if (proxyAdminVersion === defaultProxyAdminVersion) {
            console.log(chalk.gray(`${contractName} uses ProxyAdmin version ${proxyAdminVersion}`));
            return new TransparentProxyUpgrader({
                contractName,
                nonceProvider: this.nonceProvider,
                proxyAddress,
                proxyAdmin
            }) as ProxyUpgrader;
        } else if (proxyAdminVersion === null) {
            console.log(chalk.gray(`${contractName} uses old ProxyAdmin (v4 or lower)`));
            return new V4TransparentProxyUpgrader({
                contractName,
                nonceProvider: this.nonceProvider,
                proxyAddress,
                proxyAdmin
            }) as ProxyUpgrader;
        }
        throw new Error(
            `Unsupported ProxyAdmin version: ${proxyAdminVersion}`
        );
    }

    // Public

    async upgrade () {
        const version = await this.prepareVersion();
        await this.callDeployNewContracts();
        await this.upgradeOldContracts();
        await this.callInitialize();
        // Write version
        await this.setVersion(version);
        await this.writeTransactions(version);
        await this.verifySubmitter();
        await this.submitter.submit(this.transactions);
        await this.verify();
        console.log("Done");
    }

    async getOwner() {
        const owners = await Promise.all(
            this.proxyUpgraders.map(
                (upgrader) => upgrader.getOwner()
            )
        );
        return owners.reduce( (owner1, owner2) => {
            if (owner1 !== owner2) {
                throw Error("Proxies have different owners");
            }
            return owner1;
        })
    }

    private async upgradeOldContracts () {
        await this.createProxyUpgraders();
        await this.deployNewImplementations();
        await this.switchToNewImplementations();
    }

    // Private

    private getChangedContracts () {
        return this.proxyUpgraders.filter(
            (upgrader) => upgrader.needsUpgrade()
        );
    }

    private async createProxyUpgraders() {
        const [deployer] = await ethers.getSigners();
        this.nonceProvider ??= await NonceProvider.createForWallet(deployer);
        this.verifyInputParams();
        await Promise.all(
            this.contractNamesToUpgrade.map(async (contractName) => {
                if (!this.addressForContractsToUpgrade[contractName]) {
                    this.addressForContractsToUpgrade[contractName] = [await this.instance.getContractAddress(contractName)];
                }
            })
        );
        const upgraders: Promise<ProxyUpgrader>[] = [];
        Object.keys(this.addressForContractsToUpgrade).forEach((contractName) => {
            this.addressForContractsToUpgrade[contractName].forEach((address) => {
                upgraders.push(this.createProxyUpgrader(contractName, address));
            });
        });
        this.proxyUpgraders = await Promise.all(upgraders);
    }

    private async callInitialize () {
        if (typeof this.initialize === "undefined") {
            console.log(chalk.gray("No initialize function defined, skipping"));
        } else {
            console.log("Generating initialize transaction(s)");
            await this.initialize();
        }
    }

    private async callDeployNewContracts () {
        if (typeof this.deployNewContracts !== "undefined") {
            // Deploy new contracts
            await this.deployNewContracts();
        }
    }

    private async prepareVersion () {
        const version = await getVersion();
        await this.checkVersion(version);
        console.log(`Will mark updated version as ${version}`);
        return version;
    }

    private async writeTransactions (version: string) {
        const indentation = 4;
        await fs.writeFile(
            `data/transactions-${version}-${network.name}.json`,
            JSON.stringify(
                this.transactions,
                null,
                indentation
            )
        );
    }

    private async verify () {
        if (process.env.NO_VERIFY) {
            console.log("Skip verification");
        } else {
            console.log("Start verification");
            // Try all, don't fail if one fails
            await Promise.allSettled(
                this.getChangedContracts().map(
                    (upgrader) => verify(
                        upgrader.getContractName(),
                        upgrader.getNewImplementationAddress()
                    )
                )
            );
        }
    }

    private async switchToNewImplementations () {
        this.transactions = [
            ...this.transactions,
            ...await Promise.all(
                this.getChangedContracts().map(
                    (upgrader) => upgrader.getUpgradeTransaction(),
                )
            )
        ];
    }

    private async deployNewImplementations () {
        const contracts = await Promise.all(this.proxyUpgraders.
            map(
                (upgrader) => this.protectedDeployNewImplementation(upgrader),
                this
            ));
        return withoutNull(contracts);
    }

    private async protectedDeployNewImplementation (upgrader: ProxyUpgrader) {
        await this.deploySemaphore.acquire();
        try {
            await upgrader.deployNewImplementation();
        } finally {
            this.deploySemaphore.release();
        }
    }

    private async getNormalizedDeployedVersion () {
        const deployedVersion = await this.getDeployedVersion();
        if (deployedVersion) {
            if (!deployedVersion.includes("-")) {
                return `${deployedVersion}-stable.0`;
            }
            return deployedVersion;
        }
        return deployedVersion;
    }

    private async checkVersion (version: string) {
        const deployedVersion = await this.getNormalizedDeployedVersion();
        if (deployedVersion) {
            if (deployedVersion !== this.targetVersion) {
                const cannotUpgradeMessage =
                    `This script can't upgrade version ${deployedVersion}` +
                    ` to ${version}`;
                console.log(chalk.red(cannotUpgradeMessage));
                process.exit(EXIT_CODES.BAD_VERSION);
            }
        } else {
            const cannotCheckMessage =
                `Can't check currently deployed version of ${this.projectName}`;
            console.log(chalk.yellow(cannotCheckMessage));
        }
    }

    private async verifySubmitter () {
        const maxTransactionsForAtomicUpgrade = 1;
        if (
            this.transactions.length <= maxTransactionsForAtomicUpgrade ||
            await this.submitter.isAtomicSubmitter()
        ) {
            console.log(chalk.yellow("Atomic upgrade is performing."));
            return;
        }

        if (process.env.ALLOW_NOT_ATOMIC_UPGRADE) {
            console.log(chalk.yellow("Not atomic upgrade is performing."));
            return;
        }
        console.log(chalk.red("The upgrade will consist" +
            " of multiple transactions and will not be atomic"));
        console.log(chalk.red("If not atomic upgrade is OK" +
            " set ALLOW_NOT_ATOMIC_UPGRADE environment variable"));
        process.exit(EXIT_CODES.NOT_ATOMIC_UPGRADE);
    }

    private verifyInputParams() {
        for (const item of Object.keys(this.addressForContractsToUpgrade)) {
            if (!this.contractNamesToUpgrade.includes(item)) {
                throw new Error(
                    `Input params provided for unknown contract: ${item}`
                );
            }
        }
    }
}
