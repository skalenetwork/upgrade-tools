import "@typechain/hardhat";
import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import {HardhatUserConfig} from "hardhat/config";


const coreArtifacts =
    "node_modules/@openzeppelin/upgrades-core/artifacts/[!b]*.json";

const config: HardhatUserConfig = {
    "typechain": {
        "externalArtifacts": [coreArtifacts],
        "target": "ethers-v6"
    }
};

export default config;
