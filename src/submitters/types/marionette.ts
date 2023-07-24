import { BigNumberish, BytesLike } from "ethers";
import { ethers as RawEthers } from "ethers"

export const MARIONETTE_ADDRESS = "0xD2c0DeFACe000000000000000000000000000000";

type FunctionCallStruct = {
    receiver: string;
    value: BigNumberish;
    data: BytesLike;
  };

export interface Marionette extends RawEthers.Contract {
    encodeFunctionCalls(
        functionCalls: FunctionCallStruct[]
      ): Promise<BytesLike>
    version(): Promise<string>;
}