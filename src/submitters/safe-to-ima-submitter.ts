import { BytesLike, Contract, UnsignedTransaction } from "ethers";
import { ethers } from "hardhat";
import { SkaleABIFile } from "../types/SkaleABIFile";
import { SafeSubmitter } from "./safe-submitter";

export class SafeToImaSubmitter extends SafeSubmitter {
    messageProxyForMainnet: Contract;
    targetSchainHash: BytesLike;

    constructor(safeAddress: string, imaAbi: SkaleABIFile, targetSchainHash: BytesLike, chainId?: number) {
        super(safeAddress, chainId);
        this.messageProxyForMainnet = new ethers.Contract(
            imaAbi["message_proxy_mainnet_address"] as string,
            new ethers.utils.Interface(imaAbi["message_proxy_mainnet_address"]));
        this.targetSchainHash = targetSchainHash;
    }

    async submit(transactions: UnsignedTransaction[]): Promise<void> {
        const transactionsToIma = transactions.map((transaction) => {
            return {
                to: this.messageProxyForMainnet.address,
                data: this.messageProxyForMainnet.interface.encodeFunctionData(
                    "postOutgoingMessage",
                    [this.targetSchainHash, transaction.to, transaction.data])
                }
        });
        await super.submit(transactionsToIma);
    }
}