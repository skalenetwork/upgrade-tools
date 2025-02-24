import {Submitter} from "./submitter";
import {Transaction} from "ethers";
import {ethers} from "hardhat";


export class EoaSubmitter extends Submitter {
    name = "EOA Submitter";

    async submit (transactions: Transaction[]) {
        EoaSubmitter.atomicityWarning();
        const [deployer] = await ethers.getSigners();
        console.log(`Send transaction via ${this.name}`);

        /*
         * TODO: Refactor this section.
         * Now sending transactions sequentially.
         * Previously, concurrent eth_estimateGas calls during initialize()
         * could invoke unavailable functions (pre-upgrade), causing failures.
         */
        for (const tx of transactions) {
            /* eslint-disable no-await-in-loop */
            const receipt = await (await deployer.sendTransaction({
                data: tx.data,
                to: tx.to,
                value: tx.value
            })).wait();
            console.log(`Sent transaction with hash: ${receipt?.hash}`);
        }

        console.log("All transactions sent and confirmed");
    }
}
