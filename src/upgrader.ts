import hre from "hardhat";
import chalk from "chalk";
import {ProxyAdmin} from "../typechain-types";
import {artifacts, ethers, network, upgrades} from "hardhat";
import {getManifestAdmin} from "@openzeppelin/hardhat-upgrades/dist/admin";
import {getVersion} from "./version";
import {promises as fs} from "fs";
import {
    deployLibraries,
    getLinkedContractFactory,
    getManifestFile
} from "./deploy";
import {UnsignedTransaction} from "ethers";
import {
    getImplementationAddress,
    hashBytecode
} from "@openzeppelin/upgrades-core";
import {verify} from "./verification";
import {Submitter} from "./submitters/submitter";
import {SkaleManifestData} from "./types/SkaleManifestData";
import {AutoSubmitter} from "./submitters/auto-submitter";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v5";
import {LinkReferences} from "hardhat/types";
import {ContractToUpgrade} from "./types/ContractToUpgrade";


export abstract class Upgrader {
    instance: Instance;

    targetVersion: string;

    contractNamesToUpgrade: string[];

    projectName: string;

    transactions: UnsignedTransaction[];

    submitter: Submitter;

    constructor (
        projectName: string,
        targetVersion: string,
        instance: Instance,
        contractNamesToUpgrade: string[],
        submitter: Submitter = new AutoSubmitter()
    ) {
        this.targetVersion = targetVersion;
        if (!targetVersion.includes("-")) {
            this.targetVersion = `${targetVersion}-stable.0`;
        }
        this.instance = instance;
        this.contractNamesToUpgrade = contractNamesToUpgrade;
        this.projectName = projectName;
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
        const proxyAdmin = await getManifestAdmin(hre) as unknown as ProxyAdmin;

        const version = await getVersion();
        await this.checkVersion(version);
        console.log(`Will mark updated version as ${version}`);

        if (this.deployNewContracts !== undefined) {
            // Deploy new contracts
            await this.deployNewContracts();
        }

        const contractsToUpgrade = await this.deployNewImplementations();

        this.switchToNewImplementations(
            contractsToUpgrade,
            proxyAdmin
        );

        if (this.initialize !== undefined) {
            await this.initialize();
        }

        // Write version
        await this.setVersion(version);

        await fs.writeFile(
            `data/transactions-${version}-${network.name}.json`,
            JSON.stringify(
                this.transactions,
                null,
                4
            )
        );

        await this.submitter.submit(this.transactions);

        await Upgrader.verify(contractsToUpgrade);

        console.log("Done");
    }

    // Private

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
            const contractFactory =
                await Upgrader.getContractFactoryAndUpdateManifest(contract);
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
                contractsToUpgrade.push({
                    proxyAddress,
                    "implementationAddress": newImplementationAddress,
                    "name": contract
                });
            } else {
                console.log(chalk.gray(`Contract ${contract} is up to date`));
            }
        }
        return contractsToUpgrade;
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

    private static async getContractFactoryAndUpdateManifest (contract:
        string) {
        const {linkReferences} = await artifacts.readArtifact(contract);
        const manifest = JSON.parse(await fs.readFile(
            await getManifestFile(),
            "utf-8"
        )) as SkaleManifestData;
        if (manifest.libraries === undefined) {
            manifest.libraries = {};
        }

        if (!Object.keys(linkReferences).length) {
            return await ethers.getContractFactory(contract);
        }

        const {
            librariesToUpgrade,
            oldLibraries
        } = await Upgrader.getLibrariesToUpgrade(
            manifest,
            linkReferences
        );
        const libraries = await deployLibraries(librariesToUpgrade);
        for (const [
            libraryName,
            libraryAddress
        ] of libraries.entries()) {
            const {bytecode} = await artifacts.readArtifact(libraryName);
            manifest.libraries[libraryName] = {
                "address": libraryAddress,
                "bytecodeHash": hashBytecode(bytecode)
            };
        }
        Object.assign(
            libraries,
            oldLibraries
        );
        await fs.writeFile(
            await getManifestFile(),
            JSON.stringify(
                manifest,
                null,
                4
            )
        );
        return await getLinkedContractFactory(
            contract,
            libraries
        );
    }

    private static async getLibrariesToUpgrade (
        manifest: SkaleManifestData,
        linkReferences: LinkReferences
    ) {
        const librariesToUpgrade = [];
        const oldLibraries: {[k: string]: string} = {};
        if (manifest.libraries === undefined) {
            manifest.libraries = {};
        }
        for (const key of Object.keys(linkReferences)) {
            const libraryName = Object.keys(linkReferences[key])[0];
            const {bytecode} = await artifacts.readArtifact(libraryName);
            if (manifest.libraries[libraryName] === undefined) {
                librariesToUpgrade.push(libraryName);
                continue;
            }
            const libraryBytecodeHash =
                manifest.libraries[libraryName].bytecodeHash;
            if (hashBytecode(bytecode) !== libraryBytecodeHash) {
                librariesToUpgrade.push(libraryName);
            } else {
                oldLibraries[libraryName] =
                    manifest.libraries[libraryName].address;
            }
        }
        return {
            librariesToUpgrade,
            oldLibraries
        };
    }
}
