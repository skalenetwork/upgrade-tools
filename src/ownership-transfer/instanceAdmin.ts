// Cspell:words keccak

import {BytesRole, ContractAdmin, ContractMetadataDetails, TransactionData} from "./contractAdmin";
import {EoaSubmitter, SafeSubmitter} from "../submitters";
import {
    Pattern,
    detectPattern,
    promptUserConfirmation,
    removeDuplicateTransactions
} from "./utils";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v6";
import chalk from "chalk";
import {ethers} from "hardhat";
import {getPermissionModels} from "./permission-utils";

const ZERO = 0;

interface IntegerRole {
    name: string;
    identifier: number;
}

export interface InstanceAdminOptions {
    oldOwner: string;
    submitter: SafeSubmitter | EoaSubmitter;
    revokeRoles: boolean;
    newOwner: string;
    readonly: boolean;
    // Example `MINTER_ROLE` - do not input as keccak string
    rolesToCheck?: string[];
    // Roles in Access Manager are uint64 numbers
    managerRolesToCheck?: number[];
}
export class InstanceAdmin {
    private instance: Instance;

    private contractMetadata: Map<string, ContractAdmin> = new Map<string, ContractAdmin>();
    private contractNames: string[];

    private bytes32RolesToCheck: BytesRole[] = [];
    private managerRolesToCheck: IntegerRole[] = [];
    // These are assigned in processOptions - called in constructor
    private oldOwner!: string;
    private newOwner!: string;
    private readonly!: boolean;
    private submitter!: SafeSubmitter | EoaSubmitter;
    private revokeRoles!: boolean;

    constructor(instance: Instance, contractNames: string[], options: InstanceAdminOptions) {
        this.instance = instance;
        this.contractNames = contractNames;
        this.readonly = options.readonly;
        this.newOwner = options.newOwner;
        this.submitter = options.submitter;
        this.oldOwner = options.oldOwner;
        this.revokeRoles = options.revokeRoles;

        this.processOptions(options);
    }

    private async initialize(): Promise<void> {
        await this.loadContractMetadataAndCreateTransactions();
        await this.confirmData();
    }

    private async processGrantStepIfRequired(): Promise<void> {
        if (this.ownershipGrantingRequired()) {
            await this.submitGrantOwnershipTransactions();
            // TODO: Create step to wait for txs to be confirmed in case of Multisig submitter
            if (this.revokeRoles) {
                await this.createRequiredTransactions();
            }
            await this.confirmData();
        }
    }

    private async processRevokeStepIfRequired(): Promise<void> {
        if (this.revokeRoles && this.ownershipRevokingRequired() === true) {
            await this.submitRevokeRolesTransactions();
            // TODO: Create step to wait for txs to be confirmed in case of Multisig submitter
            await this.createRequiredTransactions();
        }
    }

    public async executeOwnershipTransfer(): Promise<void> {
        // Confirm data found in initialization
        await this.initialize();
        if (this.readonly) {
            return;
        }
        await this.processGrantStepIfRequired();
        await this.processRevokeStepIfRequired();
        this.displayFindings();
        if (this.ownershipGrantingRequired() || this.ownershipRevokingRequired() && this.revokeRoles) {
            console.error(chalk.red("Unexpected state: There are still actions requires."));
        }
        else{
            console.log(chalk.green("Ownership transfer process completed. - Nothing more to do."));
        }
    }

    private async submitRevokeRolesTransactions(): Promise<void> {
        const txsToSubmit: TransactionData[] = [];
        for (const contract of this.contractMetadata.values()) {
            txsToSubmit.push(...contract.getRevokeOwnershipTransactions());
            contract.clearRevokeTransactions();
        }
        console.log(chalk.green(`Submitting ${txsToSubmit.length} revoke ownership transactions...`));
        for (const [index, txData] of txsToSubmit.entries()) {
            console.log(chalk.grey(`    -> Transaction ${index}: ${txData.description || "No description"}`));
        }
        await this.confirmAndSubmitTransactions(txsToSubmit);
    }

    private async confirmAndSubmitTransactions(txsToSubmit: TransactionData[]): Promise<void> {
        const confirmation = await promptUserConfirmation("Do you want to proceed with submitting these transactions?");
        if (!confirmation) {
            throw new Error("Transaction submission aborted by user.");
        }
        await this.submitter.submit(txsToSubmit.map(tx => tx.transaction));
    }

    private async submitGrantOwnershipTransactions(): Promise<void> {
        const txsToSubmit: TransactionData[] = [];
        for (const contract of this.contractMetadata.values()) {
            txsToSubmit.push(...contract.getGrantOwnershipTransactions());
            contract.clearGrantTransactions();
        }

        // Required for ProxyAdmins shared among multiple contracts
        const txsToSubmitFiltered = removeDuplicateTransactions(txsToSubmit);
        console.log(chalk.green(`Submitting ${txsToSubmitFiltered.length} unique grant ownership transactions...`));
        for (const [index, txData] of txsToSubmitFiltered.entries()) {
            console.log(chalk.grey(`    -> Transaction ${index}: ${txData.description || "No description"}`));
        }
        await this.confirmAndSubmitTransactions(txsToSubmit);
    }

    private ownershipGrantingRequired(): boolean {
        return Array.from(this.contractMetadata.values()).some(contract =>
            contract.requiresOwnershipGranting()
        );
    }

    private ownershipRevokingRequired(): boolean {
        return Array.from(this.contractMetadata.values()).some(contract =>
            contract.requiresOwnershipRevoking()
        );
    }

    private async loadContractMetadataAndCreateTransactions(): Promise<void> {
        /* eslint-disable no-await-in-loop */
        // Do not parallelize to avoid rate limit issues which CAN produce wrong outputs
        for (const contractName of this.contractNames) {
            /*
             * We use getContractAddress to not depend on downloaded ABI artifacts
             * all ABIs are checked locally
             */
            const address = await this.instance.getContractAddress(contractName);

            if (!this.contractMetadata.has(address)) {
                const pattern = await detectPattern(address);
                const details: ContractMetadataDetails = {
                    address,
                    name: contractName,
                    pattern,
                    permissionModel: await getPermissionModels(address)
                };
                this.contractMetadata.set(address, new ContractAdmin(details));
            }
        }
        /* eslint-enable no-await-in-loop */
        await this.createRequiredTransactions();
    }

    private async confirmData(): Promise<void> {
        this.displayFindings();

        const userConfirmed = await promptUserConfirmation();

        if (!userConfirmed) {
            this.handleUserRejection();
        }

        console.log(chalk.green("\nUser confirmed. Proceeding...\n"));
    }

    private processOptions(options: InstanceAdminOptions): void {
        // If true, does not allow to send transactions to blockchain

        this.bytes32RolesToCheck = (options.rolesToCheck ?? []).map(role => ({
            identifier: ethers.id(role),
            name: role
        }));
        // Always have DEFAULT_ADMIN_ROLE at the end!
        this.bytes32RolesToCheck.push({identifier: ethers.ZeroHash, name: "DEFAULT_ADMIN_ROLE"});
        if (!this.readonly && this.newOwner === ethers.ZeroAddress) {
            throw new Error("New owner address must be provided in options when in write mode.");
        }
        this.managerRolesToCheck = (options.managerRolesToCheck ?? []).map(role => {
            if (typeof role !== "number" || !Number.isInteger(role) || role < ZERO) {
                throw new Error(`Invalid manager role: ${role}. Must be a non-negative integer.`);
            }
            return {identifier: role, name: `Role ${role}`};
        });
        // Always have ADMIN_ROLE at the end!
        this.managerRolesToCheck.push({identifier: ZERO, name: "ADMIN_ROLE"});
    }

    private async createRequiredTransactions(): Promise<void> {
        console.log(chalk.grey("INFO: The next Following steps will NOT submit any transactions to the blockchain."));
        // Preffered to create sequentially due to rate limits
        /* eslint-disable no-await-in-loop */
        for(const contract of this.contractMetadata.values()) {
            await contract.createGrantOwnershipTransactions(
                this.oldOwner,
                this.newOwner,
                this.bytes32RolesToCheck
                //TODO: this.managerRolesToCheck
            );
            if (!contract.requiresOwnershipGranting()) {
                await contract.createRevokeOwnershipTransactions(
                    this.oldOwner,
                    this.newOwner,
                    this.bytes32RolesToCheck,
                    // TODO: this.managerRolesToCheck
                );
            }
        }
        /* eslint-enable no-await-in-loop */
    }

    private getColumnWidths(): {
        maxNameWidth: number;
        maxAddressWidth: number;
        maxPermissionsWidth: number;
    } {
        let maxNameWidth = 0;
        let maxAddressWidth = 0;
        let maxPermissionsWidth = 0;
        for (const contract of this.contractMetadata.values()) {
            maxNameWidth = Math.max(maxNameWidth, contract.contractName.length);
            maxAddressWidth = Math.max(maxAddressWidth, contract.address.length);
            const permissions = contract.permissionModel?.join(", ") || "None";
            maxPermissionsWidth = Math.max(maxPermissionsWidth, permissions.length);
        }
        return {maxAddressWidth, maxNameWidth, maxPermissionsWidth};
    }

    private displayPatternGroup(pattern: string, contracts: ContractAdmin[]): void {
        const columnWidths = this.getColumnWidths();
        console.log(chalk.bold(`\n${pattern} Pattern (${contracts.length} contracts):`));
        for (const contract of contracts) {
            contract.displayData(columnWidths);
        }
    }

    private displayFindings(): void {
        console.log(chalk.cyan("\n=== Ownership Status Results ===\n"));
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
        throw new Error("User aborted because some data was inaccurate. Data has been cleared.");
    }

    private groupMetadataByPattern(): Record<Pattern, ContractAdmin[]> {
        const grouped: Record<Pattern, ContractAdmin[]> = Object.values(Pattern).
            reduce((acc, pattern) => {
                acc[pattern] = [];
                return acc;
            }, {} as Record<Pattern, ContractAdmin[]>);

        for (const metadata of this.contractMetadata.values()) {
            grouped[metadata.pattern].push(metadata);
        }

        return grouped;
    }
}

