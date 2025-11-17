require('dotenv').config();
const SafeGlobal = require('@safe-global/protocol-kit');
const Safe = SafeGlobal.default;
const { SigningMethod, buildContractSignature } = SafeGlobal;

(async function () {
  let protocolKit = await Safe.init({
    provider: process.env.zk_sync_mainnet_rpc,
    signer: process.env.priv_key_zk_sync,
    safeAddress: process.env.safe_address,
  });

  const TYPED_MESSAGE = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      addLockMsg: [
        { name: 'Id', type: 'bytes32' },
        { name: 'hashlock', type: 'bytes32' },
        { name: 'timelock', type: 'uint48' },
      ],
    },
    domain: {
      name: 'Train',
      version: '1',
      chainId: 324,
      verifyingContract: '0x98aD8967F66E8527eAe472034f30E1897fFb4e75',
    },
    primaryType: 'addLockMsg',
    message: {
      Id: '0x4a64a107f0cb32536e5bce6c98c393db21cca7f4ea187ba8c4dca8b51d4ea80a',
      hashlock: '0x80b41a1cfabc2af6718ad3f104b575f55a4708148ad7f24dd49b4e9da74a5950',
      timelock: 1740151841,
    },
  };

  let safeMessage = await protocolKit.createMessage(TYPED_MESSAGE);

  safeMessageSigned = await protocolKit.signTypedData(
    safeMessage,
    SigningMethod.SAFE_SIGNATURE,
    process.env.safe_address
  );

  const contractSignature = await buildContractSignature([safeMessageSigned], process.env.safe_address);

  console.log(contractSignature);

  const sig = safeMessageSigned.data.slice(2);
  const r = '0x' + sig.slice(0, 64); 
  const s = '0x' + sig.slice(64, 128); 
  const v = parseInt(sig.slice(128, 130), 16); 
  console.log('r:', r);
  console.log('s:', s);
  console.log('v:', v);
})();
