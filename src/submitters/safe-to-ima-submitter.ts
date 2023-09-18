import {BytesLike, Contract, UnsignedTransaction} from "ethers";
import {SafeSubmitter} from "./safe-submitter";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v5";

interface Network {
    targetSchainHash: BytesLike,
    mainnetChainId?: number
}

export class SafeToImaSubmitter extends SafeSubmitter {
    imaInstance: Instance;

    targetSchainHash: BytesLike;

    private _messageProxyForMainnet: Contract | undefined;

    constructor (
        safeAddress: string,
        imaInstance: Instance,
        network: Network
    ) {
        super(
            safeAddress,
            network.mainnetChainId
        );
        this.imaInstance = imaInstance;
        this.targetSchainHash = network.targetSchainHash;
    }

    async submit (transactions: UnsignedTransaction[]): Promise<void> {
        const singleTransaction = 1;
        if (transactions.length > singleTransaction) {
            SafeToImaSubmitter._atomicityWarning();
        }
        const messageProxyForMainnet = await this._getMessageProxyForMainnet();
        const transactionsToIma = transactions.map((transaction) => ({
            "to": messageProxyForMainnet.address,
            "data": messageProxyForMainnet.interface.encodeFunctionData(
                "postOutgoingMessage",
                [
                    this.targetSchainHash,
                    transaction.to,
                    transaction.data
                ]
            )
        }));
        await super.submit(transactionsToIma);
    }

    private async _getMessageProxyForMainnet () {
        if (this._messageProxyForMainnet === undefined) {
            this._messageProxyForMainnet =
                await this.imaInstance.getContract("MessageProxyForMainnet");
        }
        return this._messageProxyForMainnet;
    }
}
