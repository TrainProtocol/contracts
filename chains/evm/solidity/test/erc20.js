const { expect } = require('chai');
const { ignition } = require('hardhat');
const TrainERC20 = require('../ignition/modules/deployERC20');

describe('Train ERC20 tests', () => {
  it('should deploy Train ERC20 contract', async () => {
    const { trainErc20 } = await ignition.deploy(TrainERC20);
    expect(await trainErc20.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
  });
});
