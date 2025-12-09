/* eslint-disable max-lines */
import {AddressLike, Contract, Transaction} from "ethers";
import {hasFunctionSelector, isContractAddress} from "./utils";
import {ethers} from "hardhat";

export enum PermissionModel {
    // Does not fully complete the process of Ownable2Step
    OWNABLE = "OWNABLE",
    // This does NOT work for ACCESS_MANAGER contracts
    ROLE_BASED = "ROLE_BASED",
    ACCESS_MANAGED = "ACCESS_MANAGED",
    ACCESS_MANAGER = "ACCESS_MANAGER"
}

/*
 * ABI for Ownable interface - includes owner() function
 */
const OWNABLE_ABI = [
    "function transferOwnership(address newOwner)",
    "function owner() view returns (address)"
];

/*
 * ABI for AccessControl interface
 */
const ACCESS_CONTROL_ABI = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function grantRole(bytes32 role, address account)",
    "function revokeRole(bytes32 role, address account)",
    "function getRoleMemberCount(bytes32 role) view returns (uint256)"
];

const ACCESS_MANAGER_ABI = [
    "function hasRole(uint64 role, address account) view returns (bool)",
    "function grantRole(uint64 role, address account, uint32 executionDelay)",
    "function revokeRole(uint64 role, address account)"
];

/*
 * ABI for AccessManaged interface - includes authority() function
 */
const ACCESS_MANAGED_ABI = [
    "function authority() view returns (address)"
];

/*
 * ABI for Gnosis Safe MultiSig interface
 */
const MULTISIG_ABI = [
    "function getOwners() view returns (address[])",
    "function getThreshold() view returns (uint256)"
];


const verifyOwnableInterface = async (
    contract: Contract,
    contractAddress: string
): Promise<boolean> => {
    /*
     * Verify owner() exists and returns non-zero address
     */
    const owner = await contract.owner();
    if (owner === ethers.ZeroAddress) {
        return false;
    }

    /*
     * Verify transferOwnership() exists by checking bytecode
     */
    return await hasFunctionSelector(contractAddress, "transferOwnership(address)");
};

/*
 * Checks if a contract implements the Ownable interface.
 * A contract is considered Ownable if it has both owner() and transferOwnership() functions.
 * We verify this by reading the current owner and doing a static call (dry run) of transferOwnership.
 *
 * @param contractAddress - The address of the contract to check
 * @returns true if the contract is Ownable, false otherwise
 */
export const isOwnable = async (contractAddress: AddressLike): Promise<boolean> => {
    try {
        const resolvedAddress = await ethers.resolveAddress(contractAddress);

        if (!await isContractAddress(resolvedAddress)) {
            return false;
        }

        const contract = new Contract(
            resolvedAddress,
            OWNABLE_ABI,
            ethers.provider
        );

        return await verifyOwnableInterface(contract, resolvedAddress);
    } catch {
        return false;
    }
};

const verifyAccessControlInterface = async (
    contract: Contract,
    contractAddress: string
): Promise<boolean> => {
    /*
     * Verify hasRole() view function exists
     */
    await contract.hasRole(ethers.ZeroHash, ethers.ZeroAddress);

    /*
     * Verify grantRole() exists by checking bytecode
     */
    return await hasFunctionSelector(contractAddress, "grantRole(bytes32,address)") &&
        await hasFunctionSelector(contractAddress, "revokeRole(bytes32,address)");
};

/*
 * Checks if a contract implements the AccessControl interface.
 * A contract is considered AccessControl if it has hasRole() and grantRole() functions.
 * We verify this by calling hasRole() and doing a static call (dry run) of grantRole().
 *
 * @param contractAddress - The address of the contract to check
 * @returns true if the contract is AccessControl, false otherwise
 */
export const isAccessControl = async (contractAddress: AddressLike): Promise<boolean> => {
    try {
        const resolvedAddress = await ethers.resolveAddress(contractAddress);

        if (!await isContractAddress(resolvedAddress)) {
            return false;
        }

        const contract = new Contract(
            resolvedAddress,
            ACCESS_CONTROL_ABI,
            ethers.provider
        );

        return await verifyAccessControlInterface(contract, resolvedAddress);
    } catch {
        return false;
    }
};

const verifyAccessManagerInterface = async (
    contract: Contract,
    contractAddress: string
): Promise<boolean> => {
    /*
     * Verify hasRole(uint64,address) view function exists
     * AccessManager uses uint64 for roleId instead of bytes32
     */
    const zeroRole = 0n;
    await contract.hasRole(zeroRole, ethers.ZeroAddress);

    /*
     * Verify grantRole(uint64,address,uint32) exists by checking bytecode
     * AccessManager's grantRole includes an executionDelay parameter
     */
    return await hasFunctionSelector(contractAddress, "grantRole(uint64,address,uint32)") &&
        await hasFunctionSelector(contractAddress, "revokeRole(uint64,address)");
};

/*
 * Checks if a contract implements the AccessManager interface.
 * A contract is considered AccessManager if it has hasRole(uint64,address) and
 * grantRole(uint64,address,uint32) functions with uint64 role parameter.
 *
 * @param contractAddress - The address of the contract to check
 * @returns true if the contract is AccessManager, false otherwise
 */
export const isAccessManager = async (contractAddress: AddressLike): Promise<boolean> => {
    try {
        const resolvedAddress = await ethers.resolveAddress(contractAddress);

        if (!await isContractAddress(resolvedAddress)) {
            return false;
        }

        const contract = new Contract(
            resolvedAddress,
            ACCESS_MANAGER_ABI,
            ethers.provider
        );

        return await verifyAccessManagerInterface(contract, resolvedAddress);
    } catch {
        return false;
    }
};

/*
 * Checks if a contract implements the AccessManaged interface.
 * A contract is considered AccessManaged if it has an authority() function
 * that returns a non-zero address pointing to a manager contract.
 *
 * @param contractAddress - The address of the contract to check
 * @returns true if the contract is AccessManaged, false otherwise
 */
export const isAccessManaged = async (contractAddress: AddressLike): Promise<boolean> => {
    try {
        const resolvedAddress = await ethers.resolveAddress(contractAddress);

        const isContract = await isContractAddress(resolvedAddress);
        if (!isContract) {
            return false;
        }

        const contract = new Contract(
            resolvedAddress,
            ACCESS_MANAGED_ABI,
            ethers.provider
        );

        /*
         * Try to call authority() - if it succeeds and returns non-zero address,
         * The contract is AccessManaged
         */
        const authorityAddress = await contract.authority();

        return await isAccessControl(authorityAddress);
    } catch {
        return false;
    }
};

/*
 * Checks if a contract is a MultiSig (Gnosis Safe).
 * A contract is considered a MultiSig if it has both getOwners() and getThreshold() functions
 * and returns valid data (at least one owner and threshold > 0).
 *
 * @param contractAddress - The address of the contract to check
 * @returns An object containing owners and threshold if the contract is a MultiSig, null otherwise
 */
export const tryGetMultiSigInfo = async (contractAddress: string) => {
    let owners: string[] | null = null;
    let threshold: bigint | null = null;
    try {
        const contract = new Contract(
            contractAddress,
            MULTISIG_ABI,
            ethers.provider
        );

        owners = await contract.getOwners();
        threshold = await contract.getThreshold();
        return {owners, threshold};
    } catch (err) {
        console.warn(`Error calling usual Multi-sig getter functions: ${err}`);
        return {owners, threshold};
    }
};

/*
 * Transfers ownership of an Ownable contract to a new owner.
 * This function encodes the transferOwnership call data for the transaction.
 *
 * @param contractAddress - The address of the Ownable contract
 * @param newOwner - The address of the new owner
 * @returns Transaction object with the encoded transferOwnership call or true
 * if the new owner is already the desired owner
 *
 * @dev The address must have already been verified as an Ownable contract before calling this function.
 */
// eslint-disable-next-line max-statements
export const transferOwnership = async (
    contractAddress: string,
    newOwner: string,
    oldOwner: string
): Promise<Transaction| true> => {
    const contract = new Contract(
        contractAddress,
        OWNABLE_ABI,
        ethers.provider
    );

    if (await contract.owner() === newOwner) {
        return true;
    }

    if (await contract.owner() !== oldOwner) {
        throw new Error(`Current owner of contract ${contractAddress} does not match the provided old owner address.`);
    }

    const data = contract.interface.encodeFunctionData(
        "transferOwnership",
        [newOwner]
    );
    const transaction = new Transaction();
    transaction.to = contractAddress;
    transaction.data = data;
    return transaction;
};

/*
 * Grants a role to an address in a ROLE_BASED (AccessControl) contract.
 * This function encodes the grantRole call data for the transaction.
 *
 * @param contractAddress - The address of the AccessControl contract
 * @param role - The bytes32 role identifier to grant
 * @param account - The address to grant the role to
 * @returns Transaction object with the encoded grantRole call or true
 * if the account already has the role
 *
 * @dev The contract address must be a ROLE_BASED contract (not validated by this function)
 */
// eslint-disable-next-line max-statements
export const grantRole = async (
    contractAddress: string,
    role: string,
    newAccount: AddressLike,
    oldAccount: AddressLike
// eslint-disable-next-line max-params
): Promise<Transaction | true> => {
    const contract = new Contract(
        contractAddress,
        ACCESS_CONTROL_ABI,
        ethers.provider
    );

    /*
     * Check if the account already has the role
     */
    if (await contract.hasRole(role, newAccount)) {
        return true;
    }

    if (!await contract.hasRole(ethers.ZeroHash, oldAccount)) {
        throw new Error(`Account ${oldAccount} does not have permission to grant roles on contract ${contractAddress}.`);
    }
    if (!await contract.hasRole(role, oldAccount)) {
        return true;
    }


    const data = contract.interface.encodeFunctionData(
        "grantRole",
        [role, newAccount]
    );

    const transaction = new Transaction();
    transaction.to = contractAddress;
    transaction.data = data;
    return transaction;
};

export const revokeRole = async (
    contractAddress: string,
    role: string,
    oldAccount: AddressLike
): Promise<Transaction | boolean> => {
    const contract = new Contract(
        contractAddress,
        ACCESS_CONTROL_ABI,
        ethers.provider
    );
    if (
        !await contract.hasRole(role, oldAccount)
    ) {
        return true;
    }
    // eslint-disable-next-line no-magic-numbers
    if ((await contract.getRoleMemberCount(role)) < 2n && role === ethers.ZeroHash) {
        return false;
    }
    const data = contract.interface.encodeFunctionData(
        "revokeRole",
        [role, oldAccount]
    );

    const transaction = new Transaction();
    transaction.to = contractAddress;
    transaction.data = data;
    return transaction;
};


// eslint-disable-next-line max-statements
export const getPermissionModels = async (address: AddressLike): Promise<PermissionModel[]> => {
    const models: PermissionModel[] = [];

    if (await isOwnable(address)) {
        models.push(PermissionModel.OWNABLE);
    }

    if (await isAccessControl(address)) {
        models.push(PermissionModel.ROLE_BASED);
    }

    if (await isAccessManager(address)) {
        models.push(PermissionModel.ACCESS_MANAGER);
    }

    if (await isAccessManaged(address)) {
        models.push(PermissionModel.ACCESS_MANAGED);
    }

    if (models.includes(PermissionModel.ACCESS_MANAGER) && models.includes(PermissionModel.ROLE_BASED)) {
        throw new Error(`Address ${address} cannot be both ACCESS_MANAGER and ROLE_BASED permission models.`);
    }

    return models;
}
