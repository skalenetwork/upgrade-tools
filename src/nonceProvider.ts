import {Signer} from "ethers";

export class NonceProvider {
    currentNonce: number;
    releasedNonces: number[];

    constructor (nonce: number) {
        this.currentNonce = nonce;
        this.releasedNonces = [];
    }

    static async createForWallet (signer: Signer) {
        return new NonceProvider(await signer.getNonce());
    }

    reserveNonce () {
        if (!this.releasedNonces) {
            const nonce = this.currentNonce;
            this.currentNonce += 1;
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
