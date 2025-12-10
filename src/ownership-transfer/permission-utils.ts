import {
    ACCESS_CONTROL_ABI,
    ACCESS_MANAGED_ABI,
    ACCESS_MANAGER_ABI,
    MULTISIG_ABI,
    OWNABLE_ABI
} from "./constants";
import {AddressLike, Contract, Transaction} from "ethers";
import {hasFunctionSelector, isContractAddress} from "./utils";
import {ethers} from "hardhat";

export enum PermissionModel {
    // Does not fully complete the process of Ownable2Step
    OWNABLE = "OWNABLE",
    ROLE_BASED = "ROLE_BASED",
    ACCESS_MANAGED = "ACCESS_MANAGED",
    ACCESS_MANAGER = "ACCESS_MANAGER"
}

const MIN_ROLE_HOLDERS = 2n;

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
    const zeroRole = 0n;
    await contract.hasRole(zeroRole, ethers.ZeroAddress);

    /*
     * Verify grantRole(uint64,address,uint32) exists by checking bytecode
     * AccessManager's grantRole includes an executionDelay parameter
     */
    return await hasFunctionSelector(contractAddress, "grantRole(uint64,address,uint32)") &&
        await hasFunctionSelector(contractAddress, "revokeRole(uint64,address)");
};


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

        return await isAccessManager(authorityAddress);
    } catch {
        return false;
    }
};

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

export const transferOwnership = async (
    contractAddress: string,
    newOwner: string,
    oldOwner: string
): Promise<Transaction| false> => {
    const contract = new Contract(
        contractAddress,
        OWNABLE_ABI,
        ethers.provider
    );

    if (await contract.owner() === newOwner) {
        return false;
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


export const grantRole = async (
    contractAddress: string,
    role: string,
    newAccount: AddressLike,
    oldAccount: AddressLike
// eslint-disable-next-line max-params
): Promise<Transaction | false> => {
    const contract = new Contract(
        contractAddress,
        ACCESS_CONTROL_ABI,
        ethers.provider
    );

    /*
     * Check if the account already has the role OR if the oldAccount does not have it - no action
     */
    if (await contract.hasRole(role, newAccount) || !await contract.hasRole(role, oldAccount)) {
        return false;
    }

    if (!await contract.hasRole(ethers.ZeroHash, oldAccount)) {
        throw new Error(`Account ${oldAccount} does not have permission to grant roles on contract ${contractAddress}.`);
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

    if ((await contract.getRoleMemberCount(role)) < MIN_ROLE_HOLDERS && role === ethers.ZeroHash) {
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
