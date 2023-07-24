import { getManifestAdmin } from "@openzeppelin/hardhat-upgrades/dist/admin";
import { UnsignedTransaction } from "ethers";
import { ProxyAdmin } from "../../typechain-types";
import { Submitter } from "./submitter";
import hre, { ethers } from "hardhat";
import { EoaSubmitter } from "./eoa-submitter";
import { SafeSubmitter } from "./safe-submitter";
import chalk from "chalk";
import { SafeImaLegacyMarionetteSubmitter } from "./safe-ima-legacy-marionette-submitter";
import { SkaleABIFile } from "../types/SkaleABIFile";
import { promises as fs } from 'fs';
import { Marionette, MARIONETTE_ADDRESS } from "./types/marionette";

export class AutoSubmitter extends Submitter {

    async submit(transactions: UnsignedTransaction[]) {
        let submitter: Submitter;
        const proxyAdmin = await getManifestAdmin(hre) as ProxyAdmin;
        const owner = await proxyAdmin.owner();
        if (await hre.ethers.provider.getCode(owner) === "0x") {
            console.log("Owner is not a contract");
            submitter = new EoaSubmitter();
        } else {
            console.log("Owner is a contract");

            if (ethers.utils.getAddress(owner) == ethers.utils.getAddress(MARIONETTE_ADDRESS)) {
                console.log("Marionette owner is detected");

                const imaAbi = await this._getImaAbi();
                const safeAddress = this._getSafeAddress();
                const schainHash = this._getSchainHash();
                const mainnetChainId = this._getMainnetChainId();

                // TODO: after marionette has multiSend functionality
                // query version and properly select a submitter
                // based on it
                //
                // if (await this._versionFunctionExists()) {
                //     console.log("version() function was found. Use normal Marionette")
                //     submitter = new SafeImaMarionetteSubmitter(
                //         safeAddress,
                //         imaAbi,
                //         schainHash,
                //         mainnetChainId
                //     )
                // } else {
                //     console.log("No version() function was found. Use legacy Marionette")
                //     submitter = new SafeImaLegacyMarionetteSubmitter(
                //         safeAddress,
                //         imaAbi,
                //         schainHash,
                //         mainnetChainId
                //     )
                // }

                submitter = new SafeImaLegacyMarionetteSubmitter(
                    safeAddress,
                    imaAbi,
                    schainHash,
                    mainnetChainId
                )

            } else {
                // assuming owner is a Gnosis Safe
                console.log("Using Gnosis Safe");

                submitter = new SafeSubmitter(owner);
            }
        }
        await submitter.submit(transactions);
    }

    // private

    async _getImaAbi() {
        if (!process.env.IMA_ABI) {
            console.log(chalk.red("Set path to ima abi to IMA_ABI environment variable"));
            process.exit(1);
        }
        return JSON.parse(await fs.readFile(process.env.IMA_ABI, "utf-8")) as SkaleABIFile;
    }

    _getSafeAddress() {
        if (!process.env.SAFE_ADDRESS) {
            console.log(chalk.red("Set Gnosis Safe owner address to SAFE_ADDRESS environment variable"));
            process.exit(1);
        }
        return process.env.SAFE_ADDRESS;
    }

    _getSchainHash() {
        // query Context to get schain hash
        if (!process.env.SCHAIN_HASH) {
            if (!process.env.SCHAIN_NAME) {
                console.log(chalk.red("Set schain name to SCHAIN_NAME environment variable"));
                console.log(chalk.red("or schain hash to SCHAIN_HASH environment variable"));
                process.exit(1);
            } else {
                return ethers.utils.solidityKeccak256(["string"], [process.env.SCHAIN_NAME]);
            }
        } else {
            return process.env.SCHAIN_HASH;
        }
    }

    _getMainnetChainId() {
        if (!process.env.MAINNET_CHAIN_ID) {
            console.log(chalk.red("Set chainId of mainnet to MAINNET_CHAIN_ID environment variable"));
            console.log(chalk.red("Use 1 for Ethereum mainnet or 5 for Goerli"));
            process.exit(1);
        } else {
            return Number.parseInt(process.env.MAINNET_CHAIN_ID);
        }
    }

    async _versionFunctionExists() {
        const bytecode = await hre.ethers.provider.getCode(MARIONETTE_ADDRESS);

        // If the bytecode doesn't include the function selector version()
        // is definitely not present
        if (!bytecode.includes(ethers.utils.id("version()").slice(2, 10))) {
            return false;
        }

        const marionette = new ethers.Contract(
            MARIONETTE_ADDRESS,
            [{
                "inputs": [],
                "name": "version",
                "outputs": [
                  {
                    "internalType": "string",
                    "name": "",
                    "type": "string"
                  }
                ],
                "stateMutability": "view",
                "type": "function"
            }],
            hre.ethers.provider) as Marionette;

        // If gas estimation doesn't revert then an execution is possible
        // given the provided function selector
        try {
            await marionette.estimateGas.version();
            return true;
        } catch {
            // Otherwise (revert) we assume that there is no entry in the jump table
            // meaning that the contract doesn't include version()
            return false;
        }
    }
}