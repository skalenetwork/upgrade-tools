import {AddressLike, Contract} from "ethers";
import {hasFunctionSelector, isContractAddress} from "./utils";
import chalk from "chalk";
import {ethers} from "hardhat";

export enum PermissionModel {
    // Does not fully complete the process of Ownable2Step
    OWNABLE = "OWNABLE",
    // This works also for ACCESS_MANAGER contracts - i.e they are ROLE_BASED
    ROLE_BASED = "ROLE_BASED",
    ACCESS_MANAGED = "ACCESS_MANAGED"
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
    "function revokeRole(bytes32 role, address account)"
];

/*
 * ABI for AccessManaged interface - includes authority() function
 */
const ACCESS_MANAGED_ABI = [
    "function authority() view returns (address)"
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
export const transferOwnership = async (
    contractAddress: AddressLike,
    newOwner: AddressLike
): Promise<{ to: string; data: string } | boolean> => {
    const resolvedContractAddress = await ethers.resolveAddress(contractAddress);
    const resolvedNewOwner = await ethers.resolveAddress(newOwner);

    const contract = new Contract(
        resolvedContractAddress,
        OWNABLE_ABI,
        ethers.provider
    );

    if (await contract.owner() === resolvedNewOwner) {
        return true;
    }

    const data = contract.interface.encodeFunctionData(
        "transferOwnership",
        [resolvedNewOwner]
    );

    console.log(
        chalk.green(
            `Prepared transferOwnership transaction for ${resolvedContractAddress} to new owner ${resolvedNewOwner}`
        )
    );

    return {
        data,
        "to": resolvedContractAddress
    };
};


export const getPermissionModels = async (address: AddressLike): Promise<PermissionModel[]> => {
    const models: PermissionModel[] = [];

    if (await isOwnable(address)) {
        models.push(PermissionModel.OWNABLE);
    }

    if (await isAccessControl(address)) {
        models.push(PermissionModel.ROLE_BASED);
    }

    if (await isAccessManaged(address)) {
        models.push(PermissionModel.ACCESS_MANAGED);
    }

    return models;
}
