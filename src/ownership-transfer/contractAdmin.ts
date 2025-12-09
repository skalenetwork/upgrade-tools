// Cspell:words TUPP
import {Pattern, getAdminAddress} from "./utils";
import {PermissionModel, grantRole, revokeRole, transferOwnership} from "./permission-utils";
import {Transaction} from "ethers";
import chalk from "chalk";

export interface BytesRole {
    name: string;
    identifier: string;
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
    private revokeOwnershipTxs: TransactionData[] = [];

    constructor(details: ContractMetadataDetails) {
        this.contractName = details.name;
        this.pattern = details.pattern;
        this.address = details.address;
        this.permissionModel = details.permissionModel ?? [];
    }

    public async createGrantOwnershipTransactions(
        oldOwner: string,
        newOwner: string,
        bytes32RolesToCheck: BytesRole[],
        //Add managerRolesToCheck: string[]
    ) {
        if (!this.grantOwnershipRoleTxs.length) {
            console.log(chalk.white(`* Creating Transactions to grant Ownership in ${this.contractName}.`));
            if (this.pattern === Pattern.TUPP) {
                await this.createTUPPGrantOwnershipTransaction(oldOwner, newOwner);
            }
            if (this.permissionModel.includes(PermissionModel.OWNABLE)) {
                await this.createOwnableOwnershipTransaction(oldOwner, newOwner);
            }
            if (this.permissionModel.includes(PermissionModel.ROLE_BASED)){
                await this.createAssignBytes32RolesTransactions(oldOwner, newOwner, bytes32RolesToCheck);
            }
            if (this.permissionModel.includes(PermissionModel.ACCESS_MANAGER)){
                console.log(chalk.yellow("Not implemented yet: Access Manager role assignments."));
            }
        }
    }

    public async createRevokeOwnershipTransactions(
        oldOwner: string,
        newOwner: string,
        bytes32RolesToCheck: BytesRole[],
        //Add managerRolesToCheck: string[]
    ) {
        if (this.revokeOwnershipTxs.length) {
            return;
        }
        console.log(chalk.white(`* Creating Transactions to revoke Ownership in ${this.contractName}.`));
        if (this.permissionModel.includes(PermissionModel.ROLE_BASED)){
            await this.createRevokeBytes32RolesTransactions(oldOwner, newOwner, bytes32RolesToCheck);
        }
        if (this.permissionModel.includes(PermissionModel.ACCESS_MANAGER)){
            console.log(chalk.yellow("Not implemented yet: Access Manager role revocations."));
        }
    }

    public getGrantOwnershipTransactions(): TransactionData[] {
        return this.grantOwnershipRoleTxs;
    }

    public getRevokeOwnershipTransactions(): TransactionData[] {
        return this.revokeOwnershipTxs;
    }

    public clearRevokeTransactions(): void {
        this.revokeOwnershipTxs = [];
    }

    public clearGrantTransactions(): void {
        this.grantOwnershipRoleTxs = [];
    }

    public requiresOwnershipGranting(): boolean {
        return Boolean(this.grantOwnershipRoleTxs.length);
    }

    public requiresOwnershipRevoking(): boolean {
        return Boolean(this.revokeOwnershipTxs.length);
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
        else if (this.revokeOwnershipTxs.length){
            status = chalk.yellow("REVOKE ROLES REQUIRED");
        }
        console.log(chalk.gray(`  ${name}  ${address}  ${permissions}  `) + status);
    }

    // TODO: Handle case where 1 proxy admin manages multiple proxies
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

    private async createAssignBytes32RolesTransactions(
        oldOwner: string,
        newOwner: string,
        bytes32RolesToCheck: BytesRole[]
    ): Promise<void> {
        for (const role of bytes32RolesToCheck) {
            // eslint-disable-next-line no-await-in-loop
            const tx = await grantRole(this.address, role.identifier, newOwner, oldOwner);
            if (tx) {
                if (this.isDuplicateTransaction({transaction: tx})) {
                    // Unexpected - better check
                    throw new Error(`Error: Transaction to grant role ${role} in ${this.contractName} was already created.`);
                }
                else {
                    const description = `-> Tx to grant role ${role.name} to ${newOwner} in ${this.contractName}`;
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

    private async createRevokeBytes32RolesTransactions(
        oldOwner: string,
        newOwner: string,
        bytes32RolesToCheck: BytesRole[]
    ): Promise<void> {
        for (const role of bytes32RolesToCheck) {
            // Required to process sequentially due to order of transactions - 0x00 role last
            // eslint-disable-next-line no-await-in-loop
            const tx = await revokeRole(this.address, role.identifier, oldOwner);
            if (typeof tx !== "boolean" && tx) {
                if (this.isDuplicateTransaction({transaction: tx})) {
                    // Unexpected - better check
                    throw new Error(`Error: Transaction to revoke role ${role} in ${this.contractName} was already created.`);
                }
                else {
                    const description = `-> Tx to revoke role ${role.name} from ${oldOwner} in ${this.contractName}`;
                    console.log(
                        chalk.yellow(
                            `    ${description} created.`
                        )
                    );
                    this.revokeOwnershipTxs.push({description, transaction: tx});
                }
            }
            else if (!tx) {
                console.log(chalk.yellow(
                    `    WARNING: Skipping revocation of role ${role.name} in ${this.contractName} as it requires at least 1 member left.`
                ));
            }
        }
    }

    private isDuplicateTransaction(transaction: TransactionData): boolean {
        const isGrantDuplicate = this.grantOwnershipRoleTxs.some(
            (existingTx) =>
                existingTx.transaction.to === transaction.transaction.to &&
                existingTx.transaction.data === transaction.transaction.data
        );
        const isRevokeDuplicate = this.revokeOwnershipTxs.some(
            (existingTx) =>
                existingTx.transaction.to === transaction.transaction.to &&
                existingTx.transaction.data === transaction.transaction.data
        );
        return  isGrantDuplicate || isRevokeDuplicate;
    }
}
