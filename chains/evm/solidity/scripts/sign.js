const ethers = require('ethers');
require('dotenv').config();

async function signHTLC() {
  const domain = {
    name: 'Train',
    version: '1',
    chainId: 10,
    verifyingContract: '0x126Fc543AA75D1D8511390aEb0a5E49Ad8a245BC',
  };

  const domainSeparator = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        ethers.keccak256(
          ethers.toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
        ),
        ethers.keccak256(ethers.toUtf8Bytes(domain.name)),
        ethers.keccak256(ethers.toUtf8Bytes(domain.version)),
        domain.chainId,
        domain.verifyingContract,
      ]
    )
  );

  console.log('Computed Domain Separator:', domainSeparator);

  const types = {
    addLockMsg: [
      { name: 'Id', type: 'bytes32' },
      { name: 'hashlock', type: 'bytes32' },
      { name: 'timelock', type: 'uint48' },
    ],
  };

  const message = {
    Id: '0x84869c9a37a4772401786b5a79ab9dae738685ea7f3825c6a2ae01d15d0df659',
    hashlock: '0xe6edfc9189e2db427d7b7ce83118722729021e125569c3eb76b6700804533ad4',
    timelock: 1740492194,
  };

  const privateKey = process.env.PRIV_KEY;
  const wallet = new ethers.Wallet(privateKey);

  const signature = await wallet.signTypedData(domain, types, message);

  console.log('Signature:', signature);

  const sig = ethers.Signature.from(signature);
  console.log({
    r: sig.r,
    s: sig.s,
    v: sig.v,
  });
}

signHTLC().catch(console.error);
