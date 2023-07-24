import { BytesLike, UnsignedTransaction } from "ethers";
import { ethers } from "hardhat";
import { SafeToImaSubmitter } from "./safe-to-ima-submitter";
import { MARIONETTE_ADDRESS } from "./types/marionette";

export class SafeImaLegacyMarionetteSubmitter extends SafeToImaSubmitter {
    marionette = new ethers.Contract(
        MARIONETTE_ADDRESS,
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
        ]),
        ethers.provider);

    async submit(transactions: UnsignedTransaction[]): Promise<void> {
        if (transactions.length > 1) {
            this._atomicityWarning();
        }
        const transactionsToMarionette = []
        for (const transaction of transactions) {
            transactionsToMarionette.push({
                to: this.marionette.address,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                data: await this.marionette.encodeFunctionCall(
                    transaction.to ? transaction.to : ethers.constants.AddressZero,
                    transaction.value ? transaction.value : 0,
                    transaction.data ? transaction.data : "0x") as BytesLike
            });
        }
        await super.submit(transactionsToMarionette);
    }
}