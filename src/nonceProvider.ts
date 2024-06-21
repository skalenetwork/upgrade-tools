import {Signer} from "ethers";

export class NonceProvider {
    currentNonce: number;

    constructor (nonce: number) {
        this.currentNonce = nonce;
    }

    static async createForWallet (signer: Signer) {
        return new NonceProvider(await signer.getNonce());
    }

    reserveNonce () {
        const nonce = this.currentNonce;
        this.currentNonce += 1;
        return nonce;
    }
}
