import {IClientStrategy, Slot, ZERO_KEY} from "./iClientStrategy";
import {JsonRpcProvider} from "ethers";
const DEFAULT_TX_INDEX = 0;

/*
 * Changing might produce unwanted behavior for erigon
 * NextKey in erigon is the original (preimage) key, and not the hashed in.
 * However, when requesting multiple slots, they do not appear to be ordered by original slot key
 * For predictable behavior, maintain at 1
 */
const DEFAULT_N_SLOTS_TO_FETCH = 1;

export class ErigonClientStrategy implements IClientStrategy{
    private provider: JsonRpcProvider;

    constructor(provider: JsonRpcProvider){
        this.provider = provider;
    }

    async dumpStorageForContract(
        contractAddress: string,
        blockHash: string
    ): Promise<Slot[]> {
        let startSlot = ZERO_KEY;
        const slots: Slot[] = [];
        // eslint-disable-next-line no-constant-condition
        while (startSlot) {
            // eslint-disable-next-line no-await-in-loop
            const {storage, nextKey} = await this.provider.send(
                'debug_storageRangeAt',
                [
                    blockHash,
                    DEFAULT_TX_INDEX,
                    contractAddress,
                    startSlot,
                    DEFAULT_N_SLOTS_TO_FETCH
                ]
            );
            Object.entries(storage).forEach((entry) => {
                // eslint-disable-next-line no-magic-numbers
                const slot = entry[1] as Slot;
                if ( slot.key !== null ) {
                    slots.push(slot);
                }
            });

            startSlot = nextKey;
        }
        return slots;
    }

    async getBalance(account: string) {
        return await this.provider.getBalance(account);
    }
}
