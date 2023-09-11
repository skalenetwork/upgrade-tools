import { exec as asyncExec } from "child_process";
import { dirname } from "path";
import { promises as fs, existsSync } from "fs";
import util from "util";


const exec = util.promisify(asyncExec);

async function getVersionFilename(folder?: string) {
    if (folder === undefined) {
        return getVersionFilename(process.cwd());
    }
    const path = `${folder}/VERSION`;
    if (existsSync(path)) {
        return path;
    }
    if (folder === '/') {
        throw Error("Can't find version file");
    }
    return getVersionFilename(dirname(folder));
}

export const getVersion = async () => {
    if (process.env.VERSION) {
        return process.env.VERSION;
    }
    try {
        const tag = (await exec("git describe --tags")).stdout.trim();
        return tag;
    } catch {
        return (await fs.readFile(await getVersionFilename(), "utf-8")).trim();
    }
};
