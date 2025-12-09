// Cspell:words TUPP
import {
    ERC1967_ADMIN_SLOT,
    ERC1967_BEACON_SLOT,
    ERC1967_IMPLEMENTATION_SLOT,
    basicBeaconAbi
} from "./constants";
import {AddressLike} from "ethers";
import {TransactionData} from "./contractAdmin";
import chalk from "chalk";
import {ethers} from "hardhat";
import readline from "readline";

/*
 * Ethereum addresses are 20 bytes = 40 hex characters
 * Used for extracting addresses from 32-byte storage slots
 */
const ADDRESS_HEX_LENGTH = 40;

export enum Pattern {
    TUPP = "TUPP",
    BEACON = "BEACON",
    REGULAR = "REGULAR"
}

export const isContractAddress = async (address: string): Promise<boolean> => {
    const code = await ethers.provider.getCode(address);
    return code !== "0x" && code !== "0x0";
};

export const extractAddressFromSlot = (slotValue: string): string => {
    const addressHex = `0x${slotValue.slice(-ADDRESS_HEX_LENGTH)}`;
    return ethers.getAddress(addressHex);
};

export const getAdminAddress = async (address: string): Promise<string> => {
    const adminSlotValue = await ethers.provider.getStorage(
        address,
        ERC1967_ADMIN_SLOT
    );
    return extractAddressFromSlot(adminSlotValue);
};

export const getImplementationAddress = async (address: string): Promise<string> => {
    const implementationSlotValue = await ethers.provider.getStorage(
        address,
        ERC1967_IMPLEMENTATION_SLOT
    );
    return extractAddressFromSlot(implementationSlotValue);
};

const validateTUPPProxy = async (
    proxyAddress: string,
    adminAddress: string
): Promise<boolean> => {
    const isAdminContract = await isContractAddress(adminAddress);

    if (!isAdminContract) {
        return false;
    }

    const implementationAddress = await getImplementationAddress(proxyAddress);
    return implementationAddress !== ethers.ZeroAddress && await isContractAddress(implementationAddress);
};

/*
 * Checks if the contract follows the Transparent Upgradeable Proxy Pattern.
 * A TUPP proxy has an admin address in the ERC1967 admin slot.
 */
export const isTUPPPattern = async (address: string): Promise<boolean> => {
    try {
        const adminAddress = await getAdminAddress(address);

        if (adminAddress === ethers.ZeroAddress) {
            return false;
        }

        return await validateTUPPProxy(address, adminAddress);
    } catch {
        return false;
    }
};

/*
 * Checks if the contract follows the Beacon Proxy Pattern.
 * A Beacon proxy has a beacon address in the ERC1967 beacon slot,
 * or it might be a beacon contract itself with an owner() function.
 */
export const isBeaconPattern = async (address: string): Promise<boolean> => {
    try {
        // Check beacon slot
        const beaconSlotValue = await ethers.provider.getStorage(
            address,
            ERC1967_BEACON_SLOT
        );

        const beaconAddress = extractAddressFromSlot(beaconSlotValue);

        if (beaconAddress === ethers.ZeroAddress) {
            return false;
        }

        const contract = new ethers.Contract(
            address,
            basicBeaconAbi,
            ethers.provider
        );

        const [owner, implementation] = await Promise.all([
            contract.owner(),
            contract.implementation()
        ]);

        return owner !== ethers.ZeroAddress &&
            implementation === beaconAddress &&
            await isContractAddress(implementation);
    } catch {
        return false;
    }
};

/*
 * Identifies the proxy pattern for a given address by checking:
 * 1. TUPP (Transparent Upgradeable Proxy Pattern)
 * 2. BEACON pattern
 * 3. REGULAR (non-proxy contract)
 */
export const identifyProxyPattern = async (address: string): Promise<Pattern> => {
    const isTUPP = await isTUPPPattern(address);
    if (isTUPP) {
        return Pattern.TUPP;
    }

    const isBeacon = await isBeaconPattern(address);
    if (isBeacon) {
        return Pattern.BEACON;
    }

    return Pattern.REGULAR;
};

/*
 * Prompts the user for confirmation via command line input.
 * Accepts "yes" or "y" (case-insensitive) as confirmation.
 * Returns a Promise that resolves to true if confirmed, false otherwise.
 */
export const promptUserConfirmation = (message?: string): Promise<boolean> => {
    const rl = readline.createInterface({
        "input": process.stdin,
        "output": process.stdout
    });
    const msg = message || "Do you confirm these findings?";
    return new Promise((resolve) => {
        rl.question(
            chalk.yellow(`${msg} (yes/y to confirm): `),
            (answer) => {
                rl.close();
                const normalizedAnswer = answer.trim().toLowerCase();
                resolve(normalizedAnswer === "yes" || normalizedAnswer === "y");
            }
        );
    });
};


/*
 * Detects the proxy pattern used by a contract at the given address.
 */
export const detectPattern = async (address: AddressLike): Promise<Pattern> => {
    try {
        const resolvedAddress = await ethers.resolveAddress(address);
        const isContract = await isContractAddress(resolvedAddress);

        if (!isContract) {
            throw new Error(`Address ${address} is not a contract. Stopping...`)
        }

        return await identifyProxyPattern(resolvedAddress);
    } catch (error) {
        console.error(`Error detecting pattern for address ${address}:`, error);
        return Pattern.REGULAR;
    }
}

export const hasFunctionSelector = async (address: string, signature: string): Promise<boolean> => {
    const iface = new ethers.Interface([`function ${signature}`]);
    const {selector} = iface.getFunction(signature) || {};

    if (!selector) {
        throw new Error(`Invalid function signature: ${signature}`);
    }

    try {
        // Empty arguments used — we just want to test if the selector is valid
        const result = await ethers.provider.call({
            data: selector,
            to: address
        });
        if (result === "0x") {
            return false;
        }
        return true;
    } catch (err) {
        // Reverted = function exists, but call params invalid
        return true;
    }
}

export const removeDuplicateTransactions = (items: TransactionData[]): TransactionData[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
        /*
         * Create a unique composite key for the 'to' and 'data' pair.
         * We use a separator ('|') to ensure 'a' + 'bc' doesn't clash with 'ab' + 'c'
         */
        const uniqueKey = `${item.transaction.to}|${item.transaction.data}`;

        if (seen.has(uniqueKey)) {
            return false;
        }

        seen.add(uniqueKey);
        return true;
    });
}
