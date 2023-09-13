import {ethers} from "hardhat";
import {UnsignedTransaction} from "ethers";
import {Submitter} from "./submitter";

export class EoaSubmitter extends Submitter {
    name = "EOA Submitter";

    async submit (transactions: UnsignedTransaction[]) {
        EoaSubmitter._atomicityWarning();
        const [deployer] = await ethers.getSigners();
        for (const transaction of transactions) {
            console.log(`Send transaction via ${this.name}`);
            const response = await deployer.sendTransaction({
                "to": transaction.to,
                "value": transaction.value,
                "data": transaction.data
            });
            console.log("Waiting for a transaction" +
                ` with nonce ${response.nonce}`);
            await response.wait();
            console.log("The transaction was sent");
        }
    }
}
