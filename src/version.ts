import { exec as asyncExec } from "child_process";
import { promises as fs } from "fs";
import util from "util";


const exec = util.promisify(asyncExec);

export const getVersion = async () => {
    if (process.env.VERSION) {
        return process.env.VERSION;
    }
    try {
        const tag = (await exec("git describe --tags")).stdout.trim();
        return tag;
    } catch {
        return (await fs.readFile(
            "VERSION",
            "utf-8"
        )).trim();
    }
};
