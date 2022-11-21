import { getManifestAdmin } from "@openzeppelin/hardhat-upgrades/dist/admin";
import { UnsignedTransaction } from "ethers";
import { ProxyAdmin } from "../../typechain-types";
import { Submitter } from "./Submitter";
import hre from "hardhat";
import { EoaSubmitter } from "./EoaSubmitter";
import { SafeSubmitter } from "./SafeSubmitter";

export class AutoSubmitter implements Submitter {

    async submit(transactions: UnsignedTransaction[]) {
        let submitter: Submitter;
        const proxyAdmin = await getManifestAdmin(hre) as ProxyAdmin;
        const owner = await proxyAdmin.owner();
        if (await hre.ethers.provider.getCode(owner) === "0x") {
            console.log("Owner is not a contract");
            submitter = new EoaSubmitter();
        } else {
            console.log("Owner is a contract");
            // TODO: add support of Marionette

            submitter = new SafeSubmitter(owner);
        }
        await submitter.submit(transactions);
    }
}