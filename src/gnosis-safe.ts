import {
    MetaTransactionData,
    OperationType,
    SafeTransaction,
    SafeTransactionDataPartial
} from "@safe-global/safe-core-sdk-types";
import {Network, Transaction} from "ethers";
import {ethers, network} from "hardhat";
import Safe from "@safe-global/protocol-kit";
import SafeApiKit from "@safe-global/api-kit";
import chalk from "chalk";

// Cspell:words arbitrum celo sepolia xdai


// Constants

const URLS = {
    "safe_transaction": {
        [Network.from("mainnet").chainId.toString()]:
            "https://safe-transaction-mainnet.safe.global",
        [Network.from("arbitrum").chainId.toString()]:
            "https://safe-transaction-arbitrum.safe.global",
        [Network.from("aurora").chainId.toString()]:
            "https://safe-transaction-aurora.safe.global",
        [Network.from("avalanche").chainId.toString()]:
            "https://safe-transaction-avalanche.safe.global",
        [Network.from("base").chainId.toString()]:
            "https://safe-transaction-base.safe.global",
        [Network.from("base-sepolia").chainId.toString()]:
            "https://safe-transaction-base-sepolia.safe.global",
        [Network.from("bnb").chainId.toString()]:
            "https://safe-transaction-bsc.safe.global",
        [Network.from("celo").chainId.toString()]:
            "https://safe-transaction-celo.safe.global",
        [Network.from("xdai").chainId.toString()]:
            "https://safe-transaction-gnosis-chain.safe.global",
        [Network.from("optimism").chainId.toString()]:
            "https://safe-transaction-optimism.safe.global",
        [Network.from("matic").chainId.toString()]:
            "https://safe-transaction-polygon.safe.global",
        // Polygon zkEVM
        "1101":
            "https://safe-transaction-zkevm.safe.global",
        // ZkSync Era Mainnet
        "324":
        "https://safe-transaction-zksync.safe.global",
        // Scroll
        "534352":
            "https://safe-transaction-scroll.safe.global",
        [Network.from("sepolia").chainId.toString()]:
            "https://safe-transaction-sepolia.safe.global",
    }
};

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

const getSafeTransactionUrl = (chainId: bigint) => {
    if (Object.keys(URLS.safe_transaction).includes(chainId.toString())) {
        return URLS.safe_transaction[
            Number(chainId) as keyof typeof URLS.safe_transaction
        ];
    }
    throw Error("Can't get Safe Transaction Service url" +
        ` at network with chainId = ${chainId}`);
};

const getSafeService = async () => {
    const
        {chainId} = await ethers.provider.getNetwork();
    const safeService = new SafeApiKit({
        chainId,
        "txServiceUrl": getSafeTransactionUrl(chainId)
    });
    return safeService;
};

const estimateSafeTransaction = async (
    safeAddress: string,
    safeTransactionData: SafeTransactionDataPartial | MetaTransactionData[]
) => {
    console.log("Estimate gas");
    const safeService = await getSafeService();
    const gasEstimations = await Promise.
        all((safeTransactionData as MetaTransactionData[]).
            map((transaction) => safeService.estimateSafeTransaction(
                safeAddress,
                {
                    "data": transaction.data,
                    "operation": transaction.operation || OperationType.Call,
                    "to": transaction.to,
                    "value": transaction.value
                }
            )));
    for (const estimateResponse of gasEstimations) {
        console.log(chalk.cyan("Recommend to set gas limit" +
            ` to ${estimateResponse.safeTxGas}`));
    }
    console.log(chalk.green("Send transaction to gnosis safe"));
};

const proposeTransaction = async (
    safeAddress: string,
    safeTransaction: SafeTransaction
) => {
    const [safeOwner] = await ethers.getSigners();
    const safeSdk = await Safe.init({provider: network.provider, safeAddress});
    const safeTxHash = await safeSdk.getTransactionHash(safeTransaction);
    const senderSignature = await safeSdk.signHash(safeTxHash);
    const safeService = await getSafeService();
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
    transactions: Transaction[]
) => {
    const safeTransactionData = getSafeTransactionData(transactions);
    const safeService = await getSafeService();
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
            nonce
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

    await estimateSafeTransaction(
        safeAddress,
        safeTransactionData
    );

    await proposeTransaction(
        safeAddress,
        safeTransaction
    );
};
