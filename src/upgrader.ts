import hre, {network, upgrades} from "hardhat";
import {AutoSubmitter} from "./submitters/auto-submitter";
import {EXIT_CODES} from "./exitCodes";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v5";
import {ProxyAdmin} from "../typechain-types";
import {Submitter} from "./submitters/submitter";
import {UnsignedTransaction} from "ethers";
import chalk from "chalk";
import {promises as fs} from "fs";
import {getContractFactoryAndUpdateManifest} from "./contractFactory";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";
import {getManifestAdmin} from "@openzeppelin/hardhat-upgrades/dist/admin";
import {getVersion} from "./version";
import {verify} from "./verification";


interface ContractToUpgrade {
    proxyAddress: string,
    implementationAddress: string,
    name: string
}

interface Project {
    name: string;
    instance: Instance;
}

interface Target {
    version: string;
    contractNamesToUpgrade: string[]
}

const withoutNull = <T>(array: Array<T | null>) => array.
    filter((element) => element !== null) as Array<T>;


export abstract class Upgrader {
    instance: Instance;

    targetVersion: string;

    contractNamesToUpgrade: string[];

    projectName: string;

    transactions: UnsignedTransaction[];

    submitter: Submitter;

    constructor (
        project: Project,
        target: Target,
        submitter: Submitter = new AutoSubmitter()
    ) {
        this.targetVersion = target.version;
        if (!target.version.includes("-")) {
            this.targetVersion = `${target.version}-stable.0`;
        }
        this.instance = project.instance;
        this.contractNamesToUpgrade = target.contractNamesToUpgrade;
        this.projectName = project.name;
        this.transactions = [];
        this.submitter = submitter;
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

        this.switchToNewImplementations(
            contractsToUpgrade,
            await getManifestAdmin(hre) as unknown as ProxyAdmin
        );

        await this.callInitialize();

        // Write version
        await this.setVersion(version);

        await this.writeTransactions(version);

        await this.submitter.submit(this.transactions);

        await Upgrader.verify(contractsToUpgrade);

        console.log("Done");
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

    private switchToNewImplementations (
        contractsToUpgrade: ContractToUpgrade[],
        proxyAdmin: ProxyAdmin
    ) {
        for (const contract of contractsToUpgrade) {
            const infoMessage =
                `Prepare transaction to upgrade ${contract.name}` +
                ` at ${contract.proxyAddress}` +
                ` to ${contract.implementationAddress}`;
            console.log(chalk.yellowBright(infoMessage));
            this.transactions.push({
                "data": proxyAdmin.interface.encodeFunctionData(
                    "upgrade",
                    [
                        contract.proxyAddress,
                        contract.implementationAddress
                    ]
                ),
                "to": proxyAdmin.address
            });
        }
    }

    private async deployNewImplementations () {
        const contracts = await Promise.all(this.contractNamesToUpgrade.
            map(this.deployNewImplementation));
        return withoutNull(contracts);
    }

    private async deployNewImplementation (contract: string) {
        const contractFactory =
                await getContractFactoryAndUpdateManifest(contract);
        const proxyAddress =
                (await this.instance.getContract(contract)).address;

        console.log(`Prepare upgrade of ${contract}`);
        const currentImplementationAddress = await getImplementationAddress(
            network.provider,
            proxyAddress
        );
        const newImplementationAddress = await upgrades.prepareUpgrade(
            proxyAddress,
            contractFactory,
            {
                "unsafeAllowLinkedLibraries": true,
                "unsafeAllowRenames": true
            }
        ) as string;
        if (newImplementationAddress !== currentImplementationAddress) {
            return {
                "implementationAddress": newImplementationAddress,
                "name": contract,
                proxyAddress
            };
        }
        console.log(chalk.gray(`Contract ${contract} is up to date`));
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
}
