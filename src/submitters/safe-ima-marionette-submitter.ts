import { BigNumberish, BytesLike, UnsignedTransaction } from "ethers";
import { ethers } from "hardhat";
import { ethers as RawEthers } from "ethers"
import { SafeToImaSubmitter } from "./safe-to-ima-submitter";

type FunctionCallStruct = {
    receiver: string;
    value: BigNumberish;
    data: BytesLike;
  };

interface Marionette extends RawEthers.Contract {
    encodeFunctionCalls(
        functionCalls: FunctionCallStruct[]
      ): Promise<BytesLike>
}

export class SafeImaMarionetteSubmitter extends SafeToImaSubmitter {

    marionette = new ethers.Contract(
        "0xD2c0DeFACe000000000000000000000000000000",
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
        ethers.provider) as Marionette;

    async submit(transactions: UnsignedTransaction[]): Promise<void> {
        const functionCalls = []
        for (const transaction of transactions) {
            functionCalls.push({
                receiver: transaction.to ? transaction.to : ethers.constants.AddressZero,
                value: transaction.value ? transaction.value : 0,
                data: (transaction.data ? transaction.data : "0x")
            });
        }
        await super.submit([
            {
                to: this.marionette.address,
                data: await this.marionette.encodeFunctionCalls(functionCalls)
            }
        ]);
    }
}