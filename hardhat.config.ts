import { HardhatUserConfig } from "hardhat/config";
import '@typechain/hardhat'
import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
    typechain: {
        externalArtifacts: ['node_modules/@openzeppelin/upgrades-core/artifacts/[!b]*.json']
    }
};

export default config;
