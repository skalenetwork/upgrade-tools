/* eslint-disable max-lines */
// Exceeded by 3 - required for now

// Cspell:words keccak

import {
    BytesRole,
    ContractAdmin,
    ContractMetadataDetails,
    TransactionData,
    UintRole
} from "./contractAdmin";
import {EoaSubmitter, SafeSubmitter} from "../submitters";
import {
    Pattern,
    detectPattern,
    promptUserConfirmation,
    removeDuplicateTransactions
} from "./utils";
import {PermissionModel, getPermissionModels} from "./permission-utils";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v6";
import chalk from "chalk";
import {ethers} from "hardhat";

const ZERO = 0;

export interface InstanceAdminOptions {
    oldOwner: string;
    submitter: SafeSubmitter | EoaSubmitter;
    renounceRoles: boolean;
    newOwner: string;
    readonly: boolean;
    testMode: boolean;

    // Example `MINTER_ROLE` - do not input as keccak string
    rolesToCheck?: string[];
    // Roles in Access Manager are uint64 numbers
    managerRolesToCheck?: number[];
}

interface ContractId {
    name: string;
    address?: string;
}
export class InstanceAdmin {
    private instance?: Instance;
    private contractMetadata: Map<string, ContractAdmin> = new Map<string, ContractAdmin>();
    private contractIds: ContractId[];
    private bytes32RolesToCheck: BytesRole[] = [];
    private managerRolesToCheck: UintRole[] = [];
    private oldOwner: string;
    private newOwner: string;
    private readonly: boolean;
    private submitter: SafeSubmitter | EoaSubmitter;
    private renounceRoles: boolean;
    private testMode: boolean;

    constructor(contractIds: ContractId[], options: InstanceAdminOptions, instance?: Instance) {
        this.instance = instance;
        this.contractIds = contractIds;
        this.readonly = options.readonly;
        this.newOwner = options.newOwner;
        this.submitter = options.submitter;
        this.oldOwner = options.oldOwner;
        this.renounceRoles = options.renounceRoles;
        this.testMode = options.testMode;
        this.processOptions(options);
    }

    public async executeOwnershipTransfer(): Promise<void> {
        // Confirm data found in initialization
        await this.initialize();
        if (this.readonly) {
            return;
        }
        await this.processGrantStepIfRequired();
        await this.processRenounceStepIfRequired();
        this.displayFindings();
        if (this.ownershipGrantingRequired() || this.ownershipRevokingRequired() && this.renounceRoles) {
            console.error(chalk.red("Unexpected state: There are still actions requires."));
        }
        else{
            console.log(chalk.green("Ownership transfer process completed. - Nothing more to do."));
        }
    }

    private async initialize(): Promise<void> {
        await this.loadContractMetadataAndCreateTransactions();
        await this.confirmData();
    }

    private async processGrantStepIfRequired(): Promise<void> {
        if (this.ownershipGrantingRequired()) {
            await this.submitGrantOwnershipTransactions();
            if (this.renounceRoles) {
                await this.createRequiredTransactions();
            }
            await this.confirmData();
        }
    }

    private async processRenounceStepIfRequired(): Promise<void> {
        if (this.renounceRoles && this.ownershipRevokingRequired() === true) {
            await this.submitRenounceRolesTransactions();
            await this.createRequiredTransactions();
        }
    }

    private async submitRenounceRolesTransactions(): Promise<void> {
        const txsToSubmit: TransactionData[] = [];
        for (const contract of this.contractMetadata.values()) {
            txsToSubmit.push(...contract.getRenounceOwnershipTransactions());
            contract.clearRenounceTransactions();
        }
        console.log(chalk.green(`Submitting ${txsToSubmit.length} renounce ownership transactions...`));
        for (const [index, txData] of txsToSubmit.entries()) {
            console.log(chalk.grey(`    -> Transaction ${index}: ${txData.description || "No description"}`));
        }
        await this.confirmAndSubmitTransactions(txsToSubmit);
    }

    private async confirmAndSubmitTransactions(txsToSubmit: TransactionData[]): Promise<void> {
        const confirmation = await this.promptConfirmation("Do you want to proceed with submitting these transactions?");
        if (!confirmation) {
            throw new Error("Transaction submission aborted by user.");
        }
        await this.submitter.submit(txsToSubmit.map(tx => tx.transaction));
        if (this.submitter instanceof SafeSubmitter) {
            await this.promptConfirmation(
                "Please confirm ONLY AFTER the Safe transactions have been executed on-chain.\n" +
                "Do you want to proceed?"
            );
        }
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

    private async resolveContractAddress(contractName: string): Promise<string> {
        if (!this.instance) {
            throw new Error(`Instance is not defined. Cannot resolve ${contractName} address.`);
        }
        return await this.instance.getContractAddress(contractName);
    }

    private async loadContractMetadataAndCreateTransactions(): Promise<void> {
        /* eslint-disable no-await-in-loop */
        // Do not parallelize to avoid rate limit issues which CAN produce wrong outputs
        for (const {name: contractName, address} of this.contractIds) {
            const resolvedAddress = address || await this.resolveContractAddress(contractName);
            if (!this.contractMetadata.has(resolvedAddress)) {
                const pattern = await detectPattern(resolvedAddress);
                const details: ContractMetadataDetails = {
                    address: resolvedAddress,
                    name: contractName,
                    pattern,
                    permissionModel: await getPermissionModels(resolvedAddress)
                };
                const maxPermissionsIfBeacon = 1;
                if (pattern === Pattern.BEACON &&
                    !details.permissionModel?.includes(PermissionModel.OWNABLE) &&
                    details.permissionModel?.length !== maxPermissionsIfBeacon
                ) {
                    throw new Error(`UpgradeableBeacon at address ${resolvedAddress} should ONLY have OWNABLE permission model.`);
                }
                this.contractMetadata.set(resolvedAddress, new ContractAdmin(details));
            }
        }
        /* eslint-enable no-await-in-loop */
        await this.createRequiredTransactions();
    }

    private async confirmData(): Promise<void> {
        this.displayFindings();
        const userConfirmed = await this.promptConfirmation();
        if (!userConfirmed) {
            this.handleUserRejection();
        }
        console.log(chalk.green("\nUser confirmed. Proceeding...\n"));
    }

    private processOptions(options: InstanceAdminOptions): void {
        this.bytes32RolesToCheck = (options.rolesToCheck ?? []).map(role => ({
            identifier: ethers.id(role),
            name: role
        }));
        this.bytes32RolesToCheck.push({identifier: ethers.ZeroHash, name: "DEFAULT_ADMIN_ROLE"});
        if (!this.readonly && this.newOwner === ethers.ZeroAddress) {
            throw new Error("New owner address must be provided in options when in write mode.");
        }
        this.managerRolesToCheck = (options.managerRolesToCheck ?? []).map(role => {
            if (typeof role !== "bigint" || role as bigint <= ZERO) {
                throw new Error(`Invalid manager role: ${role}. Must be a non-zero bigint.`);
            }
            return {identifier: role, name: `Role ${role}`};
        });
        this.managerRolesToCheck.push({identifier: BigInt(ZERO), name: "ADMIN_ROLE"});
    }

    private async createRequiredTransactions(): Promise<void> {
        console.log(chalk.grey("INFO: The next Following steps will NOT submit any transactions to the blockchain."));
        // Preferred to create sequentially due to rate limits
        /* eslint-disable no-await-in-loop */
        for(const contract of this.contractMetadata.values()) {
            await contract.createGrantOwnershipTransactions(
                this.oldOwner,
                this.newOwner,
                this.bytes32RolesToCheck,
                this.managerRolesToCheck
            );
            if (!contract.requiresOwnershipGranting()) {
                await contract.createRenounceOwnershipTransactions(
                    this.oldOwner,
                    this.newOwner,
                    this.bytes32RolesToCheck,
                    this.managerRolesToCheck
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

    private async promptConfirmation(msg?: string): Promise<boolean> {
        if (this.testMode) {
            return true;
        }
        return await promptUserConfirmation(msg);
    }
}
