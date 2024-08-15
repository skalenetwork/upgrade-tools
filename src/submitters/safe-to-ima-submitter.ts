import {BaseContract, BytesLike, Transaction} from "ethers";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v6";
import {SafeSubmitter} from "./safe-submitter";


interface Network {
    targetSchainHash: BytesLike,
    mainnetChainId?: bigint
}

export class SafeToImaSubmitter extends SafeSubmitter {
    imaInstance: Instance;

    targetSchainHash: BytesLike;

    private messageProxyForMainnet: BaseContract | undefined;

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

    async submit (transactions: Transaction[]): Promise<void> {
        const singleTransaction = 1;
        if (transactions.length > singleTransaction) {
            SafeToImaSubmitter.atomicityWarning();
        }
        const messageProxyForMainnet = await this.getMessageProxyForMainnet();
        const messageProxyForMainnetAddress = await messageProxyForMainnet.getAddress();
        const transactionsToIma = transactions.map((transaction) => Transaction.from({
            "data": messageProxyForMainnet.interface.encodeFunctionData(
                "postOutgoingMessage",
                [
                    this.targetSchainHash,
                    transaction.to,
                    transaction.data
                ]
            ),
            "to": messageProxyForMainnetAddress
        }));
        await super.submit(transactionsToIma);
    }

    private async getMessageProxyForMainnet () {
        if (typeof this.messageProxyForMainnet === "undefined") {
            this.messageProxyForMainnet =
                await this.imaInstance.getContract("MessageProxyForMainnet");
        }
        return this.messageProxyForMainnet;
    }
}
