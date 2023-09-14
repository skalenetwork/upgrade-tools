import {BigNumber} from "ethers";

const padWithZeros = (
    value: string,
    targetLength: number
) => ("0".repeat(targetLength) + value).slice(-targetLength);

const getOperationBytes = (operation: 0 | 1) => {
    if (operation === 0) {
        return "00";
    } else if (operation === 1) {
        return "01";
    }
    throw Error("Operation has an incorrect value");
};

const getToBytes = (to: string) => {
    let _to = to;
    if (to.startsWith("0x")) {
        _to = _to.slice(2);
    }
    _to = padWithZeros(
        _to,
        20 * 2
    );
    return _to;
};

export const encodeTransaction = (
    /* Operation as a uint8 with 0 for a call
     * or 1 for a delegatecall (=> 1 byte)
     */
    operation: 0 | 1,

    // To as a address (=> 20 bytes)
    to: string,

    // Value as a uint256 (=> 32 bytes)
    value: BigNumber | number,

    // Data as bytes.
    data: string
) => {
    const _operation = getOperationBytes(operation);

    const _to = getToBytes(to);

    const _value = padWithZeros(
        BigNumber.from(value).toHexString().
            slice(2),
        32 * 2
    );

    let _data = data;
    if (data.startsWith("0x")) {
        _data = _data.slice(2);
    }
    if (_data.length % 2 !== 0) {
        _data = `0${_data}`;
    }

    const _dataLength = padWithZeros(
        (_data.length / 2).toString(16),
        32 * 2
    );

    return `0x${[
        _operation,
        _to,
        _value,
        _dataLength,
        _data
    ].join("")}`;
};
