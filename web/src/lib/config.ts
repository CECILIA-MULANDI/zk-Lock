/**
 * Deployed Pudge testnet references, copied from the repo README.
 * These are the generic (unbound) zk-Lock script and the Poseidon-preimage
 * verifying key cell that the tutorial uses.
 */

export const PUDGE_EXPLORER = "https://pudge.explorer.nervos.org";

/** Cell holding the zk-Lock RISC-V binary. Brought in as a cell dep, not spent. */
export const CONTRACT_DEP = {
  txHash:
    "0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb",
  index: 0,
} as const;

/** Cell whose data is the arkworks-compressed verifying key. */
export const VK_DEP = {
  txHash:
    "0x6c72cc8ad1746aa1a8bc86483cda5a579a9490241011ddaac38b400ff670a2e6",
  index: 0,
} as const;

/** Type-ID script hash of the contract cell. Goes in a locked cell's code_hash. */
export const CODE_HASH =
  "0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b";

/**
 * The secret the demo cells are locked behind. Public on purpose: this
 * explains a mechanism, it is not a puzzle.
 */
export const DEMO_SECRET = "nervos";

/**
 * blake2b_256 of the public-input field bytes for DEMO_SECRET, which is what
 * sits in lock.args[32..64] on the demo cells.
 *
 * Verified end to end by `npm run check:pipeline`. If you change DEMO_SECRET,
 * run that script and paste the new commitment here, or every unlock will be
 * rejected with a commitment mismatch.
 */
export const DEMO_PI_COMMITMENT =
  "0x9766cc019cd6340da5ee5b66e0aed600404233bc3e2fe2ccab1826dcb1e56cea";

/**
 * Pool of live cells locked behind DEMO_SECRET, each spendable exactly once.
 * Populate with:
 *
 *   cargo run -p cli --release -- lock \
 *     0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b \
 *     0x1f0424a56478f21e3890d5101ead7c3c4eaee7394dae31ed56c15e965fe82fa7 \
 *     0x9766cc019cd6340da5ee5b66e0aed600404233bc3e2fe2ccab1826dcb1e56cea \
 *     105
 *
 * The vk_hash above is the data hash of the live VK_DEP cell, confirmed equal
 * to hashVk(encodeVerifyingKey(circuits/poseidon-preimage/build/vk.json)).
 *
 * With an empty list the demo still proves and shows the witness; it reports
 * the chain step as unfunded rather than failing.
 */
export const DEMO_CELLS: ReadonlyArray<{ txHash: string; index: number }> = [
  {
    txHash:
      "0x128f3cf9ae04a9de156a14ce4ba2b506ef877803133a518ed9246b13beea40a5",
    index: 0,
  },
  {
    txHash:
      "0x26e296296f3e8402d59a6655c927c45ee6484c224e381002230239011c7e9418",
    index: 0,
  },
  {
    txHash:
      "0xddd3fa0c331050241c56efb5149e758e7fe7b5356498cecfd4ffb944b7289fd6",
    index: 0,
  },
  {
    txHash:
      "0x64ec7b85a04e15a5c060473b5802b1711e4a93ef660e159dc626ca57a97589cd",
    index: 0,
  },
  {
    txHash:
      "0xaf0402249ee541e9aab8f02cc1d8ef3ab7b77dae31168e7daa56159c7c96b8c1",
    index: 0,
  },
];

/**
 * Where an unlocked cell's capacity goes when the visitor supplies no address,
 * so the CKB comes back to whoever runs the demo and can re-lock it.
 *
 * Same key that deployed the contract and vk cells. That leaks nothing new:
 * the contract cell's lock args are already this key's blake160, on chain in
 * the deploy transaction.
 */
export const DEFAULT_RECIPIENT_ADDRESS: string | null =
  "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq2rz87rdtwfny5d4q2e4muzjw5qrqgpcwqsuvudr";

export const explorerTx = (txHash: string) =>
  `${PUDGE_EXPLORER}/transaction/${txHash}`;
