import hre from "hardhat";
import chalk from "chalk";
import { ProxyAdmin } from "../typechain-types";
import { artifacts, ethers, network, upgrades } from "hardhat";
import { getManifestAdmin } from "@openzeppelin/hardhat-upgrades/dist/admin";
import { getVersion } from "./version";
import { promises as fs, existsSync } from "fs";
import { deployLibraries, getLinkedContractFactory, getManifestFile } from "./deploy";
import { UnsignedTransaction } from "ethers";
import { SkaleABIFile } from "./types/SkaleABIFile";
import { getImplementationAddress, hashBytecode } from "@openzeppelin/upgrades-core";
import { getAbi } from "./abi";
import { verify } from "./verification";
import { Submitter } from "./submitters/submitter";
import { SkaleManifestData } from "./types/SkaleManifestData";
import { AutoSubmitter } from "./submitters/auto-submitter";

export abstract class Upgrader {
    abi: SkaleABIFile;
    targetVersion: string;
    contractNamesToUpgrade: string[];
    projectName: string;
    transactions: UnsignedTransaction[];
    submitter: Submitter;

    constructor(projectName: string,
                targetVersion: string,
                abi: SkaleABIFile,
                contractNamesToUpgrade: string[],
                submitter: Submitter = new AutoSubmitter()) {
        this.targetVersion = targetVersion;
        this.abi = abi;
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
        const MAINNET_CHAIN_ID = 1;
        const GOERLI_CHAIN_ID = 5;
        const mainChainIds = [MAINNET_CHAIN_ID, GOERLI_CHAIN_ID];
        const { chainId } = await hre.ethers.provider.getNetwork();

        if (!mainChainIds.includes(chainId)) {
            const originManifestFileName = __dirname + "/../.openzeppelin/predeployed.json";
            const targetManifestFileName = __dirname + `/../.openzeppelin/unknown-${chainId}.json`;
            
            if (!existsSync(targetManifestFileName)) {
                console.log("Create a manifest file based on predeployed template");
                await fs.copyFile(originManifestFileName, targetManifestFileName);
            }
        }

        const proxyAdmin = await getManifestAdmin(hre) as ProxyAdmin;

        const deployedVersion = await this.getDeployedVersion();
        const version = await getVersion();
        if (deployedVersion) {
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
        const contractsToUpgrade: {proxyAddress: string, implementationAddress: string, name: string, abi: []}[] = [];
        for (const contract of this.contractNamesToUpgrade) {
            const contractFactory = await this._getContractFactoryAndUpdateManifest(contract);
            const proxyAddress = this.abi[this._getContractKeyInAbiFile(contract) + "_address"] as string;

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
                    name: contract,
                    abi: getAbi(contractFactory.interface)
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
            this.abi[this._getContractKeyInAbiFile(contract.name) + "_abi"] = contract.abi;
        }

        await this.initialize();

        // write version
        await this.setVersion(version);

        await fs.writeFile(`data/transactions-${version}-${network.name}.json`, JSON.stringify(this.transactions, null, 4));

        await this.submitter.submit(this.transactions);

        await fs.writeFile(`data/${this.projectName}-${version}-${network.name}-abi.json`, JSON.stringify(this.abi, null, 4));

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

    _getContractKeyInAbiFile(contract: string) {
        return contract.replace(/([a-zA-Z])(?=[A-Z])/g, '$1_').toLowerCase();
    }
}