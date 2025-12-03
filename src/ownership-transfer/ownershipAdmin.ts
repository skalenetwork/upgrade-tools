/* eslint-disable max-lines */
// Cspell:words TUPP keccak
import {
    Pattern,
    detectPattern,
    getAdminAddress,
    isContractAddress,
    promptUserConfirmation
} from "./utils";
import {PermissionModel, getPermissionModels, grantRole, transferOwnership, tryGetMultiSigInfo} from "./permission-utils";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v6";
import {Transaction} from "ethers";
import chalk from "chalk";
import {ethers} from "hardhat";

const ZERO = 0;
interface ContractMetadataDetails {
    name: string;
    pattern: Pattern;
    address: string;
    permissionModel?: PermissionModel[];
}

interface TransactionData {
    transaction: Transaction;
    description?: string;
}

interface OwnershipAdminOptions {
    newOwner?: string;
    readonly?: boolean;
    // Example `MINTER_ROLE` - do not input as keccak string
    rolesToCheck?: string[];
    // Roles in Access Manager are uint64 numbers
    managerRolesToCheck?: number[];
}
export class OwnershipAdmin {
    private instance: Instance;
    private contractMetadata: Map<string, ContractMetadataDetails>;
    private contractNames: string[];
    private isMetadataLoaded: boolean;
    private transactionsByContractName: Map<string, TransactionData[]>;
    private transactions: Transaction[] = [];
    private bytes32RolesToCheck: string[] = [];
    private managerRolesToCheck: number[] = [];
    private newOwner: string;
    private newOwnerConfirmed: boolean = false;
    private readonly: boolean;

    // eslint-disable-next-line max-statements
    constructor(instance: Instance, contractNames: string[], options: OwnershipAdminOptions = {}) {
        this.instance = instance;
        this.contractMetadata = new Map<string, ContractMetadataDetails>();

        this.isMetadataLoaded = false;
        this.transactionsByContractName = new Map<string, TransactionData[]>();

        // If true, does not allow to send transactions to blockchain
        this.readonly = options.readonly ?? true;
        this.newOwner = options.newOwner ?? ethers.ZeroAddress;
        this.bytes32RolesToCheck = (options.rolesToCheck ?? []).map(role =>
            // Convert to keccak256 hash
             ethers.id(role)
        );
        // Always check DEFAULT_ADMIN_ROLE at the end!
        this.bytes32RolesToCheck.push(ethers.ZeroHash);

        this.managerRolesToCheck = options.managerRolesToCheck ?? [];
        this.managerRolesToCheck.forEach(role => {
            if (typeof role !== "number" || !Number.isInteger(role) || role < ZERO) {
                throw new Error(`Invalid manager role: ${role}. Must be a non-negative integer.`);
            }
        });
        this.managerRolesToCheck.push(ZERO);

        if (!this.readonly && this.newOwner === ethers.ZeroAddress) {
            throw new Error("New owner address must be provided in options when in write mode.");
        }
        this.contractNames = contractNames;
    }

    // eslint-disable-next-line max-statements
    public async loadContractMetadata(confirmFindings: boolean = true): Promise<void> {
        if (this.isMetadataLoaded) {
            console.log(chalk.yellow("Contract metadata is already loaded. Skipping reload."));
            return;
        }
        // TODO: Refactor to parallelize
        for (const contractName of this.contractNames) {
            // eslint-disable-next-line no-await-in-loop
            const address = await this.instance.getContractAddress(contractName);

            if (!this.contractMetadata.has(address)) {
                // eslint-disable-next-line no-await-in-loop
                const pattern = await detectPattern(address);
                const details: ContractMetadataDetails = {
                    address,
                    name: contractName,
                    pattern,
                    // eslint-disable-next-line no-await-in-loop
                    permissionModel: await getPermissionModels(address)
                };
                this.contractMetadata.set(address, details);
            }
        }

        this.isMetadataLoaded = true;
        if (this.contractMetadata.size !== this.contractNames.length) {
            throw new Error("Some contract names did not yield metadata. Names duplicated? Aborting...");
        }
        if (confirmFindings) {
            await this.confirmMetadata();
        }
    }

    public async createNecessaryTransactions(): Promise<void> {
        // Clear previous transactions
        console.log(chalk.grey("INFO: The next Following steps will NOT submit any transactions to the blockchain."));
        if (!this.readonly) {
            await this.promptConfirmNewOwner();
        }

        for(const contract of this.contractMetadata.values()) {
            // eslint-disable-next-line no-await-in-loop
            const txs: TransactionData[] = await this.createTxsToChangeContractOwnership(contract);
            this.transactionsByContractName.set(contract.name, txs);
            txs.forEach(txData => this.transactions.push(txData.transaction));
        }
    }


    private async confirmMetadata(): Promise<void> {
        this.displayMetadataFindings();

        const userConfirmed = await promptUserConfirmation();

        if (!userConfirmed) {
            this.handleUserRejection();
        }

        console.log(chalk.green("\nUser confirmed. Proceeding...\n"));
    }

    private getColumnWidths(): {maxNameWidth: number; maxAddressWidth: number} {
        let maxNameWidth = 0;
        let maxAddressWidth = 0;
        for (const contract of this.contractMetadata.values()) {
            maxNameWidth = Math.max(maxNameWidth, contract.name.length);
            maxAddressWidth = Math.max(maxAddressWidth, contract.address.length);
        }
        return {maxAddressWidth, maxNameWidth};
    }

    private displayPatternGroup(pattern: string, contracts: ContractMetadataDetails[]): void {
        const {maxNameWidth, maxAddressWidth} = this.getColumnWidths();
        console.log(chalk.bold(`\n${pattern} Pattern (${contracts.length} contracts):`));
        for (const contract of contracts) {
            const name = contract.name.padEnd(maxNameWidth);
            const address = contract.address.padEnd(maxAddressWidth);
            const permissions = contract.permissionModel?.join(", ") || "None";
            console.log(chalk.gray(`  ${name}  ${address}  ${permissions}`));
        }
    }

    private displayMetadataFindings(): void {
        console.log(chalk.cyan("\n=== Contract Pattern Detection Results ===\n"));
        const groupedByPattern = this.groupMetadataByPattern();

        for (const [pattern, contracts] of Object.entries(groupedByPattern)) {
            if (contracts.length) {
                this.displayPatternGroup(pattern, contracts);
            }
        }
        console.log(chalk.cyan("\n==========================================\n"));
    }

    private handleUserRejection(): never {
        console.log(chalk.red("User did not confirm. Aborting and clearing all data..."));
        this.contractMetadata.clear();
        this.transactions.length = 0;
        this.isMetadataLoaded = false;
        throw new Error("User aborted the operation. Data has been cleared.");
    }

    private groupMetadataByPattern(): Record<Pattern, ContractMetadataDetails[]> {
        const grouped: Record<Pattern, ContractMetadataDetails[]> = Object.values(Pattern).
            reduce((acc, pattern) => {
                acc[pattern] = [];
                return acc;
            }, {} as Record<Pattern, ContractMetadataDetails[]>);

        for (const metadata of this.contractMetadata.values()) {
            grouped[metadata.pattern].push(metadata);
        }

        return grouped;
    }

    private async createTUPPOwnershipTransaction(
        contractData: ContractMetadataDetails
    ): Promise<TransactionData | true> {
        const admin = await getAdminAddress(contractData.address);
        const tx = await transferOwnership(admin, this.newOwner);
        if (typeof tx === "boolean" && tx) {
            console.log(
                chalk.gray(`    -> Owner of ProxyAdmin of ${contractData.address} is already ${this.newOwner}.`)
            );
            return true;
        }
        else if (this.isDuplicateTransaction(tx)) {
            console.log(
                chalk.gray(`    -> Transaction to change Owner of Proxy Admin of ${contractData.name} was already prepared.`)
            );
            console.log(
                chalk.gray(`       NOTE: It's likely ${contractData.name} shares the same Proxy Admin of another contract.`)
            );
            return true
        }

        console.log(
            chalk.yellow(
                `    -> Tx to change Proxy Admin at ${admin} of ${contractData.name} created.`
            )
        );
        return {
            description: `-> Tx to change Proxy Admin at ${admin} to ${this.newOwner}`,
            transaction:tx
        }
    }

    private async createOwnableOwnershipTransaction(
        contractData: ContractMetadataDetails
    ): Promise<TransactionData | true> {
        const tx = await transferOwnership(contractData.address, this.newOwner);
        if (typeof tx === "boolean" && tx) {
            console.log(
                chalk.gray(`    -> Owner of ${contractData.name} at ${contractData.address} is already ${this.newOwner}.`)
            );
            return true;
        }
        else if (this.isDuplicateTransaction(tx)) {
            throw new Error(`Error: Transaction to change Owner of ${contractData.name} was already created.`);
        }

        console.log(
            chalk.yellow(
                `    -> Tx to change Owner of ${contractData.name} at ${contractData.address} created.`
            )
        );
        return {
            description: `-> Tx to change Owner of ${contractData.name} at ${contractData.address} to ${this.newOwner} created`,
            transaction:tx
        }
    }

    private async createAssignRolesTransactions(
        contractData: ContractMetadataDetails,
    ): Promise<TransactionData[]> {
        const txs: TransactionData[] = [];
        for (const role of this.bytes32RolesToCheck) {
            // eslint-disable-next-line no-await-in-loop
            const tx = await grantRole(contractData.address, role, this.newOwner);
            if (typeof tx === "boolean" && tx) {
                console.log(
                    chalk.gray(`    -> Role ${role} already granted to ${this.newOwner} in ${contractData.name}.`)
                );
            }
            else if (this.isDuplicateTransaction(tx)) {
                throw new Error(`Error: Transaction to grant role ${role} in ${contractData.name} was already created.`);
            }
            else {
                console.log(
                    chalk.yellow(
                        `    -> Tx to grant role ${role} to ${this.newOwner} in ${contractData.name} created.`
                    )
                );
                txs.push({
                    description: `-> Tx to grant role ${role} to ${this.newOwner} in ${contractData.name}`,
                    transaction: tx
                });
            }
        }
        return txs;
    }

    // TODO: Remove this
    // eslint-disable-next-line max-statements
    private async createTxsToChangeContractOwnership(contractData: ContractMetadataDetails): Promise<TransactionData[]>{
        console.log(chalk.white(`* Creating Transactions to change Ownership of ${contractData.name}.`))
        const txs: TransactionData[] = [];
        if (contractData.pattern === Pattern.TUPP) {
            const tx = await this.createTUPPOwnershipTransaction(contractData);
            if (tx !== true) {
                txs.push(tx);
            }
        }
        if (contractData.permissionModel?.includes(PermissionModel.OWNABLE)){
            const tx = await this.createOwnableOwnershipTransaction(contractData);
            if (tx !== true) {
                txs.push(tx);
            }
        }
        if (contractData.permissionModel?.includes(PermissionModel.ROLE_BASED)){
            const txList = await this.createAssignRolesTransactions(contractData);
            if (txList.length) {
                txList.forEach(tx => txs.push(tx));
            }
        }
        if (contractData.permissionModel?.includes(PermissionModel.ACCESS_MANAGER)){
            console.log(chalk.yellow("Not implemented yet: Access Manager role assignments."));
        }
        return txs;
    }

    // eslint-disable-next-line max-statements
    private async promptConfirmNewOwner(): Promise<void> {
        if (this.newOwnerConfirmed) {
            console.log(chalk.white("INFO: New owner already confirmed. Skipping confirmation."));
            return;
        }
        const message1 = `You have specified the new owner address as ${this.newOwner}.`;
        let message2 = "";
        let message3 = "";
        const isContract = await isContractAddress(this.newOwner);
        if (isContract) {
            message2 = chalk.green(`INFO: It appears to be a contract address.`);
            const {owners, threshold} = await tryGetMultiSigInfo(this.newOwner);
            if (owners) {
                const ownersList = owners.join(", ");
                message3 = chalk.green(`INFO: Found owners of new Owner Multi-Sig: ${ownersList}`);
            }
            else {
                message3 = chalk.red(`WARNING: The script was unable to collect owners details.`);
            }

            if (threshold) {
                message3 += chalk.green(`INFO: Multi-Sig threshold is set to ${threshold}.`);
            }
            else {
                message3 += chalk.red(`WARNING: The script was unable to determine the Multi-Sig threshold.`);
            }
        }
        const message = `${message1}\n${message2 || ""}\n${message3 || ""}\nDo you confirm this is correct?`;
        const userConfirmed = await promptUserConfirmation(message);

        if (!userConfirmed) {
            throw new Error("User did not confirm the new owner address. Aborting...");
        }
        this.newOwnerConfirmed = true;
    }

    // TODO: Remove disable
    // eslint-disable-next-line class-methods-use-this
    private async promptConfirmTransactions(transactions: TransactionData[]): Promise<boolean> {
        if(!transactions.length) {
            return true;
        }
        console.log(chalk.white("\n=== Prepared Following Ownership Transfer Transactions ===\n"));
        transactions.forEach((txData, index) => {
            console.log(chalk.gray(`    - Transaction ${index}: ${txData.description || "No description"}`));
        });
        const msg = "Do you confirm these transactions? They will NOT be sent to the blockchain yet.";
        const userConfirmed = await promptUserConfirmation(msg);
        return userConfirmed;
    }

    private isDuplicateTransaction(transaction: Transaction): boolean {
        return this.transactions.some(
            (existingTx) =>
                existingTx.to === transaction.to &&
                existingTx.data === transaction.data
        );
    }
}
