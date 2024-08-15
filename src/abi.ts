import {Interface} from "ethers";

export const getAbi = (contractInterface: Interface) => {
    const abi = JSON.parse(contractInterface.formatJson()) as [];

    abi.forEach((obj: {type: string}) => {
        if (obj.type === "function") {
            const func = obj as {
                name: string,
                type: string,
                inputs: object[],
                outputs: object[]
            };
            func.inputs.concat(func.outputs).forEach((output: object) => {
                Object.assign(
                    output,
                    {
                        "name": "",
                        ...output
                    }
                );
            });
        }
    });

    return abi;
};
