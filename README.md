# Metamask Keyring

This repository contains a node module that makes it easy to integrate the Metamask Mobile app through the app's generic KeyringController / Keyring approach.

The Metamask Ethereum [Keyring Controller](https://github.com/MetaMask/KeyringController) is an abstraction to work with multiple keyrings that serve as bridges to external wallet / HW wallet providers. The component needs to adhere to [the Keyring Class protocol](https://github.com/MetaMask/KeyringController) to support Ethereum based actions from the Ledger Nano X device.

As such is provides the following members used by a top level KeyringController:

- `Keyring.type` - A class property that returns a unique string describing the Keyring. (value fixed to 'Ledger')
- `serialize()` - Returns any JSON-serializable JavaScript object that you like to store as the state of the LedgerKeyring. It will be encoded to a string, encrypted with the user's password, and stored to disk.
- `deserialize(object)` - Restores the internal state based on the previously store keyring state.
- `addAccounts(n)` - Retrieves an account from the ledger and stores the address on the PK. In the current implementation we are supporting a single default account and won't allow adding more.
- `getAccounts()` - Retrieves the list of accounts store in the keyring state
- `signTransaction(address, transaction)` - Interacts with the Ledger Device to sign an [ethereumjs-tx](https://github.com/ethereumjs/ethereumjs-tx) transaction
- `signMessage / signPersonalMessage(address, data)` - Takes a hash data and signs it using the Ledger Device
- `signTypedData(address, data, versionInformation)` - Signs a typed message (EIP712) using the Ledger Device. Only V4 is supported.
- `getName()` - Returns a user friendly name that can be used as label for Metamask accounts
- `getAppAndVersion()` - Returns the currently running application and version that can be used as a "pre-check" of conditions before trying to sign.
- `forgetDevice()` - Resets the state of the keyring
- `setTransport()` - Specifies the transport to use when talking to the Ledger Device.

## Usage

```javascript
const KeyringController = require('eth-keyring-controller');
const LedgerKeyring = require('@ledgerhq/metamask-keyring');
const BluetoothTransport = require("@ledgerhq/react-native-hw-transport-ble");

const keyringController = new KeyringController({
  keyringTypes: [LedgerKeyring],
  initState: initState.KeyringController,
});

// Connect to device first
const device = ...; // get the device to econnect to
const transport = await BluetoothTransport.open(device);

// Perform signing action
const tx = ...; // ethereumjs-tx object
const address = ...;

const signedTx = await keyringController.signTransaction(address, tx);
```
