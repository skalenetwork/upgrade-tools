import { exec as asyncExec } from "child_process";
import { promises as fs, existsSync } from "fs";
import util from "util";


const exec = util.promisify(asyncExec);

class VersionNotFound extends Error {}

async function getVersionFilename(folder?: string) {
    if (folder === undefined) {
        return getVersionFilename(
            (await exec("git rev-parse --show-toplevel")).stdout.trim()
        );
    }
    const
        VERSION_FILENAME = 'VERSION',
        path = `${folder}/${VERSION_FILENAME}`;
    if (existsSync(path)) {
        return path;
    }
    for (const entry of await fs.readdir(folder, { withFileTypes: true, recursive: true })) {
        if (entry.isFile() && entry.name === VERSION_FILENAME ) {
            return `${entry.path}/${entry.name}`;
        }
    }
    throw new VersionNotFound("Can't find version file");
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
