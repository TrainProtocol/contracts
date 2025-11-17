const { buildModule } = require('@nomicfoundation/hardhat-ignition/modules');

module.exports = buildModule('PreHTLCModule', (m) => {
  const trainErc20 = m.contract('TrainERC20');
  return { trainErc20 };
});
