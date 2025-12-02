import {
    Pattern,
    detectPattern,
    promptUserConfirmation
} from "./utils";
import {PermissionModel, getPermissionModels} from "./permission-utils";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v6";
import chalk from "chalk";

interface ContractMetadataDetails {
    name: string;
    pattern: Pattern;
    address: string;
    permissionModel?: PermissionModel[];
}

export class OwnershipAdmin {
    private instance: Instance;
    private contractMetadata: Map<string, ContractMetadataDetails>;
    private contractNames: string[];
    private isMetadataLoaded: boolean;

    private readonly: boolean;

    constructor(instance: Instance, contractNames: string[], readonly: boolean = true) {
        this.instance = instance;
        this.contractMetadata = new Map<string, ContractMetadataDetails>();

        this.isMetadataLoaded = false;

        // If true, does not allow to send transactions to blockchain
        this.readonly = readonly;
        this.contractNames = contractNames;
    }

    public async loadContractMetadata(confirmFindings: boolean = true): Promise<void> {
        await Promise.all(
            this.contractNames.map(async (contractName) => {
                // Already checks the contractName is in the instance
                const address = await this.instance.getContractAddress(contractName);

                if (!this.contractMetadata.has(address)) {
                    const pattern = await detectPattern(address);
                    const details: ContractMetadataDetails = {
                        address,
                        name: contractName,
                        pattern,
                        permissionModel: await getPermissionModels(address)
                    };
                    this.contractMetadata.set(address, details);
                }
            })
        );

        this.isMetadataLoaded = true;
        if (this.contractMetadata.size !== this.contractNames.length) {
            throw new Error("Some contract names did not yield metadata. Names duplicated? Aborting...");
        }
        if (confirmFindings) {
            await this.confirmMetadata();
        }
    }

    private async confirmMetadata(): Promise<void> {
        this.displayFindings();

        const userConfirmed = await promptUserConfirmation();

        if (!userConfirmed) {
            this.handleUserRejection();
        }

        console.log(chalk.green("\nUser confirmed. Proceeding...\n"));
    }

    private displayFindings(): void {
        console.log(chalk.cyan("\n=== Contract Pattern Detection Results ===\n"));
        const groupedByPattern = this.groupMetadataByPattern();
        for (const [pattern, contracts] of Object.entries(groupedByPattern)) {
            const minContractsToDisplay = 0;
            if (contracts.length > minContractsToDisplay) {
                console.log(chalk.bold(`\n${pattern} Pattern (${contracts.length} contracts):`));
                for (const contract of contracts) {
                    console.log(chalk.gray(`  - ${contract.name} (${contract.address}) - Permission Models: ${contract.permissionModel?.join(", ") || "None"}`));
                }
            }
        }
        console.log(chalk.cyan("\n==========================================\n"));
    }

    private handleUserRejection(): never {
        console.log(chalk.yellow("\nUser did not confirm. Aborting and clearing metadata..."));
        this.contractMetadata.clear();
        this.isMetadataLoaded = false;
        throw new Error("User aborted the operation. Metadata has been cleared.");
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
}
