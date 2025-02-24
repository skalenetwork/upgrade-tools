import {Submitter} from "./submitter";
import {Transaction} from "ethers";
import {ethers} from "hardhat";


export class EoaSubmitter extends Submitter {
    name = "EOA Submitter";

    async submit (transactions: Transaction[]) {
        EoaSubmitter.atomicityWarning();
        const [deployer] = await ethers.getSigners();
        let nonce = await deployer.getNonce();
        console.log(`Send transaction via ${this.name}`);

        for (const tx of transactions) {
            /* eslint-disable no-await-in-loop */
            const receipt = await (await deployer.sendTransaction({
                data: tx.data,
                nonce,
                to: tx.to,
                value: tx.value
            })).wait();
            ++nonce;
            console.log(`Sent transaction with hash: ${receipt?.hash}`);
        }

        console.log("All transactions sent and confirmed");
    }
}
