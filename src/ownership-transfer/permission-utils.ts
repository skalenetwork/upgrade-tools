import {
    ACCESS_CONTROL_ABI,
    ACCESS_MANAGED_ABI,
    ACCESS_MANAGER_ABI,
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
const ZERO = 0;
const MIN_ROLE_HOLDERS = 2n;

const verifyOwnableInterface = async (
    contract: Contract,
    contractAddress: string
): Promise<boolean> => {
    const owner = await contract.owner();
    return owner !== ethers.ZeroAddress &&
        await hasFunctionSelector(contractAddress, "transferOwnership(address)");
};

export const isOwnable = async (contractAddress: AddressLike): Promise<boolean> => {
    try {
        const resolvedAddress = await ethers.resolveAddress(contractAddress);
        if (!await isContractAddress(resolvedAddress)) {
            return false;
        }
        const contract = new Contract(resolvedAddress, OWNABLE_ABI, ethers.provider);
        return await verifyOwnableInterface(contract, resolvedAddress);
    } catch {
        return false;
    }
};

const verifyAccessControlInterface = async (
    contract: Contract,
    contractAddress: string
): Promise<boolean> => {
    await contract.hasRole(ethers.ZeroHash, ethers.ZeroAddress);
    return await hasFunctionSelector(contractAddress, "grantRole(bytes32,address)") &&
        await hasFunctionSelector(contractAddress, "renounceRole(bytes32,address)");
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
    return await hasFunctionSelector(contractAddress, "grantRole(uint64,address,uint32)") &&
        await hasFunctionSelector(contractAddress, "renounceRole(uint64,address)");
};

export const isAccessManager = async (contractAddress: AddressLike): Promise<boolean> => {
    try {
        const resolvedAddress = await ethers.resolveAddress(contractAddress);
        if (!await isContractAddress(resolvedAddress)) {
            return false;
        }
        const contract = new Contract(resolvedAddress, ACCESS_MANAGER_ABI, ethers.provider);
        return await verifyAccessManagerInterface(contract, resolvedAddress);
    } catch {
        return false;
    }
};

export const isAccessManaged = async (contractAddress: AddressLike): Promise<boolean> => {
    try {
        const resolvedAddress = await ethers.resolveAddress(contractAddress);
        if (!await isContractAddress(resolvedAddress)) {
            return false;
        }
        const contract = new Contract(resolvedAddress, ACCESS_MANAGED_ABI, ethers.provider);
        const authorityAddress = await contract.authority();
        return await isAccessManager(authorityAddress);
    } catch {
        return false;
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
    input: {contractAddress: string,
        role: string,
        newAccount: AddressLike,
        oldAccount: AddressLike
    }
): Promise<Transaction | false> => {
    const contract = new Contract(
        input.contractAddress,
        ACCESS_CONTROL_ABI,
        ethers.provider
    );
    // If new account already has role or old account never had it in the first place - no action
    if (await contract.hasRole(input.role, input.newAccount) || !await contract.hasRole(input.role, input.oldAccount)) {
        return false;
    }
    if (!await contract.hasRole(ethers.ZeroHash, input.oldAccount)) {
        // Currently we do not support roleAdmins - must be ran by owner
        throw new Error(`Account ${input.oldAccount} does not have permission to grant roles on contract ${input.contractAddress}.`);
    }
    const data = contract.interface.encodeFunctionData(
        "grantRole",
        [input.role, input.newAccount]
    );
    const transaction = new Transaction();
    transaction.to = input.contractAddress;
    transaction.data = data;
    return transaction;
};

export const renounceRole = async (
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
    // Prevent revoking last role holder of default admin role
    if (role === ethers.ZeroHash && (await contract.getRoleMemberCount(role)) < MIN_ROLE_HOLDERS) {
        return false;
    }
    const data = contract.interface.encodeFunctionData(
        "renounceRole",
        [role, oldAccount]
    );

    const transaction = new Transaction();
    transaction.to = contractAddress;
    transaction.data = data;
    return transaction;
};

export const getPermissionModels = async (address: AddressLike): Promise<PermissionModel[]> => {
    const checks = [
        {check: isOwnable, model: PermissionModel.OWNABLE},
        {check: isAccessControl, model: PermissionModel.ROLE_BASED},
        {check: isAccessManager, model: PermissionModel.ACCESS_MANAGER},
        {check: isAccessManaged, model: PermissionModel.ACCESS_MANAGED}
    ];
    const models: PermissionModel[] = [];
    // Change to await in loop if rate-limiting becomes an issue
    await Promise.all(checks.map(async ({check, model}) => {
        if (await check(address)) {
            models.push(model);
        }
    }));

    if (models.includes(PermissionModel.ACCESS_MANAGER) && models.includes(PermissionModel.ROLE_BASED)) {
        throw new Error(`Address ${address} cannot be both ACCESS_MANAGER and ROLE_BASED permission models.`);
    }
    return models;
}

export const grantAccessManagerRole = async (
    input: {contractAddress: string,
        role: bigint,
        newAccount: AddressLike,
        oldAccount: AddressLike
    }
): Promise<Transaction | false> => {
    const contract = new Contract(
        input.contractAddress,
        ACCESS_MANAGER_ABI,
        ethers.provider
    );
    // If new account already has role or old account never had it in the first place - no action
    if (await contract.hasRole(input.role, input.newAccount) || !await contract.hasRole(input.role, input.oldAccount)) {
        return false;
    }
    if (!await contract.hasRole(ZERO, input.oldAccount)) {
        // Currently we do not support roleAdmins - must be ran by owner
        throw new Error(`Account ${input.oldAccount} does not have permission to grant roles on contract ${input.contractAddress}.`);
    }
    const data = contract.interface.encodeFunctionData(
        "grantRole",
        [input.role, input.newAccount, ZERO]
    );
    const transaction = new Transaction();
    transaction.to = input.contractAddress;
    transaction.data = data;
    return transaction;
}

export const renounceAccessManagerRole = async (
    input: {contractAddress: string,
        role: bigint,
        newAccount: AddressLike,
        oldAccount: AddressLike
    }
): Promise<Transaction | boolean> => {
    const contract = new Contract(
        input.contractAddress,
        ACCESS_MANAGER_ABI,
        ethers.provider
    );

    if (!await contract.hasRole(input.role, input.oldAccount)) {
        return true;
    }
    // Ensure role was granted to newAccount before renouncing
    if (input.role === BigInt(ZERO) && !(await contract.hasRole(input.role, input.newAccount))) {
        return false;
    }

    const data = contract.interface.encodeFunctionData(
        "renounceRole",
        [input.role, input.oldAccount]
    );

    const transaction = new Transaction();
    transaction.to = input.contractAddress;
    transaction.data = data;
    return transaction;
};
