import {EXIT_CODES} from "../exitCodes";
import {UnsignedTransaction} from "ethers";
import chalk from "chalk";


export abstract class Submitter {
    abstract submit(transactions: UnsignedTransaction[]): Promise<void>;

    // Protected

    protected static atomicityWarning () {
        if (process.env.ALLOW_NOT_ATOMIC_UPGRADE) {
            console.log(chalk.yellow("Not atomic upgrade is performing"));
        } else {
            console.log(chalk.red("The upgrade will consist" +
                " of multiple transactions and will not be atomic"));
            console.log(chalk.red("If not atomic upgrade is OK" +
                " set ALLOW_NOT_ATOMIC_UPGRADE environment variable"));
            process.exit(EXIT_CODES.NOT_ATOMIC_UPGRADE);
        }
    }
}
