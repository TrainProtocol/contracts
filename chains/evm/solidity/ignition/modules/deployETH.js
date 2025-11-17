const { buildModule } = require('@nomicfoundation/hardhat-ignition/modules');

module.exports = buildModule('PreHTLCModule', (m) => {
  const train = m.contract('Train');
  return { train };
});
