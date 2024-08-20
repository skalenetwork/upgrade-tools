import {Submitter} from "./submitter";
import {Transaction} from "ethers";
import {createMultiSendTransaction} from "../gnosis-safe";
import {ethers} from "hardhat";


export class SafeSubmitter extends Submitter {
    safeAddress: string;

    chainId: bigint | undefined;

    constructor (safeAddress: string, chainId?: bigint) {
        super();
        this.safeAddress = safeAddress;
        this.chainId = chainId;
    }

    async submit (transactions: Transaction[]): Promise<void> {
        if (!this.chainId) {
            this.chainId = (await ethers.provider.getNetwork()).chainId;
        }
        await createMultiSendTransaction(
            this.safeAddress,
            this.chainId,
            transactions
        );
    }
}
