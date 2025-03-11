import Semaphore from 'semaphore-async-await';
import {Signer} from "ethers";

const MAX_CONCURRENT_NOUNCE_REQUESTS = 1;
export class NonceProvider {
    currentNonce: number;
    releasedNonces: number[];
    semaphore: Semaphore;

    constructor (nonce: number) {
        this.currentNonce = nonce;
        this.releasedNonces = [];
        this.semaphore = new Semaphore(MAX_CONCURRENT_NOUNCE_REQUESTS);
    }

    static async createForWallet (signer: Signer) {
        return new NonceProvider(await signer.getNonce());
    }

    async reserveNonce () {
        if (!this.releasedNonces.length) {
            let nonce = this.currentNonce;
            try {
                await this.semaphore.acquire()
                nonce = this.currentNonce;
                this.currentNonce += 1;
            }
            finally {
                this.semaphore.release();
            }
            return nonce;
        }
        return this.releasedNonces.shift();
    }

    releaseNonce (nonce: number) {
        if (NonceProvider.next(nonce) === this.currentNonce) {
            this.currentNonce -= 1;
        } else {
            this.releasedNonces.push(nonce);
        }
    }

    private static next (nonce: number) {
        const nextDiff = 1;
        return nonce + nextDiff;
    }
}
