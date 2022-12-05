import { BytesLike, UnsignedTransaction } from "ethers";
import { ethers } from "hardhat";
import { SafeToImaSubmitter } from "./safe-to-ima-submitter";

export class SafeImaLegacyMarionetteSubmitter extends SafeToImaSubmitter {
    marionette = new ethers.Contract(
        "0xD2c0DeFACe000000000000000000000000000000",
        new ethers.utils.Interface([
            {
                "inputs": [
                    {
                        "internalType": "address",
                        "name": "receiver",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "value",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bytes",
                        "name": "data",
                        "type": "bytes"
                    }
                ],
                "name": "encodeFunctionCall",
                "outputs": [
                    {
                        "internalType": "bytes",
                        "name": "",
                        "type": "bytes"
                    }
                ],
                "stateMutability": "pure",
                "type": "function"
            }
        ]));

    async submit(transactions: UnsignedTransaction[]): Promise<void> {
        if (transactions.length > 1) {
            this._atomicityWarning();
        }
        const transactionsToMarionette = []
        for (const transaction of transactions) {
            transactionsToMarionette.push({
                to: this.marionette.address,
                data: await this.marionette.functions["encodeFunctionCall"].call(
                    transaction.to ? transaction.to : ethers.constants.AddressZero,
                    transaction.value ? transaction.value : 0,
                    transaction.data ? transaction.data : "0x") as BytesLike
            });
        }
        await super.submit(transactionsToMarionette);
    }
}