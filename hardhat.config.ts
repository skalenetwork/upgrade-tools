import "@typechain/hardhat";
import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import {HardhatUserConfig} from "hardhat/config";


const coreArtifacts =
    "node_modules/@openzeppelin/upgrades-core/artifacts/[!b]*.json";

const config: HardhatUserConfig = {
    "typechain": {
        "target": "ethers-v5",
        "externalArtifacts": [coreArtifacts]
    }
};

export default config;
