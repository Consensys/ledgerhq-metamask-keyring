import AppEth from "@ledgerhq/hw-app-eth";
import Transport from "@ledgerhq/hw-transport";
import ledgerService from "@ledgerhq/hw-app-eth/lib/services/ledger";
import { LedgerEthTransactionResolution } from "@ledgerhq/hw-app-eth/lib/services/types";
import {
  rlp,
  addHexPrefix,
  stripHexPrefix,
  toChecksumAddress,
} from "ethereumjs-util";
import { TransactionFactory, TypedTransaction } from "@ethereumjs/tx";
import {
  MessageTypes,
  recoverPersonalSignature,
  recoverTypedSignature,
  SignTypedDataVersion,
  TypedDataUtils,
  TypedMessage,
} from "@metamask/eth-sig-util";
import { Buffer } from "buffer";

const hdPathString = `m/44'/60'/0'/0/0`;
const type = "Ledger Hardware";

type SerializationOptions = {
  hdPath?: string;
  accounts?: Account[];
  deviceId?: string;
};

type Account = {
  address: string;
  hdPath: string;
};
export interface EthereumApp {
  getAddress(
    path: string,
    boolDisplay?: boolean,
    boolChaincode?: boolean,
  ): Promise<{
    publicKey: string;
    address: string;
    chainCode?: string;
  }>;

  signTransaction(
    path: string,
    rawTxHex: string,
    resolution?: LedgerEthTransactionResolution | null,
  ): Promise<{
    s: string;
    v: string;
    r: string;
  }>;

  signPersonalMessage(
    path: string,
    messageHex: string,
  ): Promise<{
    v: number;
    s: string;
    r: string;
  }>;

  signEIP712HashedMessage(
    path: string,
    domainSeparatorHex: string,
    hashStructMessageHex: string,
  ): Promise<{
    v: number;
    s: string;
    r: string;
  }>;
}
export default class LedgerKeyring {
  public static readonly type = type;

  public readonly type = type;

  public deviceId = "";

  public accounts: Account[] = [];

  private name: string;

  private hdPath: string = hdPathString;

  private app?: EthereumApp;

  private transport?: Transport;

  constructor(opts: SerializationOptions = {}) {
    this.name = "Ledger Hardware";

    void this.deserialize(opts);
  }

  getName = () => this.name;

  // eslint-disable-next-line @typescript-eslint/require-await
  serialize = async (): Promise<SerializationOptions> => ({
    hdPath: this.hdPath,
    accounts: this.accounts,
    deviceId: this.deviceId,
  });

  // eslint-disable-next-line @typescript-eslint/require-await
  deserialize = async (opts: SerializationOptions = {}): Promise<void> => {
    this.hdPath = opts.hdPath || hdPathString;
    this.accounts = opts.accounts || [];
    this.deviceId = opts.deviceId || "";
  };

  // eslint-disable-next-line @typescript-eslint/require-await
  getAccounts = async (): Promise<string[]> => {
    const addresses = this.accounts.map(({ address }) => address);
    return addresses;
  };

  managesAccount = async (address: string): Promise<boolean> => {
    const accounts = await this.getAccounts();
    return accounts.some(
      (managedAddress) =>
        managedAddress.toLocaleLowerCase() === address.toLocaleLowerCase(),
    );
  };

  unlock = async (hdPath: string): Promise<string> => {
    const app = this._getApp();
    const account = await app.getAddress(hdPath, false, true);

    return account.address;
  };

  addAccounts = async (n = 1): Promise<string[]> => {
    const address = await this.unlock(this.hdPath);

    // The current immplemenation of LedgerKeyring only supports one account
    if (n > 1) {
      throw new Error("LedgerKeyring only supports one account");
    }

    if (this.accounts.length > 0) {
      // Just return the already imported account
      return this.getAccounts();
    }

    this.accounts.push({
      address,
      hdPath: this.hdPath,
    });

    return this.getAccounts();
  };

  getDefaultAccount = async (): Promise<string> => {
    let accounts = await this.getAccounts();

    if (this.accounts.length === 0) {
      accounts = await this.addAccounts(1);
    }

    return accounts[0];
  };

  signTransaction = async (address: string, tx: TypedTransaction) => {
    const app = this._getApp();
    const hdPath = this._getHDPathFromAddress(address);

    // `getMessageToSign` will return valid RLP for all transaction types
    const messageToSign = tx.getMessageToSign();

    const rawTxHex = Buffer.isBuffer(messageToSign)
      ? messageToSign.toString("hex")
      : rlp.encode(messageToSign).toString("hex");

    const resolution = await ledgerService.resolveTransaction(rawTxHex, {}, {});

    const { r, s, v } = await app.signTransaction(hdPath, rawTxHex, resolution);

    // Because tx will be immutable, first get a plain javascript object that
    // represents the transaction. Using txData here as it aligns with the
    // nomenclature of ethereumjs/tx.
    const txData = tx.toJSON();

    // The fromTxData utility expects a type to support transactions with a type other than 0
    txData.type = `0x${tx.type}`;

    // The fromTxData utility expects v,r and s to be hex prefixed
    txData.v = addHexPrefix(v);
    txData.r = addHexPrefix(r);
    txData.s = addHexPrefix(s);

    // Adopt the 'common' option from the original transaction and set the
    // returned object to be frozen if the original is frozen.
    const transaction = TransactionFactory.fromTxData(txData, {
      common: tx.common,
      freeze: Object.isFrozen(tx),
    });

    return transaction;
  };

  getAppAndVersion = async (): Promise<{
    appName: string;
    version: string;
  }> => {
    if (!this.transport) {
      throw new Error(
        "Ledger transport is not initialized. You must call setTransport first.",
      );
    }

    const response = await this.transport.send(0xb0, 0x01, 0x00, 0x00);

    let i = 0;
    const format = response[i++];

    if (format !== 1) {
      throw new Error("getAppAndVersion: format not supported");
    }

    const nameLength = response[i++];
    const appName = response.slice(i, (i += nameLength)).toString("ascii");
    const versionLength = response[i++];
    const version = response.slice(i, (i += versionLength)).toString("ascii");

    return {
      appName,
      version,
    };
  };

  signMessage = async (address: string, message: string) =>
    this.signPersonalMessage(address, message);

  signPersonalMessage = async (address: string, message: string) => {
    const hdPath = this._getHDPathFromAddress(address);
    const messageWithoutHexPrefix = stripHexPrefix(message);

    const app = this._getApp();
    const { r, s, v } = await app.signPersonalMessage(
      hdPath,
      messageWithoutHexPrefix,
    );

    let modifiedV = (v - 27).toString(16);

    if (modifiedV.length < 2) {
      modifiedV = `0${modifiedV}`;
    }

    const signature = `0x${r}${s}${modifiedV}`;
    const addressSignedWith = recoverPersonalSignature({
      data: message,
      signature: signature,
    });

    if (toChecksumAddress(addressSignedWith) !== toChecksumAddress(address)) {
      throw new Error("Ledger: The signature doesn't match the right address");
    }

    return signature;
  };

  signTypedData = async (
    address: string,
    data: string,
    { version }: { version: string },
  ) => {
    const app = this._getApp();

    const isV4 = version === "V4";
    if (!isV4) {
      throw new Error(
        "Ledger: Only version 4 of typed data signing is supported",
      );
    }

    const { domain, types, primaryType, message } = TypedDataUtils.sanitizeData(
      JSON.parse(data) as TypedMessage<MessageTypes>,
    );

    const selectedVersion = version
      ? SignTypedDataVersion.V3
      : SignTypedDataVersion.V4;

    const domainSeparatorHex = TypedDataUtils.hashStruct(
      "EIP712Domain",
      domain,
      types,
      selectedVersion,
    ).toString("hex");

    const hashStructMessageHex = TypedDataUtils.hashStruct(
      primaryType as string,
      message,
      types,
      SignTypedDataVersion.V4,
    ).toString("hex");

    const hdPath = this._getHDPathFromAddress(address);
    const { r, s, v } = await app.signEIP712HashedMessage(
      hdPath,
      domainSeparatorHex,
      hashStructMessageHex,
    );

    let modifiedV = (v - 27).toString(16);

    if (modifiedV.length < 2) {
      modifiedV = `0${modifiedV}`;
    }

    const signature = `0x${r}${s}${modifiedV}`;

    const addressSignedWith = recoverTypedSignature({
      data: JSON.parse(data) as TypedMessage<MessageTypes>,
      signature: signature,
      version: SignTypedDataVersion.V4,
    });
    if (toChecksumAddress(addressSignedWith) !== toChecksumAddress(address)) {
      throw new Error("Ledger: The signature doesnt match the right address");
    }

    return signature;
  };

  forgetDevice = () => {
    this.accounts = [];
    this.deviceId = "";
  };

  setTransport = (transport: Transport, deviceId: string) => {
    if (this.deviceId && this.deviceId !== deviceId) {
      throw new Error("LedgerKeyring: deviceId mismatch.");
    }

    this.deviceId = deviceId;
    this.transport = transport;
    this.app = new AppEth(transport);
  };

  setApp = (app: EthereumApp): void => {
    this.app = app;
  };

  openEthApp = (): Promise<Buffer> => {
    if (!this.transport) {
      throw new Error(
        "Ledger transport is not initialized. You must call setTransport first.",
      );
    }

    return this.transport.send(
      0xe0,
      0xd8,
      0x00,
      0x00,
      Buffer.from("Ethereum", "ascii"),
    );
  };

  quitApp = (): Promise<Buffer> => {
    if (!this.transport) {
      throw new Error(
        "Ledger transport is not initialized. You must call setTransport first.",
      );
    }

    return this.transport.send(0xb0, 0xa7, 0x00, 0x00);
  };

  private _getApp = (): EthereumApp => {
    if (!this.app) {
      throw new Error(
        "Ledger app is not initialized. You must call setTransport first.",
      );
    }

    return this.app;
  };

  private _getHDPathFromAddress = (address: string): string => {
    const account = this.accounts.find(({ address: accAddress }) => {
      return accAddress.toLowerCase() === address.toLowerCase();
    });

    if (!account) {
      throw new Error(`Account not found for address: ${address}`);
    }

    return account.hdPath;
  };
}
