import chalk from "chalk";
import {ethers} from "hardhat";
import {UnsignedTransaction} from "ethers";
import SafeApiKit from "@safe-global/api-kit";
import Safe, {EthersAdapter} from "@safe-global/protocol-kit";
import {MetaTransactionData, SafeTransaction, SafeTransactionDataPartial} from "@safe-global/safe-core-sdk-types";


enum Network {
    MAINNET = 1,
    GOERLI = 5,
    GANACHE = 1337,
    HARDHAT = 31337,
}

// Constants

const URLS = {
    "safe_transaction": {
        [Network.MAINNET]: "https://safe-transaction-mainnet.safe.global",
        [Network.GOERLI]: "https://safe-transaction-goerli.safe.global"
    }
};

// Public functions

export const createMultiSendTransaction = async (safeAddress: string, transactions: UnsignedTransaction[]) => {
    const safeTransactionData: MetaTransactionData[] = [];
    for (const transaction of transactions) {
        safeTransactionData.push({
            "to": transaction.to
                ? transaction.to
                : ethers.constants.AddressZero,
            "data": transaction.data
                ? transaction.data.toString()
                : "0x",
            "value": transaction.value
                ? transaction.value.toString()
                : "0",
            "operation": 0
        });
    }

    const
        safeService = await getSafeService();
    const nonce = await safeService.getNextNonce(safeAddress);
    console.log(
        "Will send tx to Gnosis with nonce",
        nonce
    );

    const options = {
        // Max gas to use in the transaction
        "safeTxGas": "0",

        // Gas costs not related to the transaction execution (signature check, refund payment...)
        "baseGas": "0",

        // Gas price used for the refund calculation
        "gasPrice": "0",

        // Token address (hold by the Safe) to be used as a refund to the sender, if `null` is Ether
        "gasToken": ethers.constants.AddressZero,

        // Address of receiver of gas payment (or `null` if tx.origin)
        "refundReceiver": ethers.constants.AddressZero,

        // Nonce of the Safe, transaction cannot be executed until Safe's nonce is not equal to this nonce
        nonce
    };
    const ethAdapter = await getEthAdapter();
    const safeSdk = await Safe.create({ethAdapter,
        safeAddress});
    const safeTransaction = await safeSdk.createTransaction({safeTransactionData,
        options});

    await estimateSafeTransaction(
        safeAddress,
        safeTransactionData
    );

    await proposeTransaction(
        safeAddress,
        safeTransaction
    );
};

// Private functions

const estimateSafeTransaction = async (safeAddress: string, safeTransactionData: SafeTransactionDataPartial | MetaTransactionData[]) => {
    console.log("Estimate gas");
    const safeService = await getSafeService();
    for (const transaction of safeTransactionData as MetaTransactionData[]) {
        const estimateResponse = await safeService.estimateSafeTransaction(
            safeAddress,
            {
                "to": transaction.to,
                "value": transaction.value,
                "data": transaction.data,
                "operation": transaction.operation || 0
            }
        );
        console.log(chalk.cyan(`Recommend to set gas limit to ${parseInt(
            estimateResponse.safeTxGas,
            10
        )}`));
    }
    console.log(chalk.green("Send transaction to gnosis safe"));
};

const proposeTransaction = async (safeAddress: string, safeTransaction: SafeTransaction) => {
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

const getEthAdapter = async (): Promise<EthersAdapter> => {
    const
        [safeOwner] = await ethers.getSigners();
    const ethAdapter = new EthersAdapter({
        ethers,
        "signerOrProvider": safeOwner
    });
    return ethAdapter;
};

const getSafeService = async () => {
    const
        {chainId} = await ethers.provider.getNetwork();
    const ethAdapter: EthersAdapter = await getEthAdapter();
    const safeService = new SafeApiKit({
        "txServiceUrl": getSafeTransactionUrl(chainId),
        ethAdapter
    });
    return safeService;
};

const getSafeTransactionUrl = (chainId: number) => {
    if (Object.keys(URLS.safe_transaction).includes(chainId.toString())) {
        return URLS.safe_transaction[chainId as keyof typeof URLS.safe_transaction];
    }
    throw Error(`Can't get safe-transaction url at network with chainId = ${chainId}`);
};
