import {Submitter} from "./submitter";
import {UnsignedTransaction} from "ethers";
import {ethers} from "hardhat";


export class EoaSubmitter extends Submitter {
    name = "EOA Submitter";

    async submit (transactions: UnsignedTransaction[]) {
        EoaSubmitter.atomicityWarning();
        const [deployer] = await ethers.getSigners();
        const nonce = await deployer.getTransactionCount();
        console.log(`Send transaction via ${this.name}`);
        const responses =
            await Promise.all(transactions.
                map((transaction, index) => deployer.sendTransaction({
                    "to": transaction.to,
                    "value": transaction.value,
                    "data": transaction.data,
                    "nonce": nonce + index
                })));

        console.log("Waiting for transactions");
        await Promise.all(responses.map((response) => response.wait()));
        console.log("The transactions were sent");
    }
}
