export type Slot = {key:string, value:string};
// eslint-disable-next-line no-magic-numbers
export const ZERO_KEY = `0x${"0".repeat(64)}`;

export interface IClientStrategy {
    dumpStorageForContract(
        contractAddress: string,
        blockHash: string
    ): Promise<Slot[]>;

    getBalance(account: string): Promise<bigint>;
}
