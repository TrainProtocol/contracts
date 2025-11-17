const { buildModule } = require('@nomicfoundation/hardhat-ignition/modules');

module.exports = buildModule('TokenModule', (m) => {
  const train = m.contract('TestToken');
  return { train };
});
