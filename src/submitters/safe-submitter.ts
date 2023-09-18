import {Submitter} from "./submitter";
import {UnsignedTransaction} from "ethers";
import {createMultiSendTransaction} from "../gnosis-safe";
import {ethers} from "hardhat";


export class SafeSubmitter extends Submitter {
    safeAddress: string;

    chainId: number | undefined;

    constructor (safeAddress: string, chainId?: number) {
        super();
        this.safeAddress = safeAddress;
        this.chainId = chainId;
    }

    async submit (transactions: UnsignedTransaction[]): Promise<void> {
        if (!this.chainId) {
            this.chainId = (await ethers.provider.getNetwork()).chainId;
        }
        await createMultiSendTransaction(
            this.safeAddress,
            transactions
        );
    }
}
