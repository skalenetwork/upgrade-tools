import {Transaction, ethers} from "ethers";
import {EXIT_CODES} from "../exitCodes";
import {EoaSubmitter} from "./eoa-submitter";
import {MARIONETTE_ADDRESS} from "./types/marionette";
import {
    SafeImaLegacyMarionetteSubmitter
} from "./safe-ima-legacy-marionette-submitter";
import {SafeSubmitter} from "./safe-submitter";
import {Submitter} from "./submitter";
import {Upgrader} from "../upgrader";
import chalk from "chalk";
import hre from "hardhat";
import {skaleContracts} from "@skalenetwork/skale-contracts-ethers-v6";


export class AutoSubmitter extends Submitter {
    name = "Auto Submitter";
    upgrader: Upgrader

    constructor (
        upgrader: Upgrader
    ) {
        super();
        this.upgrader = upgrader
    }

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
        const submitter = await this.getSubmitter();
        await submitter.submit(transactions);
    }

    // Private

    private async getSubmitter () {
        const owner = await this.upgrader.getOwner();
        if (await hre.ethers.provider.getCode(owner) === "0x") {
            console.log("Owner is not a contract");
            return new EoaSubmitter();
        }

        console.log("Owner is a contract");
        return AutoSubmitter.getSubmitterForContractOwner(owner);
    }

    private static async getSubmitterForContractOwner (owner: string) {
        const mainnetChainId = AutoSubmitter.getMainnetChainId();
        if (ethers.getAddress(owner) ===
            ethers.getAddress(MARIONETTE_ADDRESS)) {
            console.log("Marionette owner is detected");

            const imaInstance = await AutoSubmitter.getImaInstance();
            const safeAddress = AutoSubmitter.getSafeAddress();
            const schainHash = AutoSubmitter.getSchainHash();

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

        return new SafeSubmitter(owner, mainnetChainId);
    }

    private static async getImaInstance () {
        if (!process.env.IMA) {
            console.log(chalk.red("Set target IMA alias" +
                " to IMA environment variable"));
            process.exit(EXIT_CODES.UNKNOWN_IMA);
        }
        const contractsNetwork =
            await skaleContracts.getNetworkByProvider(hre.ethers.provider);
        const ima = await contractsNetwork.getProject("ima");
        return await ima.getInstance(process.env.IMA);
    }

    private static getSafeAddress () {
        if (!process.env.SAFE_ADDRESS) {
            console.log(chalk.red("Set Gnosis Safe owner address" +
                " to SAFE_ADDRESS environment variable"));
            process.exit(EXIT_CODES.UNKNOWN_SAFE_ADDRESS);
        }
        return process.env.SAFE_ADDRESS;
    }

    private static getSchainHash () {
        // Query Context to get schain hash
        if (process.env.SCHAIN_HASH) {
            return process.env.SCHAIN_HASH;
        }
        if (process.env.SCHAIN_NAME) {
            return ethers.solidityPackedKeccak256(
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

    private static getMainnetChainId () {
        if (process.env.MAINNET_CHAIN_ID) {
            return BigInt(process.env.MAINNET_CHAIN_ID);
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
        if (!bytecode.includes(ethers.id("version()").slice(
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
            await marionette.version.estimateGas();
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
