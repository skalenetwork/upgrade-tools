import { ethers } from "hardhat";
import { UnsignedTransaction } from "ethers";
import { Submitter } from "./Submitter";

class EoaSubmitter implements Submitter {
    async submit(transactions: UnsignedTransaction[]) {
        const [ deployer ] = await ethers.getSigners();
        for (const transaction of transactions) {
            await deployer.sendTransaction(transaction);
        }
    }
}