import {ContractFactory, Transaction} from "ethers";
import {ContractToUpgrade, Project} from "./types/upgrader";
import {Manifest, getImplementationAddress} from "@openzeppelin/upgrades-core";
import {ethers, network, upgrades} from "hardhat";
import {AutoSubmitter} from "./submitters/auto-submitter";
import {EXIT_CODES} from "./exitCodes";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v6";
import {NonceProvider} from "./nonceProvider";
import {ProxyAdmin} from "../typechain-types";
import Semaphore from 'semaphore-async-await';
import {Submitter} from "./submitters/submitter";
import chalk from "chalk";
import {promises as fs} from "fs";
import {getContractFactoryAndUpdateManifest} from "./contractFactory";
import {getVersion} from "./version";
import {verify} from "./verification";


const withoutNull = <T>(array: Array<T | null>) => array.
    filter((element) => element !== null) as Array<T>;

// TODO: Set to 8 when upgrade plugins become thread safe
const maxSimultaneousDeployments = 1;
//                    10 minutes
const deployTimeout = 60e4;


export abstract class Upgrader {
    instance: Instance;
    targetVersion: string;
    contractNamesToUpgrade: string[];
    projectName: string;
    transactions: Transaction[];
    submitter: Submitter;
    nonceProvider?: NonceProvider;
    deploySemaphore: Semaphore;

    constructor (
        project: Project,
        submitter: Submitter = new AutoSubmitter()
    ) {
        this.targetVersion = project.version;
        if (!project.version.includes("-")) {
            this.targetVersion = `${project.version}-stable.0`;
        }
        this.instance = project.instance;
        this.contractNamesToUpgrade = project.contractNamesToUpgrade;
        this.projectName = project.name;
        this.transactions = [];
        this.submitter = submitter;
        this.deploySemaphore = new Semaphore(maxSimultaneousDeployments);
    }

    // Abstract

    abstract getDeployedVersion: () => Promise<string | undefined>

    abstract setVersion: (newVersion: string) => Promise<void>

    // Protected

    deployNewContracts?: () => Promise<void>;

    initialize?: () => Promise<void>;

    // Public

    async upgrade () {
        const version = await this.prepareVersion();
        await this.callDeployNewContracts();
        const contractsToUpgrade = await this.deployNewImplementations();
        await this.switchToNewImplementations(
            contractsToUpgrade,
            await Upgrader.getProxyAdmin()
        );
        await this.callInitialize();
        // Write version
        await this.setVersion(version);
        await this.writeTransactions(version);
        await this.submitter.submit(this.transactions);
        await Upgrader.verify(contractsToUpgrade);
        console.log("Done");
    }

    static async getProxyAdmin() {
        const manifest = await Manifest.forNetwork(network.provider);
        const adminDeployment = await manifest.getAdmin();
        if (!adminDeployment) {
            throw new Error("Can't load ProxyAdmin address");
        }
        const factory = await ethers.getContractFactory("ProxyAdmin");
        return factory.attach(adminDeployment.address) as ProxyAdmin;
    }

    // Private

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

    private static async verify (contractsToUpgrade: ContractToUpgrade[]) {
        if (process.env.NO_VERIFY) {
            console.log("Skip verification");
        } else {
            console.log("Start verification");
            await Promise.all(contractsToUpgrade.map((contract) => verify(
                contract.name,
                contract.implementationAddress,
                []
            )));
        }
    }

    private async switchToNewImplementations (
        contractsToUpgrade: ContractToUpgrade[],
        proxyAdmin: ProxyAdmin
    ) {
        const proxyAdminAddress = await proxyAdmin.getAddress();
        const newProxyAdmin = await Upgrader.isNewProxyAdmin(proxyAdminAddress);
        for (const contract of contractsToUpgrade) {
            const infoMessage =
                `Prepare transaction to upgrade ${contract.name}` +
                ` at ${contract.proxyAddress}` +
                ` to ${contract.implementationAddress}`;
            console.log(chalk.yellowBright(infoMessage));
            let transaction = Transaction.from({
                    "data": proxyAdmin.interface.encodeFunctionData(
                        "upgradeAndCall",
                        [
                            contract.proxyAddress,
                            contract.implementationAddress,
                            "0x"
                        ]
                    ),
                    "to": proxyAdminAddress
                });
            if (!newProxyAdmin) {
                transaction = Transaction.from({
                    "data": proxyAdmin.interface.encodeFunctionData(
                        "upgrade",
                        [
                            contract.proxyAddress,
                            contract.implementationAddress
                        ]
                    ),
                    "to": proxyAdminAddress
                });
            }
            this.transactions.push(transaction);
        }
    }

    private async deployNewImplementations () {
        const [deployer] = await ethers.getSigners();
        this.nonceProvider ??= await NonceProvider.createForWallet(deployer);
        const contracts = await Promise.all(this.contractNamesToUpgrade.
            map(
                this.protectedDeployNewImplementation,
                this
            ));
        return withoutNull(contracts);
    }

    private async protectedDeployNewImplementation (contract: string) {
        await this.deploySemaphore.acquire();
        let result: ContractToUpgrade | null = null;
        try {
            result = await this.deployNewImplementation(contract);
        } finally {
            this.deploySemaphore.release();
        }
        return result;
    }

    private async deployNewImplementation (contract: string) {
        const contractFactory = await getContractFactoryAndUpdateManifest(
            contract,
            this.nonceProvider
        );
        const proxyAddress = await
                (await this.instance.getContract(contract)).getAddress();
        console.log(`Prepare upgrade of ${contract}`);
        return this.prepareUpgrade(contract, proxyAddress, contractFactory);
    }

    private async prepareUpgrade(contractName: string, proxyAddress: string, contractFactory: ContractFactory) {
        const currentImplementationAddress = await getImplementationAddress(
            network.provider,
            proxyAddress
        );

        const nonce = this.nonceProvider?.reserveNonce();

        const newImplementationAddress = await upgrades.prepareUpgrade(
            proxyAddress,
            contractFactory,
            {
                "timeout": deployTimeout,
                "txOverrides": {
                    nonce
                },
                "unsafeAllowLinkedLibraries": true,
                "unsafeAllowRenames": true
            }
        ) as string;
        if (newImplementationAddress !== currentImplementationAddress) {
            return {
                "implementationAddress": newImplementationAddress,
                "name": contractName,
                proxyAddress
            };
        }
        console.log(chalk.gray(`Contract ${contractName} is up to date`));
        if (nonce) {
            this.nonceProvider?.releaseNonce(nonce);
        }
        return null;
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

    private static async isNewProxyAdmin(proxyAdminAddress: string) {
        const proxyAdminVersionAbi = [
            "function UPGRADE_INTERFACE_VERSION() view returns (string)",
        ];
        const proxyAdminContract = new ethers.Contract(
            proxyAdminAddress,
            proxyAdminVersionAbi,
            await ethers.provider.getSigner()
        );
        try {
            console.log(chalk.gray(`ProxyAdmin version ${
                // This function name is set in external library
                // eslint-disable-next-line new-cap
                await proxyAdminContract.UPGRADE_INTERFACE_VERSION()
            }`));
            return true;
        } catch (error) {
            console.log(chalk.gray("Use old ProxyAdmin"));
            return false;
        }
    }
}
