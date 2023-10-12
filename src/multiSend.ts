import {BigNumberish, BytesLike} from "ethers";
import {
    hexConcat,
    hexDataLength,
    hexValue,
    hexZeroPad,
    hexlify
} from "ethers/lib/utils";
import {OperationType} from "@safe-global/safe-core-sdk-types";


interface Transaction {

    /*
     * Operation as a uint8 with 0 for a call
     * or 1 for a delegatecall (=> 1 byte)
     */
    operation: OperationType,

    // To as a address (=> 20 bytes)
    to: string,

    // Value as a uint256 (=> 32 bytes)
    value: BigNumberish,

    // Data as bytes.
    data: BytesLike
}

const OPERATION_BYTES = 1;
const ADDRESS_BYTES = 20;
const UINT256_BYTES = 32;
const TO_BYTES = ADDRESS_BYTES;
const VALUE_BYTES = UINT256_BYTES;
const DATA_LENGTH_BYTES = UINT256_BYTES;

export const encodeTransaction = (transaction: Transaction) => {
    const operation = hexZeroPad(
        hexValue(transaction.operation),
        OPERATION_BYTES
    );
    const to = hexZeroPad(
        hexValue(transaction.to),
        TO_BYTES
    );
    const value = hexZeroPad(
        hexValue(transaction.value),
        VALUE_BYTES
    );
    const data = hexlify(transaction.data);
    const dataLength = hexZeroPad(
        hexValue(hexDataLength(data)),
        DATA_LENGTH_BYTES
    );

    return hexConcat([
        operation,
        to,
        value,
        dataLength,
        data
    ]);
};
