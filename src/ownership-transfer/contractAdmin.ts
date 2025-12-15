// Cspell:words TUPP
import {Pattern, getAdminAddress} from "./utils";
import {
    PermissionModel,
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
    pattern: Pattern;
    address: string;
    permissionModel?: PermissionModel[];
}

export interface TransactionData {
    transaction: Transaction;
    description?: string;
}

export class ContractAdmin {
    public contractName: string;
    public pattern: Pattern;
    public address: string;
    public permissionModel: PermissionModel[] = [];

    private grantOwnershipRoleTxs: TransactionData[] = [];
    private renounceOwnershipTxs: TransactionData[] = [];

    constructor(details: ContractMetadataDetails) {
        this.contractName = details.name;
        this.pattern = details.pattern;
        this.address = details.address;
        this.permissionModel = details.permissionModel ?? [];
    }

    // Looks cleaner than passing an object. Also parsing the object would be more verbose.
    // eslint-disable-next-line max-params, max-statements
    public async createGrantOwnershipTransactions(
        oldOwner: string,
        newOwner: string,
        bytes32RolesToCheck: BytesRole[],
        managerRolesToCheck: UintRole[]
    ) {
        if (!this.grantOwnershipRoleTxs.length) {
            console.log(chalk.white(`* Creating Transactions to grant Ownership in ${this.contractName}.`));
            if (this.pattern === Pattern.TUPP) {
                await this.createTUPPGrantOwnershipTransaction(oldOwner, newOwner);
            }
            // UpgradeableBeacon is detected also as OWNABLE
            if (this.permissionModel.includes(PermissionModel.OWNABLE)) {
                await this.createOwnableOwnershipTransaction(oldOwner, newOwner);
            }
            if (this.permissionModel.includes(PermissionModel.ROLE_BASED)){
                await this.createAssignBytes32RolesTransactions(oldOwner, newOwner, bytes32RolesToCheck);
            }
            if (this.permissionModel.includes(PermissionModel.ACCESS_MANAGER)){
                await this.createAssignUint64RolesTransactions(oldOwner, newOwner, managerRolesToCheck);
            }
        }
    }

    // eslint-disable-next-line max-params
    public async createRenounceOwnershipTransactions(
        oldOwner: string,
        newOwner: string,
        bytes32RolesToCheck: BytesRole[],
        managerRolesToCheck: UintRole[]
    ) {
        if (this.renounceOwnershipTxs.length) {
            return;
        }
        console.log(chalk.white(`* Creating Transactions to renounce Ownership in ${this.contractName}.`));
        if (this.permissionModel.includes(PermissionModel.ROLE_BASED)){
            await this.createRenounceBytes32RolesTransactions(oldOwner, bytes32RolesToCheck);
        }
        if (this.permissionModel.includes(PermissionModel.ACCESS_MANAGER)){
            await this.createRenounceUint64RolesTransactions(oldOwner, newOwner, managerRolesToCheck);
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

    public requiresOwnershipGranting(): boolean {
        return Boolean(this.grantOwnershipRoleTxs.length);
    }

    public requiresOwnershipRevoking(): boolean {
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

    // InstanceAdmin filters duplicates across multiple contracts sharing the same proxy admin
    private async createTUPPGrantOwnershipTransaction(
        oldOwner: string,
        newOwner: string
    ): Promise<void> {
        const admin = await getAdminAddress(this.address);
        await this.createOwnableOwnershipTransaction(
            oldOwner,
            newOwner,
            {address: admin, name: `${this.contractName} Proxy Admin`}
        );
    }

    private async createOwnableOwnershipTransaction(
        oldOwner: string,
        newOwner: string,
        contractId: {address: string; name: string} = {address: this.address, name: this.contractName}
    ): Promise<void> {
        const tx = await transferOwnership(contractId.address, newOwner, oldOwner);
        if (tx) {
            if (this.isDuplicateTransaction({transaction: tx})) {
            // Shares proxy admin with another contract - tx already created
                return;
            }
            const description = `-> Tx to change ${contractId.name} Owner at ${contractId.address} to ${newOwner}`
            console.log(
                chalk.yellow(
                    `    ${description} created.`
                )
            );
            this.grantOwnershipRoleTxs.push({
                description,
                transaction: tx
            });
        }
    }

    private async createAssignUint64RolesTransactions(
        oldOwner: string,
        newOwner: string,
        managerRolesToCheck: UintRole[]
    ): Promise<void> {
        for (const role of managerRolesToCheck) {
            // Required to process sequentially as it access shared memory state
            // eslint-disable-next-line no-await-in-loop
            const tx = await grantAccessManagerRole(this.address, role.identifier, newOwner, oldOwner);
            if (tx) {
                if (this.isDuplicateTransaction({transaction: tx})) {
                    // Unexpected - better check
                    throw new Error(`Error: Transaction to grant manager role ${role.name} in ${this.contractName} was already created.`);
                }
                else {
                    const description =
                        `-> Tx to grant role ${role.name} to ${newOwner} in ${this.contractName}`;
                    console.log(
                        chalk.yellow(
                            `    ${description} created.`
                        )
                    );
                    this.grantOwnershipRoleTxs.push({description, transaction: tx});
                }
            }
        }
    }

    private handleRenounceOwnershipTransaction(
        tx: Transaction | boolean,
        roleName: string,
        oldOwner: string,
    ): void {
        if (typeof tx !== "boolean" && tx) {
            if (this.isDuplicateTransaction({transaction: tx})) {
                // Unexpected - better check
                throw new Error(`Error: Transaction to renounce role ${roleName} in ${this.contractName} was already created.`);
            }
            else {
                const description = `-> Tx to renounce role ${roleName} from ${oldOwner} in ${this.contractName}`;
                console.log(
                    chalk.yellow(
                        `    ${description} created.`
                    )
                );
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
        oldOwner: string,
        newOwner: string,
        managerRolesToCheck: UintRole[]
    ): Promise<void> {
        for (const role of managerRolesToCheck) {
            // Required to process sequentially as it access shared memory state
            // eslint-disable-next-line no-await-in-loop
            const tx = await renounceAccessManagerRole(this.address, role.identifier, oldOwner, newOwner);
            this.handleRenounceOwnershipTransaction(tx, role.name, oldOwner);
        }
    }

    private async createAssignBytes32RolesTransactions(
        oldOwner: string,
        newOwner: string,
        bytes32RolesToCheck: BytesRole[]
    ): Promise<void> {
        for (const role of bytes32RolesToCheck) {
            // Required to process sequentially as it access shared memory state
            // eslint-disable-next-line no-await-in-loop
            const tx = await grantRole(this.address, role.identifier, newOwner, oldOwner);
            if (tx) {
                if (this.isDuplicateTransaction({transaction: tx})) {
                    // Unexpected - better check
                    throw new Error(`Error: Transaction to grant role ${role.name} in ${this.contractName} was already created.`);
                }
                else {
                    const description =
                        `-> Tx to grant role ${role.name} to ${newOwner} in ${this.contractName}`;
                    console.log(
                        chalk.yellow(
                            `    ${description} created.`
                        )
                    );
                    this.grantOwnershipRoleTxs.push({description, transaction: tx});
                }
            }
        }
    }

    private async createRenounceBytes32RolesTransactions(
        oldOwner: string,
        bytes32RolesToCheck: BytesRole[]
    ): Promise<void> {
        for (const role of bytes32RolesToCheck) {
            // Required to process sequentially as it access shared memory state
            // eslint-disable-next-line no-await-in-loop
            const tx = await renounceRole(this.address, role.identifier, oldOwner);
            this.handleRenounceOwnershipTransaction(tx, role.name, oldOwner);
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
