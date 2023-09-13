import {ManifestData} from "@openzeppelin/upgrades-core";

export interface SkaleManifestData extends ManifestData {
    libraries?: {
        [libraryName: string]: {
            address: string
            bytecodeHash: string
        }
    }
}
