import {Instance} from "@skalenetwork/skale-contracts-ethers-v6";

export interface ContractToUpgrade {
    proxyAddress: string,
    implementationAddress: string,
    name: string
}

export interface Project {
    name: string;
    instance: Instance;
    version: string;
    contractNamesToUpgrade: string[]
}
