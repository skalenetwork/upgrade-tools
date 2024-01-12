import { ethers } from "hardhat";
import { UnsignedTransaction } from "ethers";
import SafeApiKit from '@safe-global/api-kit'
import Safe, { EthersAdapter } from '@safe-global/protocol-kit'
import { MetaTransactionData, SafeTransaction } from '@safe-global/safe-core-sdk-types'


enum Network {
    MAINNET = 1,
    GOERLI = 5,
    GANACHE = 1337,
    HARDHAT = 31337,
}

// constants

const URLS = {
    safe_transaction: {
        [Network.MAINNET]: "https://safe-transaction-mainnet.safe.global",
        [Network.GOERLI]: "https://safe-transaction-goerli.safe.global",
    }
}

// public functions

export async function createMultiSendTransaction(safeAddress: string, transactions: UnsignedTransaction[]) {
    const safeTransactionData: MetaTransactionData[] = [];
    for (const transaction of transactions) {
        safeTransactionData.push({
            to: transaction.to ? transaction.to : ethers.constants.AddressZero,
            data: transaction.data ? transaction.data.toString() : "0x",
            value: transaction.value ? transaction.value.toString() : "0",
            operation: 0,
        });
    }

    const
        safeService = await getSafeService(),
        nonce = await safeService.getNextNonce(safeAddress);
    console.log("Will send tx to Gnosis with nonce", nonce);

    const
        options = {
            safeTxGas: "0", // Max gas to use in the transaction
            baseGas: "0", // Gas costs not related to the transaction execution (signature check, refund payment...)
            gasPrice: "0", // Gas price used for the refund calculation
            gasToken: ethers.constants.AddressZero, // Token address (hold by the Safe) to be used as a refund to the sender, if `null` is Ether
            refundReceiver: ethers.constants.AddressZero, // Address of receiver of gas payment (or `null` if tx.origin)
            nonce: nonce // Nonce of the Safe, transaction cannot be executed until Safe's nonce is not equal to this nonce
        },
        ethAdapter = await getEthAdapter(),
        safeSdk = await Safe.create({ ethAdapter, safeAddress }),
        safeTransaction = await safeSdk.createTransaction({ safeTransactionData, options });

    await proposeTransaction(safeAddress, safeTransaction);
}

// private functions


async function proposeTransaction(safeAddress: string, safeTransaction: SafeTransaction) {
    const
        [ safeOwner ] = await ethers.getSigners(),
        ethAdapter = await getEthAdapter(),
        safeSdk = await Safe.create({ ethAdapter, safeAddress }),
        safeTxHash = await safeSdk.getTransactionHash(safeTransaction),
        senderSignature = await safeSdk.signTransactionHash(safeTxHash),
        safeService = await getSafeService();
    await safeService.proposeTransaction({
        safeAddress,
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: safeOwner.address,
        senderSignature: senderSignature.data
    });
}

async function getEthAdapter(): Promise<EthersAdapter> {
    const
        [safeOwner] = await ethers.getSigners(),
        ethAdapter = new EthersAdapter({
            ethers,
            signerOrProvider: safeOwner
        });
    return ethAdapter;
}

async function getSafeService() {
    const
        chainId = (await ethers.provider.getNetwork()).chainId,
        ethAdapter: EthersAdapter = await getEthAdapter(),
        safeService = new SafeApiKit({
            txServiceUrl: getSafeTransactionUrl(chainId),
            ethAdapter
        });
    return safeService;
}

function getSafeTransactionUrl(chainId: number) {
    if (Object.keys(URLS.safe_transaction).includes(chainId.toString())) {
        return URLS.safe_transaction[chainId as keyof typeof URLS.safe_transaction];
    } else {
        throw Error(`Can't get safe-transaction url at network with chainId = ${chainId}`);
    }
}
