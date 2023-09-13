import {HardhatUserConfig} from "hardhat/config";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";

const coreArtifacts =
    "node_modules/@openzeppelin/upgrades-core/artifacts/[!b]*.json";

const config: HardhatUserConfig = {
    "typechain": {
        "target": "ethers-v5",
        "externalArtifacts": [coreArtifacts]
    }
};

export default config;
