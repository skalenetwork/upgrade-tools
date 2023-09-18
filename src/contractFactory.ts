import {artifacts, ethers} from "hardhat";
import {
    deployLibraries,
    getLinkedContractFactory,
    getManifestFile
} from "./deploy";
import {LinkReferences} from "hardhat/types";
import {SkaleManifestData} from "./types/SkaleManifestData";
import {promises as fs} from "fs";
import {hashBytecode} from "@openzeppelin/upgrades-core";


const getSkaleManifest = async () => {
    const manifest = JSON.parse(await fs.readFile(
        await getManifestFile(),
        "utf-8"
    ));
    if (typeof manifest.libraries === "undefined") {
        manifest.libraries = {};
    }
    return manifest as SkaleManifestData;
};

const loadBytesCodes = async (libraryNames: string[]) => {
    const byteCodes = new Map<string, string>();

    (await Promise.
        all(libraryNames.map((libraryName) => (async () => {
            const {bytecode} = await artifacts.readArtifact(libraryName);
            return [
                libraryName,
                bytecode
            ];
        })()))).forEach(([
        libraryName,
        bytecode
    ]) => {
        byteCodes.set(
            libraryName,
            bytecode
        );
    });
    return byteCodes;
};

const updateManifest = async (
    manifest: SkaleManifestData,
    libraries: Map<string, string>,
    oldLibraries: {[k: string]: string}
) => {
    const byteCodes = await loadBytesCodes(Array.from(libraries.keys()));
    for (const [
        libraryName,
        libraryAddress
    ] of libraries.entries()) {
        manifest.libraries[libraryName] = {
            "address": libraryAddress,
            "bytecodeHash": hashBytecode(byteCodes.get(libraryName) as string)
        };
    }
    Object.assign(
        libraries,
        oldLibraries
    );
    const indentation = 4;
    await fs.writeFile(
        await getManifestFile(),
        JSON.stringify(
            manifest,
            null,
            indentation
        )
    );
};

export const getLibrariesNames = (linkReferences: LinkReferences) => {
    const libraryNames = [];
    for (const libraryFile of Object.values(linkReferences)) {
        libraryNames.push(...Object.keys(libraryFile));
    }
    return libraryNames;
};

const getLibrariesToUpgrade = async (
    manifest: SkaleManifestData,
    linkReferences: LinkReferences
) => {
    const librariesToUpgrade = [];
    const oldLibraries: {[k: string]: string} = {};
    const librariesNames = getLibrariesNames(linkReferences);
    const byteCodes = await loadBytesCodes(librariesNames);
    for (const libraryName of librariesNames) {
        if (typeof manifest.libraries[libraryName] === "undefined") {
            librariesToUpgrade.push(libraryName);
        } else if (
            hashBytecode(byteCodes.get(libraryName) as string) ===
                manifest.libraries[libraryName].bytecodeHash
        ) {
            oldLibraries[libraryName] =
                    manifest.libraries[libraryName].address;
        } else {
            librariesToUpgrade.push(libraryName);
        }
    }
    return {
        librariesToUpgrade,
        oldLibraries
    };
};

export const getContractFactoryAndUpdateManifest = async (contract: string) => {
    const {linkReferences} = await artifacts.readArtifact(contract);
    if (!Object.keys(linkReferences).length) {
        return await ethers.getContractFactory(contract);
    }

    const manifest = await getSkaleManifest();

    const {
        librariesToUpgrade,
        oldLibraries
    } = await getLibrariesToUpgrade(
        manifest,
        linkReferences
    );
    const libraries = await deployLibraries(librariesToUpgrade);
    await updateManifest(
        manifest,
        libraries,
        oldLibraries
    );
    return await getLinkedContractFactory(
        contract,
        libraries
    );
};
