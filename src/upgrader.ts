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
import chalk from "chalk";
import {promises as fs} from "fs";
import {getVersion} from "./version";
import {verify} from "./verification";


const withoutNull = <T>(array: Array<T | null>) => array.
    filter((element) => element !== null) as Array<T>;

// TODO: Set to 8 when upgrade plugins become thread safe
const maxSimultaneousDeployments = 1;
//                    10 minutes
export const deployTimeout = 60e4;


export abstract class Upgrader {
    private targetVersion: string;
    private contractNamesToUpgrade: string[];
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

    protected async createProxyUpgrader(contractName: string) {
        const proxyAddress = await this.instance.getContractAddress(contractName);
        const proxyUpgrader = await AbstractTransparentProxyUpgrader.create(
            contractName,
            proxyAddress,
            this.nonceProvider
        );
        return proxyUpgrader as ProxyUpgrader;
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
        this.proxyUpgraders = await Promise.all(
            this.contractNamesToUpgrade.map(
                this.createProxyUpgrader,
                this
            )
        );
    }

    private async callInitialize () {
        if (typeof this.initialize !== "undefined") {
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
            await Promise.all(
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
                this.proxyUpgraders.map(
                    (upgrader) => upgrader.getUpgradeTransaction(),
                )
            )
        ];
    }

    private async deployNewImplementations () {
        const [deployer] = await ethers.getSigners();
        this.nonceProvider ??= await NonceProvider.createForWallet(deployer);
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
}
