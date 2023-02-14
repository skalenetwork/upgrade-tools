import axios from "axios";
import * as ethUtil from 'ethereumjs-util';
import chalk from "chalk";
import { BigNumberish, BytesLike, ethers } from "ethers";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";

// types

type Ethers = typeof ethers & HardhatEthersHelpers;

enum Network {
    MAINNET = 1,
    RINKEBY = 4,
    GOERLI = 5,
    GANACHE = 1337,
    HARDHAT = 31337,
}

interface SafeMultisigTransactionWithTransfersResponse{
    safe: string,
    to: string,
    value: number,
    data?: string,
    operation: number,
    gasToken?: string,
    safeTxGas: number,
    baseGas: number,
    gasPrice: number,
    refundReceiver?: string,
    nonce: number,
    executionDate: string,
    submissionDate: string,
    modified: string,
    blockNumber?: number,
    transactionHash: string,
    safeTxHash: string,
    executor?: string,
    isExecuted: boolean,
    isSuccessful?: boolean,
    ethGasPrice?: string,
    maxFeePerGas?: string,
    maxPriorityFeePerGas?: string,
    gasUsed?: number,
    fee?: number,
    origin: string,
    dataDecoded?: string,
    confirmationsRequired: number,
    confirmations?: unknown,
    trusted: boolean,
    signatures?: string,
    transfers: unknown,
    txType?: string
}

interface AllTransactionsSchema{
    count: number,
    next: string,
    previous: string | null,
    results: SafeMultisigTransactionWithTransfersResponse[]
}

interface SafeMultisigEstimateTx{
    safe: string,
    to:	string,
    value: number,
    data?: string
    operation: number
    gasToken?: string
}

interface SafeMultisigEstimateTxResponseV2 {
    safeTxGas: string,
    baseGas: string,
    dataGas: string,
    operationalGas: string,
    gasPrice: string,
    lastUsedNonce: number,
    gasToken: string,
    refundReceiver: string
}

interface SafeMultisigTransaction {
    safe: string,
    to: string,
    value: number,
    data?: string,
    operation: number,
    gasToken?: string,
    safeTxGas: number,
    baseGas: number,
    gasPrice: number,
    refundReceiver?: string,
    nonce: number,
    contractTransactionHash: string,
    sender:	string,
    signature?:	string,
    origin?: string
}

interface SafeInfoResponse {
    address: string,
    nonce: number,
    threshold: number,
    owners:	string[],
    masterCopy:	string,
    modules: string[],
    fallbackHandler: string,
    guard: string,
    version: string
}

// constants

const ADDRESSES = {
    multiSend: {
        [Network.MAINNET]: "0x8D29bE29923b68abfDD21e541b9374737B49cdAD",
        [Network.RINKEBY]: "0x8D29bE29923b68abfDD21e541b9374737B49cdAD",
        [Network.GOERLI]: "0x8D29bE29923b68abfDD21e541b9374737B49cdAD",
    },
}

const URLS = {
    safe_transaction: {
        [Network.MAINNET]: "https://safe-transaction.mainnet.gnosis.io",
        [Network.RINKEBY]: "https://safe-transaction.rinkeby.gnosis.io",
        [Network.GOERLI]: "https://safe-transaction.goerli.gnosis.io",
    },
    safe_relay: {
        [Network.MAINNET]: "https://safe-relay.mainnet.gnosis.io",
        [Network.RINKEBY]: "https://safe-relay.rinkeby.gnosis.io",
        [Network.GOERLI]: "https://safe-relay.goerli.gnosis.io",
    }
}

// public functions

export function getSafeTransactionUrl(chainId: number) {
    if (Object.keys(URLS.safe_transaction).includes(chainId.toString())) {
        return URLS.safe_transaction[chainId as keyof typeof URLS.safe_transaction];
    } else {
        throw Error(`Can't get safe-transaction url at network with chainId = ${chainId}`);
    }
}

export function getSafeRelayUrl(chainId: number) {
    if (Object.keys(URLS.safe_relay).includes(chainId.toString())) {
        return URLS.safe_relay[chainId as keyof typeof URLS.safe_relay];
    } else {
        throw Error(`Can't get safe-relay url at network with chainId = ${chainId}`);
    }
}

export async function createMultiSendTransaction(ethers: Ethers, safeAddress: string, privateKey: string, transactions: string[], chainId: number, nonce?: number) {
    const multiSendAddress = getMultiSendAddress(chainId);
    const multiSendAbi = [{"constant":false,"inputs":[{"internalType":"bytes","name":"transactions","type":"bytes"}],"name":"multiSend","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"}];
    const multiSend = new ethers.Contract(multiSendAddress, new ethers.utils.Interface(multiSendAbi), ethers.provider);

    let nonceValue = 0;
    if (nonce === undefined) {
        try {
            if (process.env.NONCE) {
                // NONCE variable is set
                if (isNaN(Number.parseInt(process.env.NONCE))) {
                    // NONCE variable is not a number
                    if (process.env.NONCE.toLowerCase() === "pending") {
                        nonceValue = await getSafeNonceWithPending(chainId, safeAddress);
                    } else {
                        nonceValue = await getSafeNonce(chainId, safeAddress);
                    }
                } else {
                    // NONCE variable is a number
                    nonceValue = Number.parseInt(process.env.NONCE);
                }
            } else {
                // NONCE variable is not set
                nonceValue = await getSafeNonce(chainId, safeAddress);
            }
        } catch (e) {
            if (!(e instanceof Error) || !e.toString().startsWith("Error: Can't get safe-transaction url")) {
                throw e;
            }
        }
    } else {
        nonceValue = nonce;
    }

    console.log("Will send tx to Gnosis with nonce", nonceValue);

    const tx = {
        "safe": safeAddress,
        "to": multiSend.address,
        "value": 0, // Value in wei
        "data": multiSend.interface.encodeFunctionData("multiSend", [ concatTransactions(transactions) ]),
        "operation": 1,  // 0 CALL, 1 DELEGATE_CALL
        "gasToken": ethers.constants.AddressZero, // Token address (hold by the Safe) to be used as a refund to the sender, if `null` is Ether
        "safeTxGas": 0,  // Max gas to use in the transaction
        "baseGas": 0,  // Gas costs not related to the transaction execution (signature check, refund payment...)
        "gasPrice": 0,  // Gas price used for the refund calculation
        "refundReceiver": ethers.constants.AddressZero, // Address of receiver of gas payment (or `null` if tx.origin)
        "nonce": nonceValue,  // Nonce of the Safe, transaction cannot be executed until Safe's nonce is not equal to this nonce
    }

    const digestHex = getTransactionHash(
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        tx.nonce,
        safeAddress,
        chainId
    )

    const privateKeyBuffer = ethUtil.toBuffer(privateKey);
    const { r, s, v } = ethUtil.ecsign(ethUtil.toBuffer(digestHex), privateKeyBuffer);
    const signature = ethUtil.toRpcSig(v, r, s).toString();

    const txToSend: SafeMultisigTransaction = {
        ...tx,
        "contractTransactionHash": digestHex,  // Contract transaction hash calculated from all the field
        // Owner of the Safe proposing the transaction. Must match one of the signatures
        "sender": ethers.utils.getAddress(ethUtil.bufferToHex(ethUtil.privateToAddress(privateKeyBuffer))),
        "signature": signature,  // One or more ethereum ECDSA signatures of the `contractTransactionHash` as an hex string
        "origin": "Upgrade skale-manager"  // Give more information about the transaction, e.g. "My Custom Safe app"
    }

    return txToSend;
}

export async function sendSafeTransaction(safe: string, chainId: number, safeTx: SafeMultisigTransaction) {
    try {
        console.log("Estimate gas");
        const estimateRequest: SafeMultisigEstimateTx = safeTx;

        try {
            const estimateResponse = await axios.post<SafeMultisigEstimateTxResponseV2>(
                `${getSafeRelayUrl(chainId)}/api/v2/safes/${safe}/transactions/estimate/`,
                estimateRequest
            );
            console.log(chalk.cyan(`Recommend to set gas limit to ${
                parseInt(estimateResponse.data.safeTxGas, 10) + parseInt(estimateResponse.data.baseGas, 10)}`));
        } catch (e) {
            console.log(chalk.red("Failed to estimate gas"));
            console.log(e);
        }

        console.log(chalk.green("Send transaction to gnosis safe"));
        await axios.post(`${getSafeTransactionUrl(chainId)}/api/v1/safes/${safe}/multisig-transactions/`, safeTx)
    } catch (e) {
        if (axios.isAxiosError(e)) {
            if (e.response) {
                console.log(JSON.stringify(e.response.data, null, 4))
                console.log(chalk.red(`Request failed with ${e.response.status} code`));
            } else {
                console.log(chalk.red("Request failed with unknown reason"));
            }
        }
        throw e;
    }
}

// private functions

function getMultiSendAddress(chainId: number) {
    if ([Network.GANACHE, Network.HARDHAT].includes(chainId)) {
        return ethers.constants.AddressZero;
    } else if (Object.keys(ADDRESSES.multiSend).includes(chainId.toString())) {
        return ADDRESSES.multiSend[chainId as keyof typeof ADDRESSES.multiSend];
    } else {
        throw Error(`Can't get multiSend contract at network with chainId = ${chainId}`);
    }
}

function concatTransactions(transactions: string[]) {
    return "0x" + transactions.map( (transaction) => {
        if (transaction.startsWith("0x")) {
            return transaction.slice(2);
        } else {
            return transaction;
        }
    }).join("");
}

async function getSafeNonce(chainId: number, safeAddress: string) {
    const safeInfo = await axios.get<SafeInfoResponse>(`${getSafeTransactionUrl(chainId)}/api/v1/safes/${safeAddress}/`);
    return safeInfo.data.nonce;
}

async function getSafeNonceWithPending(chainId: number, safeAddress: string) {
    const allTransactions = await axios.get<AllTransactionsSchema>(`${getSafeTransactionUrl(chainId)}/api/v1/safes/${safeAddress}/all-transactions/?executed=false&queued=true&trusted=true`);
    if (allTransactions.data.results.length > 0) {
        return allTransactions.data.results[0].nonce + 1;
    } else {
        return 0;
    }
}

function getDomainSeparator(safeAddress: string, chainId: BigNumberish) {
    const DOMAIN_SEPARATOR_TYPEHASH = "0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218";
    return ethers.utils.solidityKeccak256(["bytes"], [
        ethers.utils.defaultAbiCoder.encode(
            ["bytes32", "uint256", "address"],
            [DOMAIN_SEPARATOR_TYPEHASH, chainId, safeAddress])
    ]);
}

function encodeTransactionData(
    to: string,
    value: BigNumberish,
    data: BytesLike,
    operation: number,
    safeTxGas: BigNumberish,
    baseGas: BigNumberish,
    gasPrice: BigNumberish,
    gasToken: string,
    refundReceiver: string,
    _nonce: BigNumberish,
    safeAddress: string,
    chainId: BigNumberish
) {
    const dataHash = ethers.utils.solidityKeccak256(["bytes"], [data]);
    const SAFE_TX_TYPEHASH = "0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8";
    const encoded = ethers.utils.defaultAbiCoder.encode(
        [
            "bytes32",
            "address",
            "uint256",
            "bytes32",
            "uint256",
            "uint256",
            "uint256",
            "uint256",
            "address",
            "address",
            "uint256"
        ],
        [
            SAFE_TX_TYPEHASH,
            to,
            value,
            dataHash,
            operation,
            safeTxGas,
            baseGas,
            gasPrice,
            gasToken,
            refundReceiver,
            _nonce
        ]
    );
    const encodedHash = ethers.utils.solidityKeccak256(["bytes"], [encoded]);
    return ethers.utils.solidityPack(
        ["bytes1", "bytes1", "bytes32", "bytes32"],
        ["0x19", "0x01", getDomainSeparator(safeAddress, chainId), encodedHash]);
}

function getTransactionHash(
    to: string,
    value: BigNumberish,
    data: BytesLike,
    operation: number,
    safeTxGas: BigNumberish,
    baseGas: BigNumberish,
    gasPrice: BigNumberish,
    gasToken: string,
    refundReceiver: string,
    _nonce: BigNumberish,
    safeAddress: string,
    chainId: BigNumberish
) {
    return ethers.utils.solidityKeccak256(["bytes"], [
        encodeTransactionData(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, _nonce, safeAddress, chainId)
    ]);
}
