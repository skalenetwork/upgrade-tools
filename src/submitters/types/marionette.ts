import {BigNumberish, BytesLike, ethers as RawEthers} from "ethers";


export const MARIONETTE_ADDRESS = "0xD2c0DeFACe000000000000000000000000000000";

type FunctionCallStruct = {
    receiver: string;
    value: BigNumberish;
    data: BytesLike;
  };

export interface LegacyMarionette extends RawEthers.BaseContract {
  encodeFunctionCall(
    receiver: string,
    value: BigNumberish,
    data: BytesLike
  ): Promise<BytesLike>
  version(): Promise<string>;
}

export interface Marionette extends RawEthers.BaseContract {
    encodeFunctionCalls(
        functionCalls: FunctionCallStruct[]
      ): Promise<BytesLike>
    version(): Promise<string>;
}
