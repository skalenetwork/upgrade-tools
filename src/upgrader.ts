import hre from "hardhat";
import chalk from "chalk";
import { ProxyAdmin } from "../typechain-types";
import { artifacts, ethers, network, upgrades } from "hardhat";
import { getManifestAdmin } from "@openzeppelin/hardhat-upgrades/dist/admin";
import { getVersion } from "./version";
import { promises as fs } from "fs";
import { deployLibraries, getLinkedContractFactory, getManifestFile } from "./deploy";
import { UnsignedTransaction } from "ethers";
import { getImplementationAddress, hashBytecode } from "@openzeppelin/upgrades-core";
import { verify } from "./verification";
import { Submitter } from "./submitters/submitter";
import { SkaleManifestData } from "./types/SkaleManifestData";
import { AutoSubmitter } from "./submitters/auto-submitter";
import { Instance } from "@skalenetwork/skale-contracts/lib/instance";

export abstract class Upgrader {
    instance: Instance;
    targetVersion: string;
    contractNamesToUpgrade: string[];
    projectName: string;
    transactions: UnsignedTransaction[];
    submitter: Submitter;

    constructor(projectName: string,
                targetVersion: string,
                instance: Instance,
                contractNamesToUpgrade: string[],
                submitter: Submitter = new AutoSubmitter()) {
        this.targetVersion = targetVersion;
        if (!targetVersion.includes('-')) {
            this.targetVersion = targetVersion + '-stable.0';
        }
        this.instance = instance;
        this.contractNamesToUpgrade = contractNamesToUpgrade;
        this.projectName = projectName;
        this.transactions = [];
        this.submitter = submitter;
    }

    // abstract

    abstract getDeployedVersion: () => Promise<string | undefined>
    abstract setVersion: (newVersion: string) => Promise<void>

    // protected

    deployNewContracts = () => { return Promise.resolve() };
    initialize = () => { return Promise.resolve() };

    // public

    async upgrade() {
        const proxyAdmin = await getManifestAdmin(hre) as unknown as ProxyAdmin;

        let deployedVersion = await this.getDeployedVersion();
        const version = await getVersion();
        if (deployedVersion) {
            if (!deployedVersion.includes('-')) {
                deployedVersion = deployedVersion + '-stable.0';
            }
            if (deployedVersion !== this.targetVersion) {
                console.log(chalk.red(`This script can't upgrade version ${deployedVersion} to ${version}`));
                process.exit(1);
            }
        } else {
            console.log(chalk.yellow(`Can't check currently deployed version of ${this.projectName}`));
        }
        console.log(`Will mark updated version as ${version}`);

        // Deploy new contracts
        await this.deployNewContracts();

        // Deploy new implementations
        const contractsToUpgrade: {proxyAddress: string, implementationAddress: string, name: string}[] = [];
        for (const contract of this.contractNamesToUpgrade) {
            const contractFactory = await this._getContractFactoryAndUpdateManifest(contract);
            const proxyAddress = (await this.instance.getContract(contract)).address;

            console.log(`Prepare upgrade of ${contract}`);
            const newImplementationAddress = await upgrades.prepareUpgrade(
                proxyAddress,
                contractFactory,
                {
                    unsafeAllowLinkedLibraries: true,
                    unsafeAllowRenames: true
                }
            ) as string;
            const currentImplementationAddress = await getImplementationAddress(network.provider, proxyAddress);
            if (newImplementationAddress !== currentImplementationAddress)
            {
                contractsToUpgrade.push({
                    proxyAddress,
                    implementationAddress: newImplementationAddress,
                    name: contract
                });
                await verify(contract, newImplementationAddress, []);
            } else {
                console.log(chalk.gray(`Contract ${contract} is up to date`));
            }
        }

        // Switch proxies to new implementations
        for (const contract of contractsToUpgrade) {
            console.log(chalk.yellowBright(`Prepare transaction to upgrade ${contract.name} at ${contract.proxyAddress} to ${contract.implementationAddress}`));
            this.transactions.push({
                to: proxyAdmin.address,
                data: proxyAdmin.interface.encodeFunctionData("upgrade", [contract.proxyAddress, contract.implementationAddress])
            });
        }

        await this.initialize();

        // write version
        await this.setVersion(version);

        await fs.writeFile(`data/transactions-${version}-${network.name}.json`, JSON.stringify(this.transactions, null, 4));

        await this.submitter.submit(this.transactions);

        console.log("Done");
    }

    // private

    async _getContractFactoryAndUpdateManifest(contract: string) {
        const manifest = JSON.parse(await fs.readFile(await getManifestFile(), "utf-8")) as SkaleManifestData;

        const { linkReferences } = await artifacts.readArtifact(contract);
        if (!Object.keys(linkReferences).length)
            return await ethers.getContractFactory(contract);

        const librariesToUpgrade = [];
        const oldLibraries: {[k: string]: string} = {};
        if (manifest.libraries === undefined) {
            Object.assign(manifest, {libraries: {}});
        }
        for (const key of Object.keys(linkReferences)) {
            const libraryName = Object.keys(linkReferences[key])[0];
            const { bytecode } = await artifacts.readArtifact(libraryName);
            if (manifest.libraries[libraryName] === undefined) {
                librariesToUpgrade.push(libraryName);
                continue;
            }
            const libraryBytecodeHash = manifest.libraries[libraryName].bytecodeHash;
            if (hashBytecode(bytecode) !== libraryBytecodeHash) {
                librariesToUpgrade.push(libraryName);
            } else {
                oldLibraries[libraryName] = manifest.libraries[libraryName].address;
            }
        }
        const libraries = await deployLibraries(librariesToUpgrade);
        for (const [libraryName, libraryAddress] of libraries.entries()) {
            const { bytecode } = await artifacts.readArtifact(libraryName);
            manifest.libraries[libraryName] = {"address": libraryAddress, "bytecodeHash": hashBytecode(bytecode)};
        }
        Object.assign(libraries, oldLibraries);
        await fs.writeFile(await getManifestFile(), JSON.stringify(manifest, null, 4));
        return await getLinkedContractFactory(contract, libraries);
    }
}
