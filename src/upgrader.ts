import hre from "hardhat";
import chalk from "chalk";
import {ProxyAdmin} from "../typechain-types";
import {network, upgrades} from "hardhat";
import {getManifestAdmin} from "@openzeppelin/hardhat-upgrades/dist/admin";
import {getVersion} from "./version";
import {promises as fs} from "fs";
import {UnsignedTransaction} from "ethers";
import {getImplementationAddress} from "@openzeppelin/upgrades-core";
import {verify} from "./verification";
import {Submitter} from "./submitters/submitter";
import {AutoSubmitter} from "./submitters/auto-submitter";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v5";
import {getContractFactoryAndUpdateManifest} from "./contractFactory";


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
        if (this.initialize !== undefined) {
            await this.initialize();
        }
    }

    private async callDeployNewContracts () {
        if (this.deployNewContracts !== undefined) {
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
        await fs.writeFile(
            `data/transactions-${version}-${network.name}.json`,
            JSON.stringify(
                this.transactions,
                null,
                4
            )
        );
    }

    private static async verify (contractsToUpgrade: ContractToUpgrade[]) {
        if (process.env.NO_VERIFY) {
            console.log("Skip verification");
        } else {
            console.log("Start verification");
            for (const contract of contractsToUpgrade) {
                await verify(
                    contract.name,
                    contract.implementationAddress,
                    []
                );
            }
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
                "to": proxyAdmin.address,
                "data": proxyAdmin.interface.encodeFunctionData(
                    "upgrade",
                    [
                        contract.proxyAddress,
                        contract.implementationAddress
                    ]
                )
            });
        }
    }

    private async deployNewImplementations () {
        const contractsToUpgrade: ContractToUpgrade[] = [];
        for (const contract of this.contractNamesToUpgrade) {
            const updatedContract =
                await this.deployNewImplementation(contract);
            if (updatedContract !== undefined) {
                contractsToUpgrade.push(updatedContract);
            }
        }
        return contractsToUpgrade;
    }

    private async deployNewImplementation (contract: string) {
        const contractFactory =
                await getContractFactoryAndUpdateManifest(contract);
        const proxyAddress =
                (await this.instance.getContract(contract)).address;

        console.log(`Prepare upgrade of ${contract}`);
        const
            currentImplementationAddress = await getImplementationAddress(
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
                proxyAddress,
                "implementationAddress": newImplementationAddress,
                "name": contract
            };
        }
        console.log(chalk.gray(`Contract ${contract} is up to date`));
        return undefined;
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
                process.exit(1);
            }
        } else {
            const cannotCheckMessage =
                `Can't check currently deployed version of ${this.projectName}`;
            console.log(chalk.yellow(cannotCheckMessage));
        }
    }
}
