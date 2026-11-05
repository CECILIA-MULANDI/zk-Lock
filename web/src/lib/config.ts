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
 * Data hash of the live VK_DEP cell, and the first half of a demo cell's
 * lock.args. Confirmed equal to
 * hashVk(encodeVerifyingKey(circuits/poseidon-preimage/build/vk.json)) and to
 * circuits/poseidon-preimage/expected_vk_hash.txt.
 */
export const DEMO_VK_HASH =
  "0x1f0424a56478f21e3890d5101ead7c3c4eaee7394dae31ed56c15e965fe82fa7";

/**
 * A demo cell is any live cell carrying this lock. That is the definition, and
 * it is why the pool does not need listing: the indexer can be asked for cells
 * matching a lock script directly, so topping the demo up is a `lock` call and
 * nothing else. No edit here, no rebuild, no redeploy.
 */
export const DEMO_LOCK = {
  codeHash: CODE_HASH,
  hashType: "type",
  args: `${DEMO_VK_HASH}${DEMO_PI_COMMITMENT.slice(2)}`,
} as const;

/**
 * The cell the dry run references, and the one cell nothing may spend.
 *
 * Keep it out of DEMO_CELLS. If the spend path could reach it, one successful
 * unlock would take the demo's only permanent input with it. Why the dry run
 * works this way is in web/README.md under "How the chain step works".
 */
export const DRY_RUN_CELL = {
  txHash:
    "0x0cda4eb7906d36f5a753dd0b1497c88355efba8b81886530c9a8ae4e7cf1fe54",
  index: 0,
} as const;

/**
 * Fallback pool, used only if the indexer cannot be reached.
 *
 * The live pool is discovered from DEMO_LOCK, so this list does not need
 * maintaining and entries here going stale is harmless: every candidate is
 * checked for liveness before it is spent. It exists so a visitor still gets
 * an unlock when the indexer is down, not as the source of truth.
 *
 * How to add cells is in web/README.md under "Funding the demo pool".
 */
export const DEMO_CELLS: ReadonlyArray<{ txHash: string; index: number }> = [
  {
    txHash:
      "0x72bfa049a4c9d073141919895d6fbd3684b7eefb95bb5bce0c56cb8282a2ba02",
    index: 0,
  },
  {
    txHash:
      "0x1335ac2d05e83b26ffdfe7c7e3ea07ef1259c8673c51e7d671d263325bcb8880",
    index: 0,
  },
  {
    txHash:
      "0x1eb0d7cc6b165c29300e9395ff8f2e11b82bc9936e131536ebe5fb859ec65c13",
    index: 0,
  },
  {
    txHash:
      "0x11885c2cef548500c2b60cd5a41681eb4dae18ea0563288b38ce56a103ad3655",
    index: 0,
  },
  {
    txHash:
      "0x01f04a214617f317ce34d6ce629ae2513bd82e05c7513ab56f8d2312a6794352",
    index: 0,
  },
  {
    txHash:
      "0x1afd4530693c443cc2a8ff5a09726601173b07698e1c0bbf6fbde30c49dd700c",
    index: 0,
  },
  {
    txHash:
      "0x906bf2c31139626d68007492fedc05bd99fb2580f46377004e21d7bddd285f61",
    index: 0,
  },
  {
    txHash:
      "0xd74dd20d0fc024c2e8ade3a157599f83bf0fa02d15b65918f3bd2c4ffe731dee",
    index: 0,
  },
  {
    txHash:
      "0x2c139f0b35c3ab5d8fa0bdd6fd680a0507e3fd1efc37e7b9d07a32fbbe471864",
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
