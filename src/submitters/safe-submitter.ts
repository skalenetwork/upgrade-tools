import { BigNumber, UnsignedTransaction } from "ethers";
import { ethers, network } from "hardhat";
import { createMultiSendTransaction, sendSafeTransaction } from "../gnosis-safe";
import { encodeTransaction } from "../multiSend";
import { Submitter } from "./submitter";

export class SafeSubmitter extends Submitter {
    safeAddress: string;
    chainId: number | undefined;

    constructor(safeAddress: string, chainId?: number) {
        super();
        this.safeAddress = safeAddress;
        this.chainId = chainId;
    }

    async submit(transactions: UnsignedTransaction[]): Promise<void> {
        const safeTransactions: string[] = [];
        for (const transaction of transactions) {
            safeTransactions.push(encodeTransaction(
                0,
                transaction.to ? transaction.to : ethers.constants.AddressZero,
                transaction.value ? BigNumber.from(transaction.value) : 0,
                transaction.data ? transaction.data.toString() : "0x"
            ))
        }

        let privateKey = (network.config.accounts as string[])[0];
        if (network.config.accounts === "remote") {
            // Don't have an information about private key
            // Use random one because we most probable run tests
            privateKey = ethers.Wallet.createRandom().privateKey;
        }

        const safeTx = await createMultiSendTransaction(ethers, this.safeAddress, privateKey, safeTransactions);

        if (!this.chainId) {
            this.chainId = (await ethers.provider.getNetwork()).chainId;
        }
        await sendSafeTransaction(this.safeAddress, this.chainId, safeTx);
    }
}