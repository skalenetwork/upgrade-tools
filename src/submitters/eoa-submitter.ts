import {Submitter} from "./submitter";
import {Transaction} from "ethers";
import {ethers} from "hardhat";


export class EoaSubmitter extends Submitter {
    name = "EOA Submitter";

    async submit (transactions: Transaction[]) {
        EoaSubmitter.atomicityWarning();
        const [deployer] = await ethers.getSigners();
        const nonce = await deployer.getNonce();
        console.log(`Send transaction via ${this.name}`);
        const responses =
            await Promise.all(transactions.
                map((transaction, index) => deployer.sendTransaction({
                    "data": transaction.data,
                    "nonce": nonce + index,
                    "to": transaction.to,
                    "value": transaction.value
                })));

        console.log("Waiting for transactions");
        await Promise.all(responses.map((response) => response.wait()));
        console.log("The transactions were sent");
    }
}
