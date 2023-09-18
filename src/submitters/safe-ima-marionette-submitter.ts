import {MARIONETTE_ADDRESS, Marionette} from "./types/marionette";
import {SafeToImaSubmitter} from "./safe-to-ima-submitter";
import {UnsignedTransaction} from "ethers";
import {ethers} from "hardhat";


export class SafeImaMarionetteSubmitter extends SafeToImaSubmitter {
    marionette = new ethers.Contract(
        MARIONETTE_ADDRESS,
        new ethers.utils.Interface([
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

    async submit (transactions: UnsignedTransaction[]): Promise<void> {
        const functionCalls = [];
        const zeroValue = 0;
        for (const transaction of transactions) {
            functionCalls.push({
                "data": transaction.data ?? "0x",
                "receiver": transaction.to ?? ethers.constants.AddressZero,
                "value": transaction.value ?? zeroValue
            });
        }
        await super.submit([
            {
                "to": this.marionette.address,
                "data": await this.marionette.encodeFunctionCalls(functionCalls)
            }
        ]);
    }
}
