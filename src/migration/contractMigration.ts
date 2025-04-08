/* eslint-disable no-await-in-loop */


import {IClientStrategy, Slot} from "./clients/iClientStrategy";
import {artifacts, ethers, upgrades} from "hardhat";
import {getLibrariesToUpgrade, getSkaleManifest, updateManifest} from "../contractFactory";
import {resolveAddress, zeroPadValue} from "ethers";
import {verifyProxy} from "../verification";




// Constant slots defined by EIP-1967 (do not override)
const IMPL_ADDRESS_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ADMIN_ADDRESS_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const ADDRESS_SIZE = 32;

/*
 * This should be safe limit
 * However, it's possible to set the limit for 1 if reliability is crucial.
 * Incidents such as rate-limits by the provider can cause the script to hang or terminate
 */
const MAX_TX_PER_BLOCK = 3;

export interface IContractMigrationOptions {
    contractName:string,
    oldAddress:string,
    client: IClientStrategy,
    blockHash: string,
    txPerBlock?: number,
}

const deployLibraries = async (
    libraryNames: string[],
) => {
    const libraries = new Map<string, string>();

    for (const lib of libraryNames){
        const Library = await ethers.getContractFactory(lib);
        const library = await Library.
            deploy();
        await library.waitForDeployment()
        const address = await library.getAddress();
        libraries.set(lib, address);
    }
    return libraries;
}

export class ContractMigration {
    public contractName: string;
    public oldAddress: string;
    public newAddress: string | undefined;
    public storage: Slot[] = [];
    public client: IClientStrategy;
    public blockHash: string;
    private txPerBlock: number;

    constructor(options: IContractMigrationOptions) {
        this.contractName = options.contractName;
        this.oldAddress = options.oldAddress;
        this.client = options.client;
        this.blockHash = options.blockHash;
        this.txPerBlock = options.txPerBlock ?? MAX_TX_PER_BLOCK
    }

    public async init() {
        await this.deployRawStorageSetter();
        return this;
    }

    public async dumpStorage(){
        this.storage = await this.client.dumpStorageForContract(this.oldAddress, this.blockHash);
        console.log("Found", this.storage.length, "entries for", this.contractName);
        return this.storage;
    }

    // eslint-disable-next-line max-statements
    public async migrateData(valuesToUpdate: Map<string, string>) {
        this.updateValues(valuesToUpdate);
        const storageSetter = await ethers.getContractAt("RawStorageSetter", this.newAddress as string);
        const receipts = [];
        let sent = 0;
        for (const {key, value} of this.storage) {
            if (key !== IMPL_ADDRESS_SLOT && key !== ADMIN_ADDRESS_SLOT) {
                const tx = await storageSetter.setStorage(key, value);
                // eslint-disable-next-line no-plusplus
                sent++;
                receipts.push(tx.wait());
                if (!(sent % this.txPerBlock)){
                    // eslint-disable-next-line no-ternary, no-magic-numbers
                    const len = this.storage.length > 2 ? this.storage.length - 2 : 0
                    console.log("Waiting batch", sent / this.txPerBlock, "of", Math.ceil(len / this.txPerBlock))
                    await Promise.all(receipts);
                    receipts.length = 0;
                }
            }
        }
        await Promise.all(receipts);
        console.log(`finished migrating data of: ${this.contractName}`);
    }

    private async deployRawStorageSetter() {
        const rawStorageSetter = await ethers.getContractFactory("RawStorageSetter");
        const contractProxy = await upgrades.deployProxy(rawStorageSetter, []);

        await contractProxy.waitForDeployment();

        this.newAddress = await resolveAddress(contractProxy);

        console.log("Deployed new proxy for", this.contractName, "at", this.newAddress);
    }

    public async upgrade() {
        const realContractFactory = await this.getContractFactoryAndUpdateManifest();

        await upgrades.upgradeProxy(this.newAddress as string, realContractFactory, {
            unsafeAllowLinkedLibraries: true
        });

        console.log("Upgraded", this.contractName);
    }

    public async verify() {
        // TODO: check
        try {
            await verifyProxy(this.contractName, this.newAddress as string);
            console.log("Verified", this.contractName);
        } catch (error) {
            console.log(`Failed verifying ${this.contractName}. Cause: ${error}`)
        }
    }

    private updateValues(valuesToUpdate: Map<string, string>) {
        const filteredSlots = []
        for (const slot of this.storage) {
            for (const [oldVal, newVal] of valuesToUpdate.entries()){
                /*
                 * For each place where the slot value corresponded to the contract address in the old chain
                 * Replace with the address of the New deployment
                 */
                if (slot.value === zeroPadValue(oldVal, ADDRESS_SIZE)){
                    slot.value = zeroPadValue(newVal as string, ADDRESS_SIZE);
                }
            }
            filteredSlots.push(slot);
        }
        this.storage = filteredSlots;
    }

    private async getContractFactoryAndUpdateManifest() {
        const {linkReferences} = await artifacts.readArtifact(this.contractName);
        if (!Object.keys(linkReferences).length) {
            return await ethers.getContractFactory(this.contractName);
        }

        const manifest = await getSkaleManifest();

        const {
            librariesToUpgrade,
            oldLibraries
        } = await getLibrariesToUpgrade(
            manifest,
            linkReferences
        );
        const libraries = await deployLibraries(
            librariesToUpgrade,
        );
        await updateManifest(
            manifest,
            libraries,
            oldLibraries
        );
        return await ethers.getContractFactory(
            this.contractName,
            {"libraries": Object.fromEntries(libraries)}
        );
    }

    // eslint-disable-next-line max-statements
    async transferETH(){
        let balance = await this.client.getBalance(this.oldAddress);
        // eslint-disable-next-line no-magic-numbers
        if (balance === 0n) {
            return;
        }

        if (balance > ethers.parseEther("5")){
            console.log(`Balance of ${this.contractName} is bigger than 5TH.`);
            console.log(`Missing top up ${this.newAddress} with: ${balance - ethers.parseEther("5")}`);
            balance = ethers.parseEther("5");
        }
        // eslint-disable-next-line no-magic-numbers
        const sender = (await ethers.getSigners()).at(0)
        if (!sender) {return;}
        const tx = await sender.sendTransaction({
            to: this.newAddress,
            value: balance,
        });
        await tx.wait();

        console.log("Transferred", ethers.formatEther(balance.toString()), "to", this.contractName);
    }
}

