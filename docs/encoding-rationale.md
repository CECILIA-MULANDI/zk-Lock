# The witness encoding, and what Molecule would and would not fix

Wilfrid Okorie went through the zk-Lock repo and tutorial and asked
why the witness encoding is not Molecule. What follow are his questions and my answers.

## "What does `witness.lock` actually contain?"

A flat, positional layout. The framing is the same for both zk-lock and zk-lock-bound:

| Offset | Size       | Contents                                                          |
| ------ | ---------- | ----------------------------------------------------------------- |
| 0      | 128        | Groth16 proof, arkworks-compressed BN254 (G1 32B, G2 64B, G1 32B) |
| 128    | 4          | `u32` LE count of public inputs                                   |
| 132    | count × 32 | `Fr` field elements, arkworks-compressed                          |

The framing is the same but the field elements do not mean the same thing. In zk-lock
every element is a public input of the circuit. In zk-lock-bound the first element is
reserved: it carries a transaction-binding scalar, and only the elements after it are
hashed against the `pi_commitment` in the lock args. The scalar is the first 31 bytes
of a blake2b hash with the top byte left zero, so that it is always below the `Fr`
modulus. The script also requires at least one element, since there is no binding
without it. None of that is visible in the bytes, which is the first place a schema
would have helped.

The verifying key sits in cell data as `WireVk { alpha: G1Affine, beta: G2Affine,
gamma: G2Affine, delta: G2Affine, ic: Vec<G1Affine> }` under `CanonicalSerialize`
(`cli/src/encode.rs`): a 224-byte fixed header, then an 8-byte `u64` LE count for
`ic`, then `ic` × 32 bytes. That struct exists only on the encoding side. verifier-core
deserializes arkworks' own `VerifyingKey<Bn254>` and `Proof<Bn254>` directly, which
works because `WireVk` and `WireProof` declare the same fields in the same order and
therefore serialize to the same bytes. Nothing in verifier-core mirrors those structs
by hand.

`contracts/zk-lock/src/main.rs` parses this positionally and hands the raw slices to
`verifier_core::verify`, which takes three `&[u8]` and contains no Molecule reader.

## "Why isn't it Molecule?"

`witness.lock` is an opaque field by design. In CKB's `blockchain.mol`,
`WitnessArgs.lock` is a `BytesOpt`, an unstructured blob, and lock scripts define
their own contents. The standard secp256k1_blake160 lock puts a raw 65-byte signature
there, so there is precedent for not nesting a second Molecule object inside it.

That is not the whole picture though. There is a Molecule schema for this data, in my
own `groth16-ckb` repo. `schemas/groth16.mol` defines
`struct ProofBn254 { a: G1Compressed, b: G2Compressed, c: G1Compressed }` and
`vector FrVec <Byte32>`, and it carries the `version: Uint16` and curve union that
zk-Lock lacks. zk-Lock does not depend on it or generate from it.

Some of the bytes match. A Molecule `struct` emits no header, so `ProofBn254` is
32 + 64 + 32 = 128 contiguous bytes, identical to the proof here. A `fixvec` is a
4-byte LE count followed by its items, so `FrVec` is exactly the count-plus-elements
layout of the public inputs. Those two leaf types I did reimplement by hand, and the
output is byte-identical.

Above the leaves it stops matching, and for the verifying key it does not match at all.
Measured against the committed schema:

|                             | zk-Lock   | schema                                   |
| --------------------------- | --------- | ---------------------------------------- |
| proof                       | 128       | `ProofBn254` 128                         |
| public inputs, count prefix | 4         | `FrVec` 4                                |
| vk `ic` count prefix        | 8 (`u64`) | `G1Vec` 4 (`u32`)                        |
| witness, one public input   | 164       | `Bn254Witness` 176, `Groth16Witness` 194 |
| vk cell data, `ic_len` 2    | 296       | `VerifyingKeyBn254` 316                  |

`Bn254Witness` and `VerifyingKeyBn254` are tables, so they carry a 4-byte total size
plus a 4-byte offset per field: 12 bytes of header on the witness, 24 on the key. And
arkworks writes a `u64` length prefix for a `Vec` where a Molecule `fixvec` writes a
`u32`, so the key's `ic` vector differs by four bytes before any framing is counted.

So I never actually made that choice. The schema exists one repo over, I hand-rolled
the two leaf types that happen to coincide with it, and the containers around them are
a different encoding.

## "Wouldn't a schema give you a definite interface?"

I think the way to look at this one is that it is the question I want to keep on the
record, because it is the one I cannot close out.

zk-Lock does publish an interface. `sdk/ts/src/encode.ts` and `decode.ts` export
`encodeProof`, `encodePublicInputs`, `encodeVerifyingKey` and matching decoders as
`@zk-lock/sdk`. But it is a TypeScript interface rather than a language-neutral
schema, so nothing can be generated from it. An integrator in another language ports
it by hand from source, and nothing on chain or in the bytes declares the layout at
all.

Whether that is acceptable depends on what `witness.lock` is for. As an internal
detail of a single lock, raw bytes are correct and cheaper. As a public contract that
third-party wallets build against, it needs a published, versioned definition.
zk-Lock is described as a reusable lock script, which pushes toward the second
reading. I have not resolved that tension, and the gaps below are where it shows.

The part that still holds is that a `.mol` would pin the framing and not the hard
part. In the schema `G1Compressed` is `[byte; 32]`, an opaque array:
Molecule says 32 bytes go there and says nothing about how to produce them. The real
barrier to cross-language integration is that the points must be arkworks-compressed
BN254. Coming from any prover outside snarkjs or arkworks, you settle point
compression, field endianness and Montgomery form long before the witness framing
matters. That is why `sdk/ts/src/encode.ts` carries hand-written `encodeG1`,
`encodeG2` and `encodeFr` instead of calling a codec. A schema would not remove that
work.

Which leaves a realistic integrator set of two:

- **TypeScript**, where snarkjs lives and CKB dapps are built, already served by `@zk-lock/sdk`.
- **Rust via arkworks**, which can use `verifier-core` directly.

## "So would Molecule fix anything?"

There are four real problems here, none of them about third-party interop. Molecule
answers two, and both of those are blocked on a redeployment.

**One source of truth for the lengths.** The proof length 128 is written out six times
in this repository: `PROOF_LENGTH` in `contracts/zk-lock/src/main.rs` and again in
`contracts/zk-lock-bound/src/main.rs`, `PROOF_LEN` in `cli/src/context.rs` and again
as its TypeScript twin in `sdk/ts/src/ckb.ts`, and a bare literal `128` twice in the
SDK, in `sdk/ts/src/encode.ts` and `sdk/ts/src/decode.ts`. verifier-core has a seventh.

Nothing forces them to agree at compile time. Something does force it at runtime:
verifier-core rejects any proof whose length is not exactly `PROOF_LEN`, so a
disagreement surfaces as an unspendable cell rather than as a forged proof. That is the
same availability-not-soundness failure mode as the missing version tag below. It is
still worth fixing, because a cell that cannot be spent is not a small bug. The root
cause is that verifier-core's length constants are private, so everything downstream
had to redeclare them.

**One source of truth for the layout itself.** The layout is written by hand once, in
`cli/src/encode.rs`, as `WireVk` and `WireProof`. The decoding side is not a
hand-written mirror of it: verifier-core calls `deserialize_compressed` on arkworks'
own `VerifyingKey<Bn254>` and `Proof<Bn254>`.

So the drift is not between two of my repositories. It is between my encoder and
whatever layout the pinned arkworks version emits. If arkworks reorders a field or
changes its `Vec` prefix, `WireVk` silently stops matching and nothing in either
repository fails. A round-trip test that encodes with the CLI and decodes with
verifier-core catches exactly that, and is cheap.

Codegen from a single `.mol` cannot fix this one. The authority on the byte layout is
arkworks' derive, and Molecule cannot reproduce it: the key's `ic` vector needs a `u64`
prefix and a `fixvec` emits a `u32`. Generated types would mean changing the on-chain
format, not describing it.

**A version tag.** Nothing in the bytes identifies the wire format. If arkworks
changes its compressed layout, or a v2 layout ships, or the curve changes, cells
locked under the old layout become unspendable and clients have no way to tell which
layout to produce. The failure mode is availability, not soundness: the script
length-checks at `PROOF_LENGTH + 4` and arkworks validates on deserialize, so a
mismatched witness is rejected rather than silently misparsed. `schemas/groth16.mol`
already carries `version: Uint16` and a curve union for exactly this. zk-Lock sits
below that layer and gets neither.

**A declared meaning for each field.** This is the one my own code demonstrates. In
zk-lock-bound the first field element is not a public input in the ordinary sense, it
is the transaction-binding scalar, and nothing in the bytes says so. The vector is a
count and a run of 32-byte elements either way. A client builds a valid-looking witness
for the wrong script and finds out when the unlock fails. The only place the convention
is written down is `contracts/zk-lock-bound/src/main.rs` and this document. A Molecule
table would have given that field a name and a type, which is the plainest argument for
a schema anywhere in this note, and it costs a format change to adopt.

## What I am doing about it

The lengths I am fixing outright. Export the length constants from verifier-core; have
zk-lock and zk-lock-bound import them instead of redeclaring; replace `PROOF_LEN` in
`cli/src/context.rs` with the same import; give the SDK one exported constant and use it
in `encode.ts`, `decode.ts` and `ckb.ts` in place of the three literals there; and add a
test asserting the TypeScript constant matches the Rust one. Seven sites become one, with
no byte changes and no redeployment.

What to do about `WireVk` and `WireProof` drifting from arkworks I have not decided. Two
options are left. Publish the layout as a versioned spec document and add round-trip
tests that encode with the CLI and decode with verifier-core, failing on drift, which
keeps the bytes and the hand-written encoders. Or leave it and accept the risk, which is
the status quo and is only defensible for as long as both repositories have the same
single author.

There was a third option until I checked the bytes: generate both sides from a single
`.mol` and depend on the generated types. I dropped it. It is not a way to describe this
format, only a way to replace it, and replacing it is the deployment problem below rather
than a schema decision. Input welcome on the two that are left, particularly from anyone
who has kept a hand-written encoder in step with an upstream serialization library across
repositories.

I also do not know how a layout version should be signalled. For any single deployed
binary the codec identity collapses into `code_hash`, since `verifier_core` is a linked
dependency. But both scripts are deployed with `hash_type: type` (`cli/src/lock.rs`,
`sdk/ts/src/ckb.ts`), and a type-script deployment keeps the same `type_hash` across
binary upgrades, so `code_hash` does not identify the layout across versions. A client
holding old bytes and a client holding new ones cannot be told apart by code hash
alone. That argues for a tag in the bytes, but the alternatives deserve a hearing,
including a distinct type script per layout, or interface resolution that keys off
something finer than the code hash. Open question for anyone building clients: does
resolving an interface by code hash inherit this problem?

None of the layout changes can happen yet, and that is scheduling rather than a design
argument. Any change to the witness layout means a new contract binary, a fresh Pudge
deployment, new reference transactions, and updates to the tutorial and SDK. The README
pins the currently deployed contract cells and reference transactions, so this waits
until after Spark grant closure. That applies to the version tag and to naming the bound
script's first field element, which is why this document is the only place either of
them is currently written down.
