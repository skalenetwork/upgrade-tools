import {Transaction} from "ethers";

export abstract class Submitter {
    abstract name: string;
    abstract submit(transactions: Transaction[]): Promise<void>;
    abstract isAtomicSubmitter(): Promise<boolean> | boolean;
}
