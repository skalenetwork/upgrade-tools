import {MARIONETTE_ADDRESS, Marionette} from "./types/marionette";
import {SafeToImaSubmitter} from "./safe-to-ima-submitter";
import {Transaction} from "ethers";
import {ethers} from "hardhat";


export class SafeImaMarionetteSubmitter extends SafeToImaSubmitter {
    marionette = new ethers.BaseContract(
        MARIONETTE_ADDRESS,
        new ethers.Interface([
            {
                "inputs": [
                    {
                        "components": [
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
                        "internalType": "struct IMarionette.FunctionCall[]",
                        "name": "functionCalls",
                        "type": "tuple[]"
                    }
                ],
                "name": "encodeFunctionCalls",
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
    ) as Marionette;

    async submit (transactions: Transaction[]): Promise<void> {
        const functionCalls = [];
        for (const transaction of transactions) {
            functionCalls.push({
                "data": transaction.data,
                "receiver": transaction.to ?? ethers.ZeroAddress,
                "value": transaction.value
            });
        }
        await super.submit([Transaction.from({
                "data": ethers.hexlify(await this.marionette.
                    encodeFunctionCalls(functionCalls)),
                "to": await this.marionette.getAddress()
            })
        ]);
    }
}
