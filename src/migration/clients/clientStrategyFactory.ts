import {ErigonClientStrategy} from "./erigonClientStrategy";
import {GethClientStrategy} from "./gethClientStrategy";
import {JsonRpcProvider} from "ethers";

export enum Client {
    GETH = "geth",
    ERIGON = "erigon"
}

export const clientStrategyFactory = (clientType: Client, provider: JsonRpcProvider) => {
    switch (clientType) {
        case Client.GETH:
            return new GethClientStrategy(provider);
        case Client.ERIGON:
            return new ErigonClientStrategy(provider);

        default:
            throw Error(`Unable to create Client ${clientType}`);
    }
}
