import {BytesLike, UnsignedTransaction} from "ethers";
import {ethers} from "hardhat";
import {SafeToImaSubmitter} from "./safe-to-ima-submitter";
import {MARIONETTE_ADDRESS} from "./types/marionette";

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
        ethers.provider
    );

    async submit (transactions: UnsignedTransaction[]): Promise<void> {
        const singleTransaction = 1;
        if (transactions.length > singleTransaction) {
            SafeImaLegacyMarionetteSubmitter.atomicityWarning();
        }
        const zeroValue = 0;
        const transactionsToMarionette =
            (await Promise.all(transactions.
                map((transaction) => this.marionette.encodeFunctionCall(
                    transaction.to ?? ethers.constants.AddressZero,
                    transaction.value ?? zeroValue,
                    transaction.data ?? "0x"
                ) as Promise<BytesLike>))
            ).map((data) => ({
                data,
                "to": this.marionette.address
            }));

        await super.submit(transactionsToMarionette);
    }
}
