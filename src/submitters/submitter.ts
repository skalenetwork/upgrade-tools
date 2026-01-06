import {Transaction} from "ethers";

export abstract class Submitter {
    protected atomicSubmitter: boolean = false;
    abstract name: string;
    abstract submit(transactions: Transaction[]): Promise<void>;

    isAtomicSubmitter(): Promise<boolean> | boolean {
        return this.atomicSubmitter;
    }
}
