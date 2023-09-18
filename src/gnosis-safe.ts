import {
    MetaTransactionData,
    OperationType,
    SafeTransaction,
    SafeTransactionDataPartial
} from "@safe-global/safe-core-sdk-types";
import Safe, {EthersAdapter} from "@safe-global/protocol-kit";
import SafeApiKit from "@safe-global/api-kit";
import {UnsignedTransaction} from "ethers";
import chalk from "chalk";
import {ethers} from "hardhat";
import {getNetwork} from "@ethersproject/networks";


// Constants

const URLS = {
    "safe_transaction": {
        [getNetwork("mainnet").chainId]:
            "https://safe-transaction-mainnet.safe.global",
        [getNetwork("goerli").chainId]:
            "https://safe-transaction-goerli.safe.global"
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
    "gasToken": ethers.constants.AddressZero,

    // Address of receiver of gas payment (or `null` if tx.origin)
    "refundReceiver": ethers.constants.AddressZero,

    // Max gas to use in the transaction
    "safeTxGas": "0"
};

// Private functions

const getSafeTransactionData = (transactions: UnsignedTransaction[]) => {
    const safeTransactionData: MetaTransactionData[] = [];
    for (const transaction of transactions) {
        safeTransactionData.push({
            "data": transaction.data?.toString() ?? "0x",
            "operation": OperationType.Call,
            "to": transaction.to ?? ethers.constants.AddressZero,
            "value": transaction.value?.toString() ?? "0"
        });
    }
    return safeTransactionData;
};

const getEthAdapter = async (): Promise<EthersAdapter> => {
    const
        [safeOwner] = await ethers.getSigners();
    const ethAdapter = new EthersAdapter({
        ethers,
        "signerOrProvider": safeOwner
    });
    return ethAdapter;
};

const getSafeTransactionUrl = (chainId: number) => {
    if (Object.keys(URLS.safe_transaction).includes(chainId.toString())) {
        return URLS.safe_transaction[
            chainId as keyof typeof URLS.safe_transaction
        ];
    }
    throw Error("Can't get safe-transaction url" +
        ` at network with chainId = ${chainId}`);
};

const getSafeService = async () => {
    const
        {chainId} = await ethers.provider.getNetwork();
    const ethAdapter: EthersAdapter = await getEthAdapter();
    const safeService = new SafeApiKit({
        ethAdapter,
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
    const
        [safeOwner] = await ethers.getSigners();
    const ethAdapter = await getEthAdapter();
    const safeSdk = await Safe.create({ethAdapter,
        safeAddress});
    const safeTxHash = await safeSdk.getTransactionHash(safeTransaction);
    const senderSignature = await safeSdk.signTransactionHash(safeTxHash);
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
    transactions: UnsignedTransaction[]
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
    const ethAdapter = await getEthAdapter();
    const safeSdk = await Safe.create({
        ethAdapter,
        safeAddress
    });
    const safeTransaction = await safeSdk.createTransaction({
        options,
        safeTransactionData
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
