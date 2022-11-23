import chalk from "chalk";
import { ethers } from "hardhat";
import { UnsignedTransaction } from "ethers";
import { Submitter } from "./submitter";

export class EoaSubmitter implements Submitter {
    async submit(transactions: UnsignedTransaction[]) {
        this._atomicityWarning();
        const [ deployer ] = await ethers.getSigners();
        for (const transaction of transactions) {
            console.log("Send transaction");
            const response = await deployer.sendTransaction({
                to: transaction.to,
                value: transaction.value,
                data: transaction.data
            });
            console.log(`Waiting for a transaction with nonce ${response.nonce}`);
            await response.wait();
            console.log("The transaction was sent")
        }
    }

    // private

    _atomicityWarning() {
        if(!process.env.ALLOW_NOT_ATOMIC_UPGRADE) {
            console.log(chalk.red("The upgrade will consist of multiple transactions and will not be atomic"));
            console.log(chalk.red("If not atomic upgrade is OK set ALLOW_NOT_ATOMIC_UPGRADE environment variable"));
            process.exit(1);
        } else {
            console.log(chalk.yellow("Not atomic upgrade is performing"));
        }
    }
}