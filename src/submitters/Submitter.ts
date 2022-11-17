import { UnsignedTransaction } from "ethers";

export interface Submitter {
    submit(transactions: UnsignedTransaction[]): Promise<void>;
}