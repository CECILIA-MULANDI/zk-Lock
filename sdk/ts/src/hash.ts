import { hashCkb } from "@ckb-ccc/core";

//blake2b_256 of the raw arkworks-compressed vk bytes
// This value is what ends up in the lock.args[0..32]
// IT MUST match the data_hash of the vk cell dep on-chain
export function hashVk(vkBytes: Uint8Array): `0x${string}` {
  return hashCkb(vkBytes) as `0x${string}`;
}

//blake2b_256 of the public input Fr bytes
export function hashPi(piBytes: Uint8Array): `0x${string}` {
  if (piBytes.length < 4) {
    throw new Error("pi bytes must include the 4-byte length prefix");
  }
  return hashCkb(piBytes.slice(4)) as `0x${string}`;
}
