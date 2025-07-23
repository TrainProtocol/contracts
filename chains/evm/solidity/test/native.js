const { expect } = require('chai');
const { ignition } = require('hardhat');
const Train = require('../ignition/modules/deployETH');

describe('Train native tests', () => {
  it('should deploy Train contract', async () => {
    const { train } = await ignition.deploy(Train);
    expect(await train.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
  });
});
