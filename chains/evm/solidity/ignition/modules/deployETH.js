const { buildModule } = require('@nomicfoundation/hardhat-ignition/modules');

module.exports = buildModule('PreHTLCModule', (m) => {
  const v8 = m.contract('Train');
  return { v8 };
});
