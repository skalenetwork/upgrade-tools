import {BaseContract, BytesLike, Transaction} from "ethers";
import {Instance} from "@skalenetwork/skale-contracts-ethers-v6";
import {SafeSubmitter} from "./safe-submitter";


interface Network {
    targetSchainHash: BytesLike,
    mainnetChainId?: bigint
}

export class SafeToImaSubmitter extends SafeSubmitter {
    name = "Safe to IMA Submitter";
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
        // Although transactions are atomic on mainnet side, they are not atomic on schain side.
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
