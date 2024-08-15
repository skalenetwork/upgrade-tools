import {LegacyMarionette, MARIONETTE_ADDRESS} from "./types/marionette";
import {SafeToImaSubmitter} from "./safe-to-ima-submitter";
import {Transaction} from "ethers";
import {ethers} from "hardhat";


export class SafeImaLegacyMarionetteSubmitter extends SafeToImaSubmitter {
    marionette = new ethers.BaseContract(
        MARIONETTE_ADDRESS,
        new ethers.Interface([
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
    ) as LegacyMarionette;

    async submit (transactions: Transaction[]): Promise<void> {
        const singleTransaction = 1;
        if (transactions.length > singleTransaction) {
            SafeImaLegacyMarionetteSubmitter.atomicityWarning();
        }
        const marionetteAddress = await this.marionette.getAddress();
        const transactionsToMarionette =
            (await Promise.all(transactions.
                map((transaction) => this.marionette.encodeFunctionCall(
                    transaction.to ?? ethers.ZeroAddress,
                    transaction.value ,
                    transaction.data
                )))
            ).map((data) => Transaction.from({
                "data": ethers.hexlify(data),
                "to": marionetteAddress
            }));

        await super.submit(transactionsToMarionette);
    }
}
