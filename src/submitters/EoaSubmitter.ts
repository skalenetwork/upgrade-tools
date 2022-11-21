import { ethers } from "hardhat";
import { UnsignedTransaction } from "ethers";
import { Submitter } from "./Submitter";

export class EoaSubmitter implements Submitter {
    async submit(transactions: UnsignedTransaction[]) {
        const [ deployer ] = await ethers.getSigners();
        for (const transaction of transactions) {
            const response = await deployer.sendTransaction({
                to: transaction.to,
                value: transaction.value,
                data: transaction.data
            });
            await response.wait();
        }
    }
}