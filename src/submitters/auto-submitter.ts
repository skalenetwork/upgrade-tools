import {getManifestAdmin} from "@openzeppelin/hardhat-upgrades/dist/admin";
import {Transaction} from "ethers";
import {ProxyAdmin} from "../../typechain-types";
import {Submitter} from "./submitter";
import hre, {ethers} from "hardhat";
import {EoaSubmitter} from "./eoa-submitter";
import {SafeSubmitter} from "./safe-submitter";
import chalk from "chalk";
import {
    SafeImaLegacyMarionetteSubmitter
} from "./safe-ima-legacy-marionette-submitter";
import {MARIONETTE_ADDRESS} from "./types/marionette";
import {skaleContracts} from "@skalenetwork/skale-contracts-ethers-v5";
import {EXIT_CODES} from "../exitCodes";

export class AutoSubmitter extends Submitter {
    name = "Auto Submitter";

    static marionetteInterface = [
        {
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
        }
    ];

    async submit (transactions: Transaction[]) {
        console.log(`Submit via ${this.name}`);
        const submitter = await AutoSubmitter.getSubmitter();
        await submitter.submit(transactions);
    }

    // Private

    private static async getSubmitter () {
        // TODO: remove unknown when move everything to ethers 6
        const proxyAdmin = await getManifestAdmin(hre) as unknown as ProxyAdmin;
        const owner = await proxyAdmin.owner();
        if (await hre.ethers.provider.getCode(owner) === "0x") {
            console.log("Owner is not a contract");
            return new EoaSubmitter();
        }

        console.log("Owner is a contract");
        return AutoSubmitter.getSubmitterForContractOwner(owner);
    }

    private static async getSubmitterForContractOwner (owner: string) {
        if (ethers.utils.getAddress(owner) ===
            ethers.utils.getAddress(MARIONETTE_ADDRESS)) {
            console.log("Marionette owner is detected");

            const imaInstance = await AutoSubmitter._getImaInstance();
            const mainnetChainId = AutoSubmitter._getMainnetChainId();
            const safeAddress = AutoSubmitter._getSafeAddress();
            const schainHash = AutoSubmitter._getSchainHash();

            /*
             * TODO: after marionette has multiSend functionality
             * query version and properly select a submitter
             * based on it
             *
             * if (await this._versionFunctionExists()) {
             *     console.log("version() function was found." +
             *       " Use normal Marionette")
             *     submitter = new SafeImaMarionetteSubmitter(
             *         safeAddress,
             *         imaAbi,
             *         schainHash,
             *         mainnetChainId
             *     )
             * } else {
             *     console.log("No version() function was found." +
             *       " Use legacy Marionette")
             *     submitter = new SafeImaLegacyMarionetteSubmitter(
             *         safeAddress,
             *         imaAbi,
             *         schainHash,
             *         mainnetChainId
             *     )
             * }
             */
            return new SafeImaLegacyMarionetteSubmitter(
                safeAddress,
                imaInstance,
                {
                    mainnetChainId,
                    "targetSchainHash": schainHash
                }
            );
        }

        // Assuming owner is a Gnosis Safe
        console.log("Using Gnosis Safe");

        return new SafeSubmitter(owner);
    }

    private static async _getImaInstance () {
        if (!process.env.IMA) {
            console.log(chalk.red("Set target IMA alias" +
                " to IMA environment variable"));
            process.exit(EXIT_CODES.UNKNOWN_IMA);
        }
        const network =
            await skaleContracts.getNetworkByProvider(ethers.provider);
        const ima = await network.getProject("ima");
        return await ima.getInstance(process.env.IMA);
    }

    private static _getSafeAddress () {
        if (!process.env.SAFE_ADDRESS) {
            console.log(chalk.red("Set Gnosis Safe owner address" +
                " to SAFE_ADDRESS environment variable"));
            process.exit(EXIT_CODES.UNKNOWN_SAFE_ADDRESS);
        }
        return process.env.SAFE_ADDRESS;
    }

    private static _getSchainHash () {
        // Query Context to get schain hash
        if (process.env.SCHAIN_HASH) {
            return process.env.SCHAIN_HASH;
        }
        if (process.env.SCHAIN_NAME) {
            return ethers.utils.solidityKeccak256(
                ["string"],
                [process.env.SCHAIN_NAME]
            );
        }
        console.log(chalk.red("Set schain name" +
            " to SCHAIN_NAME environment variable"));
        console.log(chalk.red("or schain hash" +
            " to SCHAIN_HASH environment variable"));
        throw Error("Schain is not set");
    }

    private static _getMainnetChainId () {
        if (process.env.MAINNET_CHAIN_ID) {
            return Number.parseInt(process.env.MAINNET_CHAIN_ID);
        }
        console.log(chalk.red("Set chainId of mainnet" +
            " to MAINNET_CHAIN_ID environment variable"));
        console.log(chalk.red("Use 1 for Ethereum mainnet" +
            " or 5 for Goerli"));
        throw Error("Mainnet chainId is not set");
    }

    private static async _versionFunctionExists () {
        const bytecode = await hre.ethers.provider.getCode(MARIONETTE_ADDRESS);
        const hexPrefixLength = 2;
        const selectorLength = 10;

        /*
         * If the bytecode doesn't include the function selector version()
         * is definitely not present
         */
        if (!bytecode.includes(ethers.utils.id("version()").slice(
            hexPrefixLength,
            selectorLength
        ))) {
            return false;
        }

        const marionette = new ethers.Contract(
            MARIONETTE_ADDRESS,
            AutoSubmitter.marionetteInterface,
            hre.ethers.provider
        );

        /*
         * If gas estimation doesn't revert then an execution is possible
         * given the provided function selector
         */
        try {
            await marionette.estimateGas.version();
            return true;
        } catch {
            /*
             * Otherwise (revert) we assume
             * that there is no entry in the jump table
             * meaning that the contract doesn't include version()
             */
            return false;
        }
    }
}
