import { HardhatUserConfig } from "hardhat/config";
import '@typechain/hardhat'
import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: '0.8.13',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    }
                }
            }
        ]
    },
    typechain: {
        externalArtifacts: ['node_modules/@openzeppelin/upgrades-core/artifacts/[!b]*.json']
    }
};

export default config;
