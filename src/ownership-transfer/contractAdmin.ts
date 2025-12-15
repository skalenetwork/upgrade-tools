// Cspell:words TUPP
import {Pattern, detectPattern, getAdminAddress} from "./utils";
import {
    PermissionModel,
    getPermissionModels,
    grantAccessManagerRole,
    grantRole,
    renounceAccessManagerRole,
    renounceRole,
    transferOwnership
} from "./permission-utils";
import {Transaction} from "ethers";
import chalk from "chalk";

export interface BytesRole {
    name: string;
    identifier: string;
}

export interface UintRole {
    name: string;
    identifier: bigint;
}

export interface ContractMetadataDetails {
    name: string;
    address: string;
    pattern?: Pattern;
    permissionModel?: PermissionModel[];
}

export interface TransactionData {
    transaction: Transaction;
    description?: string;
}

export class ContractAdmin {
    public contractName: string;
    public pattern?: Pattern;
    public address: string;
    public permissionModel: PermissionModel[] = [];

    private oldOwner: string;
    private newOwner: string;
    private grantOwnershipRoleTxs: TransactionData[] = [];
    private renounceOwnershipTxs: TransactionData[] = [];

    constructor(details: ContractMetadataDetails, oldOwner: string, newOwner: string) {
        this.contractName = details.name;
        this.pattern = details.pattern;
        this.address = details.address;
        this.permissionModel = details.permissionModel ?? [];
        this.oldOwner = oldOwner;
        this.newOwner = newOwner;
        // Validate manual inputs if any
        this.checkFindings();
    }

    public async scanPatternAndPermissionModels(): Promise<void> {
        if (!this.pattern || !this.permissionModel.length) {
            this.pattern = await detectPattern(this.address);
            this.permissionModel = await getPermissionModels(this.address);
            this.checkFindings();
        }
    }

    public async createGrantOwnershipTransactions(
        bytes32RolesToCheck: BytesRole[],
        managerRolesToCheck: UintRole[]
    ) {
        this.clearGrantTransactions();
        console.log(chalk.white(`* Creating Transactions to grant Ownership in ${this.contractName}.`));
        if (this.pattern === Pattern.TUPP) {
            await this.createTUPPGrantOwnershipTransaction();
        }
        // UpgradeableBeacon is detected also as OWNABLE
        if (this.permissionModel.includes(PermissionModel.OWNABLE)) {
            await this.createOwnableOwnershipTransaction();
        }
        if (this.permissionModel.includes(PermissionModel.ROLE_BASED)){
            await this.createAssignBytes32RolesTransactions(bytes32RolesToCheck);
        }
        if (this.permissionModel.includes(PermissionModel.ACCESS_MANAGER)){
            await this.createAssignUint64RolesTransactions(managerRolesToCheck);
        }
    }

    public async createRenounceOwnershipTransactions(
        bytes32RolesToCheck: BytesRole[],
        managerRolesToCheck: UintRole[]
    ) {
        this.clearRenounceTransactions();
        console.log(chalk.white(`* Creating Transactions to renounce Ownership in ${this.contractName}.`));
        if (this.permissionModel.includes(PermissionModel.ROLE_BASED)){
            await this.createRenounceBytes32RolesTransactions(bytes32RolesToCheck);
        }
        if (this.permissionModel.includes(PermissionModel.ACCESS_MANAGER)){
            await this.createRenounceUint64RolesTransactions(managerRolesToCheck);
        }
    }

    public getGrantOwnershipTransactions(): TransactionData[] {
        return this.grantOwnershipRoleTxs;
    }

    public getRenounceOwnershipTransactions(): TransactionData[] {
        return this.renounceOwnershipTxs;
    }

    public clearRenounceTransactions(): void {
        this.renounceOwnershipTxs = [];
    }

    public clearGrantTransactions(): void {
        this.grantOwnershipRoleTxs = [];
    }

    public requiresGrantingOwnership(): boolean {
        return Boolean(this.grantOwnershipRoleTxs.length);
    }

    public requiresRenouncingOwnership(): boolean {
        return Boolean(this.renounceOwnershipTxs.length);
    }

    public displayData(
        columnWidths: {maxNameWidth: number; maxAddressWidth: number; maxPermissionsWidth: number}
    ): void {
        const {maxNameWidth, maxAddressWidth, maxPermissionsWidth} = columnWidths;
        const name = this.contractName.padEnd(maxNameWidth);
        const address = this.address.padEnd(maxAddressWidth);
        const permissions = (this.permissionModel?.join(", ") || "None").padEnd(maxPermissionsWidth);
        let status = chalk.green("ALL DONE");
        if (this.grantOwnershipRoleTxs.length){
            status = chalk.yellow("GRANT OWNERSHIP REQUIRED");
        }
        else if (this.renounceOwnershipTxs.length){
            status = chalk.yellow("REVOKE ROLES REQUIRED");
        }
        console.log(chalk.gray(`  ${name}  ${address}  ${permissions}  `) + status);
    }

    private checkFindings(): void {
        const maxPermissionsIfBeacon = 1;
        if (this.pattern === Pattern.BEACON &&
            !this.permissionModel?.includes(PermissionModel.OWNABLE) &&
            this.permissionModel?.length !== maxPermissionsIfBeacon
        ) {
            throw new Error(`UpgradeableBeacon at address ${this.address} should ONLY have OWNABLE permission model.`);
        }
    }
    private async createTUPPGrantOwnershipTransaction(): Promise<void> {
        const admin = await getAdminAddress(this.address);
        await this.createOwnableOwnershipTransaction(
            {address: admin, name: `${this.contractName} Proxy Admin`}
        );
    }

    private async createOwnableOwnershipTransaction(
        contractId: {address: string; name: string} = {address: this.address, name: this.contractName}
    ): Promise<void> {
        const tx = await transferOwnership(contractId.address, this.newOwner, this.oldOwner);
        if (tx) {
            if (this.isDuplicateTransaction({transaction: tx})) {
                throw new Error(`Error: Duplicate transaction to transfer ownership of ${contractId.name} at ${contractId.address} was already created.`);
            }
            const description = `-> Tx to change ${contractId.name} Owner at ${contractId.address} to ${this.newOwner}`
            console.log(chalk.yellow(`    ${description} created.`));
            this.grantOwnershipRoleTxs.push({
                description,
                transaction: tx
            });
        }
    }

    private async createAssignUint64RolesTransactions(
        managerRolesToCheck: UintRole[]
    ): Promise<void> {
        for (const role of managerRolesToCheck) {
            // Required to process sequentially as it access shared memory state and RPC rate limits
            // eslint-disable-next-line no-await-in-loop
            const tx = await grantAccessManagerRole(
                {
                    contractAddress: this.address,
                    newAccount: this.newOwner,
                    oldAccount: this.oldOwner,
                    role: role.identifier,
                }
            );
            if (tx) {
                if (this.isDuplicateTransaction({transaction: tx})) {
                    throw new Error(`Error: Transaction to grant manager role ${role.name} in ${this.contractName} was already created.`);
                }
                else {
                    const description =
                        `-> Tx to grant role ${role.name} to ${this.newOwner} in ${this.contractName}`;
                    console.log(chalk.yellow(`    ${description} created.`));
                    this.grantOwnershipRoleTxs.push({description, transaction: tx});
                }
            }
        }
    }

    private handleRenounceOwnershipTransaction(
        tx: Transaction | boolean,
        roleName: string,
    ): void {
        if (typeof tx !== "boolean" && tx) {
            if (this.isDuplicateTransaction({transaction: tx})) {
                throw new Error(`Error: Transaction to renounce role ${roleName} in ${this.contractName} was already created.`);
            }
            else {
                const description = `-> Tx to renounce role ${roleName} from ${this.oldOwner} in ${this.contractName}`;
                console.log(chalk.yellow(`    ${description} created.`));
                this.renounceOwnershipTxs.push({description, transaction: tx});
            }
        }
        else if (!tx) {
            console.log(chalk.yellow(
                `    WARNING: Skipping revocation of role ${roleName} in ${this.contractName} as it requires at least 1 member left.`
            ));
        }
    }

    private async createRenounceUint64RolesTransactions(
        managerRolesToCheck: UintRole[]
    ): Promise<void> {
        for (const role of managerRolesToCheck) {
            // Required to process sequentially as it access shared memory state and RPC rate limits
            // eslint-disable-next-line no-await-in-loop
            const tx = await renounceAccessManagerRole(
                {
                    contractAddress: this.address,
                    newAccount: this.newOwner,
                    oldAccount: this.oldOwner,
                    role: role.identifier,
                }
            );
            this.handleRenounceOwnershipTransaction(tx, role.name);
        }
    }

    private async createAssignBytes32RolesTransactions(
        bytes32RolesToCheck: BytesRole[]
    ): Promise<void> {
        for (const role of bytes32RolesToCheck) {
            // Required to process sequentially as it access shared memory state and RPC rate limits
            // eslint-disable-next-line no-await-in-loop
            const tx = await grantRole(
                {
                    contractAddress: this.address,
                    newAccount: this.newOwner,
                    oldAccount: this.oldOwner,
                    role: role.identifier,
                }
            );
            if (tx) {
                if (this.isDuplicateTransaction({transaction: tx})) {
                    throw new Error(`Error: Transaction to grant role ${role.name} in ${this.contractName} was already created.`);
                }
                else {
                    const description =
                        `-> Tx to grant role ${role.name} to ${this.newOwner} in ${this.contractName}`;
                    console.log(chalk.yellow(`    ${description} created.`));
                    this.grantOwnershipRoleTxs.push({description, transaction: tx});
                }
            }
        }
    }

    private async createRenounceBytes32RolesTransactions(
        bytes32RolesToCheck: BytesRole[]
    ): Promise<void> {
        for (const role of bytes32RolesToCheck) {
            // Required to process sequentially as it access shared memory state and due to RPC rate limits
            // eslint-disable-next-line no-await-in-loop
            const tx = await renounceRole(this.address, role.identifier, this.oldOwner);
            this.handleRenounceOwnershipTransaction(tx, role.name);
        }
    }

    private isDuplicateTransaction(transaction: TransactionData): boolean {
        const isGrantDuplicate = this.grantOwnershipRoleTxs.some(
            (existingTx) =>
                existingTx.transaction.to === transaction.transaction.to &&
                existingTx.transaction.data === transaction.transaction.data
        );
        const isRenounceDuplicate = this.renounceOwnershipTxs.some(
            (existingTx) =>
                existingTx.transaction.to === transaction.transaction.to &&
                existingTx.transaction.data === transaction.transaction.data
        );
        return  isGrantDuplicate || isRenounceDuplicate;
    }
}
