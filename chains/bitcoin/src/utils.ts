export function decodeCommitLogHex(hex: string) {
  const b = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  if (b.length !== 78) throw new Error(`invalid memo length: ${b.length}, expected 78`);

  let o = 0;
  const commitId = b.subarray(o, (o += 32));
  const timelock = b.readUIntBE(o, 6);
  o += 6;

  const dstChain = b
    .subarray(o, (o += 4))
    .toString('utf8')
    .replace(/\x00+$/g, '');
  const dstAddress = '0x' + b.subarray(o, (o += 20)).toString('hex');
  const dstAsset = b
    .subarray(o, (o += 4))
    .toString('utf8')
    .replace(/\x00+$/g, '');

  const srcReceiver = b
    .subarray(o, (o += 12))
    .toString('utf8')
    .replace(/\x00+$/g, '');

  return {
    commitId: '0x' + commitId.toString('hex'),
    timelock,
    dstChain,
    dstAddress,
    dstAsset,
    srcReceiver,
  };
}
