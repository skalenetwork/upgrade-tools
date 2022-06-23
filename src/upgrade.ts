import { deployLibraries, getContractKeyInAbiFile, getLinkedContractFactory, getManifestFile } from "./deploy";
import { SkaleABIFile, SkaleManifestData } from "./types";
import { promises as fs } from "fs";
import { artifacts, ethers, network, upgrades } from "hardhat";
import hre from "hardhat";
import { getImplementationAddress, hashBytecode } from "@openzeppelin/upgrades-core";
import { Contract } from "ethers";
import chalk from "chalk";
import { getManifestAdmin } from "@openzeppelin/hardhat-upgrades/dist/admin";
import { AccessControlUpgradeable, OwnableUpgradeable, ProxyAdmin, SafeMock } from "../typechain-types";
import { getVersion } from "./version";
import { getAbi } from "./abi";
import { verify } from "./verification";
import { encodeTransaction } from "./multiSend";
import { createMultiSendTransaction, sendSafeTransaction } from "./gnosis-safe";

export async function getContractFactoryAndUpdateManifest(contract: string) {
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

type DeploymentAction<ContractManagerType extends Contract> = (safeTransactions: string[], abi: SkaleABIFile, contractManager: ContractManagerType) => Promise<void>;
type MultiTransactionAction<ContractManagerType extends Contract> = (abi: SkaleABIFile, contractManager: ContractManagerType) => Promise<string[][]>;

export async function upgrade<ContractManagerType extends OwnableUpgradeable>(
    projectName: string,
    targetVersion: string,
    getDeployedVersion: (abi: SkaleABIFile) => Promise<string | undefined>,
    setVersion: (safeTransaction: string[], abi: SkaleABIFile, newVersion: string) => Promise<void>,
    safeMockAccessRequirements: string[],
    contractNamesToUpgrade: string[],
    deployNewContracts: DeploymentAction<ContractManagerType>,
    initialize: DeploymentAction<ContractManagerType>,
    afterUpgrade?: MultiTransactionAction<ContractManagerType>)
{
    if (!process.env.ABI) {
        console.log(chalk.red("Set path to file with ABI and addresses to ABI environment variables"));
        return;
    }

    const abiFilename = process.env.ABI;
    const abi = JSON.parse(await fs.readFile(abiFilename, "utf-8")) as SkaleABIFile;

    const proxyAdmin = await getManifestAdmin(hre) as ProxyAdmin;
    const contractManagerName = "ContractManager";
    const contractManagerFactory = await ethers.getContractFactory(contractManagerName);
    const contractManager = (contractManagerFactory.attach(abi[getContractKeyInAbiFile(contractManagerName) + "_address"] as string)) as ContractManagerType;

    const deployedVersion = await getDeployedVersion(abi);
    const version = await getVersion();
    if (deployedVersion) {
        if (deployedVersion !== targetVersion) {
            console.log(chalk.red(`This script can't upgrade version ${deployedVersion} to ${version}`));
            process.exit(1);
        }
    } else {
        console.log(chalk.yellow(`Can't check currently deployed version of ${projectName}`));
    }
    console.log(`Will mark updated version as ${version}`);

    const [ deployer ] = await ethers.getSigners();
    let safe = await proxyAdmin.owner();
    const safeTransactions: string[] = [];
    let safeMock: SafeMock | undefined = undefined;
    if (await ethers.provider.getCode(safe) === "0x") {
        console.log("Owner is not a contract");
        if (deployer.address !== safe) {
            console.log(chalk.red(`Used address does not have permissions to upgrade ${projectName}`));
            process.exit(1);
        }
        console.log(chalk.blue("Deploy SafeMock to simulate upgrade via multisig"));
        const safeMockFactory = await ethers.getContractFactory("SafeMock");
        safeMock = await safeMockFactory.deploy();
        await safeMock.deployTransaction.wait();

        console.log(chalk.blue("Transfer ownership to SafeMock"));
        safe = safeMock.address;
        await (await proxyAdmin.transferOwnership(safe)).wait();
        await (await contractManager.transferOwnership(safe)).wait();
        for (const contractName of safeMockAccessRequirements) {
                    const contractFactory = await getContractFactoryAndUpdateManifest(contractName);
                    const contractAddress = abi[getContractKeyInAbiFile(contractName) + "_address"] as string;
                    const contract = contractFactory.attach(contractAddress) as AccessControlUpgradeable;
                    console.log(chalk.blue(`Grant access to ${contractName}`));
                    await (await contract.grantRole(await contract.DEFAULT_ADMIN_ROLE(), safe)).wait();
        }
    } else {
        try {
            const safeMockFactory = await ethers.getContractFactory("SafeMock");
            const checkSafeMock = safeMockFactory.attach(safe);
            if (await checkSafeMock.IS_SAFE_MOCK()) {
                safeMock = checkSafeMock;
            }
        } catch (e) {
            console.log(chalk.yellow("Owner is not SafeMock"));
        }
    }

    // Deploy new contracts
    await deployNewContracts(safeTransactions, abi, contractManager);

    // deploy new implementations
    const contractsToUpgrade: {proxyAddress: string, implementationAddress: string, name: string, abi: []}[] = [];
    for (const contract of contractNamesToUpgrade) {
        const contractFactory = await getContractFactoryAndUpdateManifest(contract);
        let _contract = contract;
        if (contract === "BountyV2") {
            if (!abi[getContractKeyInAbiFile(contract) + "_address"])
            _contract = "Bounty";
        }
        const proxyAddress = abi[getContractKeyInAbiFile(_contract) + "_address"] as string;

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
        safeTransactions.push(encodeTransaction(
            0,
            proxyAdmin.address,
            0,
            proxyAdmin.interface.encodeFunctionData("upgrade", [contract.proxyAddress, contract.implementationAddress])));
        abi[getContractKeyInAbiFile(contract.name) + "_abi"] = contract.abi;
    }

    await initialize(safeTransactions, abi, safe);

    // write version
    await setVersion(safeTransactions, abi, version);

    await fs.writeFile(`data/transactions-${version}-${network.name}.json`, JSON.stringify(safeTransactions, null, 4));

    let privateKey = (network.config.accounts as string[])[0];
    if (network.config.accounts === "remote") {
        // Don't have an information about private key
        // Use random one because we most probable run tests
        privateKey = ethers.Wallet.createRandom().privateKey;
    }

    const safeTx = await createMultiSendTransaction(ethers, safe, privateKey, safeTransactions, safeMock !== undefined);
    let transactionsBatches: string[][] | undefined;
    if (afterUpgrade !== undefined) {
        transactionsBatches = await afterUpgrade(abi, contractManager);
        for (const { index, batch } of transactionsBatches.map((batch, index) => ({index, batch}))) {
            await fs.writeFile(`data/after-transactions-${index}-${version}-${network.name}.json`, JSON.stringify(batch, null, 4));
        }
    }
    if (!safeMock) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        await sendSafeTransaction(safe, chainId, safeTx);
        if (transactionsBatches !== undefined) {
            for (const batch of transactionsBatches) {
                const multiSendTransaction = await createMultiSendTransaction(ethers, safe, privateKey, batch, safeMock !== undefined);
                await sendSafeTransaction(safe, chainId, multiSendTransaction);
            }
        }
    } else {
        console.log(chalk.blue("Send upgrade transactions to safe mock"));
        try {
            await (await deployer.sendTransaction({
                to: safeMock.address,
                value: safeTx.value,
                data: safeTx.data,
            })).wait();
            if (transactionsBatches !== undefined) {
                for (const batch of transactionsBatches) {
                    const multiSendTransaction = await createMultiSendTransaction(ethers, safe, privateKey, batch, safeMock !== undefined);
                    await (await deployer.sendTransaction({
                        to: safeMock.address,
                        value: multiSendTransaction.value,
                        data: multiSendTransaction.data,
                    })).wait();
                }
            }
            console.log(chalk.blue("Transactions have been sent"));
        } finally {
            console.log(chalk.blue("Return ownership to wallet"));
            await (await safeMock.transferProxyAdminOwnership(contractManager.address, deployer.address)).wait();
            await (await safeMock.transferProxyAdminOwnership(proxyAdmin.address, deployer.address)).wait();
            if (await proxyAdmin.owner() !== deployer.address) {
                console.log(chalk.blue("Something went wrong with ownership transfer"));
                process.exit(1);
            }
        }
    }

    await fs.writeFile(`data/${projectName}-${version}-${network.name}-abi.json`, JSON.stringify(abi, null, 4));

    console.log("Done");
}
