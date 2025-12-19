import {
    MetaTransactionData,
    OperationType,
    SafeTransaction,
} from "@safe-global/safe-core-sdk-types";
import {ethers, network} from "hardhat";
import Safe from "@safe-global/protocol-kit";
import SafeApiKit from "@safe-global/api-kit";
import {Transaction} from "ethers";

// Cspell:words arbitrum celo sepolia xdai holesky

const defaultOptions = {

    /*
     * Gas costs not related to the transaction execution
     * (signature check, refund payment...)
     */
    "baseGas": "0",

    // Gas price used for the refund calculation
    "gasPrice": "0",

    /*
     * Token address (hold by the Safe)
     * to be used as a refund to the sender,
     * if `null` is Ether
     */
    "gasToken": ethers.ZeroAddress,

    // Address of receiver of gas payment (or `null` if tx.origin)
    "refundReceiver": ethers.ZeroAddress,

    // Max gas to use in the transaction
    "safeTxGas": "0"
};

// Private functions

const getSafeTransactionData = (transactions: Transaction[]) => {
    const safeTransactionData: MetaTransactionData[] = [];
    for (const transaction of transactions) {
        safeTransactionData.push({
            "data": transaction.data,
            "operation": OperationType.Call,
            "to": transaction.to ?? ethers.ZeroAddress,
            "value": transaction.value.toString()
        });
    }
    return safeTransactionData;
};

const getSafeService = (chainId: bigint) => {
    if(!process.env.GNOSIS_API_KEY) {
        throw new Error("GNOSIS_API_KEY is not set");
    }
    const safeService = new SafeApiKit({
        apiKey: process.env.GNOSIS_API_KEY,
        chainId,
        // Does not need the URL - chainId is enough
    });
    return safeService;
};

const proposeTransaction = async (
    safeAddress: string,
    chainId: bigint,
    safeTransaction: SafeTransaction
) => {
    const [safeOwner] = await ethers.getSigners();
    const safeSdk = await Safe.init({provider: network.provider, safeAddress});
    const safeTxHash = await safeSdk.getTransactionHash(safeTransaction);
    const senderSignature = await safeSdk.signHash(safeTxHash);
    const safeService = getSafeService(chainId);
    await safeService.proposeTransaction({
        safeAddress,
        "safeTransactionData": safeTransaction.data,
        safeTxHash,
        "senderAddress": safeOwner.address,
        "senderSignature": senderSignature.data
    });
};

// Public functions

export const createMultiSendTransaction = async (
    safeAddress: string,
    chainId: bigint,
    transactions: Transaction[]
) => {
    const safeTransactionData = getSafeTransactionData(transactions);
    const safeService = getSafeService(chainId);
    const nonce = await safeService.getNextNonce(safeAddress);
    console.log(
        "Will send tx to Gnosis with nonce",
        nonce
    );

    const options = {
        ...defaultOptions,
        ...{

            /*
             * Nonce of the Safe,
             * Transaction cannot be executed until
             * Safe's nonce is not equal to this nonce
             */
            nonce: parseInt(nonce, 10)
        }
    };
    const safeSdk = await Safe.init({
        provider: network.provider,
        safeAddress
    });
    const safeTransaction = await safeSdk.createTransaction({
        options,
        transactions: safeTransactionData
    });

    await proposeTransaction(
        safeAddress,
        chainId,
        safeTransaction
    );
};
