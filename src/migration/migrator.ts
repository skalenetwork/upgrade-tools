/* eslint-disable no-await-in-loop */
import {Client, clientStrategyFactory} from "./clients/clientStrategyFactory";
import {ContractMigration, IContractMigrationOptions} from "./contractMigration";
import {JsonRpcProvider} from "ethers";
import {Project} from "../types/upgrader";


export interface IMigratorOptions {
    blockHash: string,
    migrations: ContractMigration[],
    valuesToReplace?: Map<string,string>
}
export class Migrator {
    private migrations: ContractMigration[] = [];
    private blockHash: string;
    private valuesToReplace: Map<string,string>;

    constructor(options: IMigratorOptions){
        this.blockHash = options.blockHash;
        this.migrations = options.migrations;
        this.valuesToReplace = options.valuesToReplace ?? new Map<string, string>();
    }

    // eslint-disable-next-line max-params
    static async createFromProject
    // eslint-disable-next-line max-statements
    (
        project: Project,
        provider: JsonRpcProvider,
        maxTxPerBlock?: number,
        block: string = "latest",
        clientType: Client = Client.GETH,
    ): Promise<Migrator>{
        const client = clientStrategyFactory(clientType, provider);
        const blockHash = (await provider.getBlock(block))?.hash;
        if (!blockHash) {
            throw Error(`Unable to get blockHash for block: ${block}`);
        }
        const migrations: ContractMigration[] = [];
        for (const contract of project.contractNamesToUpgrade) {
            const address = await project.instance.getContractAddress(contract);
            const migrationOptions: IContractMigrationOptions = {
                blockHash,
                client,
                contractName: contract,
                oldAddress: address,
                txPerBlock: maxTxPerBlock
            };
            const migration = new ContractMigration(migrationOptions);
            migrations.push(migration);
        }
        return new Migrator({blockHash, migrations});
    }

    setDefaultValuesToUpdate() {
        /*
         * By default, values that contain contract addresses from old instance
         * must be replaced by the addresses on the new instance
         */
        for(const migration of this.migrations){
            if (migration.newAddress) {
                this.addValueToUpdate(migration.oldAddress, migration.newAddress);
            }
        }
    }

    addValueToUpdate(oldValue: string, newValue: string){
        this.valuesToReplace.set(oldValue, newValue);
    }

    async upgrade() {
        for(const migration of this.migrations) {
            await migration.upgrade();
        }
    }
    async verify(){
        for(const migration of this.migrations) {
            await migration.verify();
        }
    }
    async migrateData(){
        for(const migration of this.migrations) {
            await migration.migrateData(this.valuesToReplace);
            try {
                await migration.transferETH();
            } catch (error) {
                console.log("Failed transferring ETH to:", migration.contractName);
                throw error;
            }
        }
    }

    async dumpStorage(){
        await Promise.all(this.migrations.map(migration => migration.dumpStorage()));
    }
    async init (){
        for (const migration of this.migrations){
            await migration.init();
        }
    }

    getContractNewAddress(name: string){
        const migration = this.migrations.find(mig => mig.contractName === name);
        return migration?.newAddress;
    }
}
