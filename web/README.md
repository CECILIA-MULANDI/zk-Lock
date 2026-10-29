# zk-Lock web demo

A browser demo of zk-Lock for people who do not write code. Type a secret word,
watch a real Groth16 proof get built in your tab, see that your word is not in
the bytes that go on chain, and spend a real Pudge cell with it.

No wallet. No faucet. No install.

## Why that works

A zk-Lock cell's lock script *is* the proof, so there is no signature to
produce and therefore no key and no wallet. The transaction fee comes out of
the locked cell's own capacity, so there is no funding input either. An unlock
is one input, one output, two cell deps, and the proof in `witness.lock`.

That is a property of the contract, not a trick of the demo: `cli/src/unlock.rs`
has always worked this way.

## Running it

```sh
cd circuits/poseidon-preimage && npm install && npm run build   # once
cd web && npm install && npm run dev
```

`predev` builds the TypeScript SDK and copies the circuit artifacts into
`public/circuit/`, so the browser always proves against the circuit in this
repo.

| script | what it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build into `dist/` |
| `npm run check:pipeline [word]` | proves and encodes in Node, asserting the 164-byte layout |
| `npm run sync:circuit` | recopies the circuit artifacts |
| `npm run typecheck` | `tsc --noEmit` |

`check:pipeline` is the fast way to confirm a change did not break the byte
layout, without a browser:

```
secret word     : "nervos"
field element   : 121381991116659
digest (public) : 20097032415382352137174286234910994742865121742690647116007994750818585326698
proved in       : 1085ms
verifies        : true
witness.lock    : 164
pi_commitment   : 0x9766cc019cd6340da5ee5b66e0aed600404233bc3e2fe2ccab1826dcb1e56cea
```

## The seven beats

| | beat | needs a chain? |
| --- | --- | --- |
| 1 | the pitch | no |
| 2 | type the secret | no |
| 3 | make the proof, narrated | no |
| 4 | see that the secret is not in the bytes | no |
| 5 | verify the proof locally | no |
| 6 | unlock a real Pudge cell | yes |
| 7 | try a wrong secret, watch the lock hold | no |

Everything but beat 6 runs with zero setup, and none of it is simulated: the
proof is real Groth16 over BN254 from the same 1.6 MB wasm and 182 KB key the
CLI uses.

### Beat 7 is a commitment mismatch, not a failed proof

Worth stating plainly, because it is the easy thing to get wrong: a wrong
secret still produces a perfectly valid proof. It proves a different statement.
The cell committed to one specific digest in its `lock.args` when it was
locked, and the script's fourth check compares `blake2b(public_inputs)` against
it. That is where a wrong word stops. The UI says so rather than pretending the
proof broke.

## Funding the demo pool

`DEMO_CELLS` in `src/lib/config.ts` is empty, so beat 6 reports itself as
unfunded and beats 1 to 5 and 7 run in full. To light it up, lock a few cells
behind the demo secret and add their out points:

```sh
cargo run -p cli --release -- lock \
  0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b \
  0x1f0424a56478f21e3890d5101ead7c3c4eaee7394dae31ed56c15e965fe82fa7 \
  0x9766cc019cd6340da5ee5b66e0aed600404233bc3e2fe2ccab1826dcb1e56cea \
  105
```

Each cell is spendable once. The commitment above is for the secret `nervos`;
if you change `DEMO_SECRET`, run `npm run check:pipeline` and paste the new
commitment, or every unlock will be rejected.

**Wait for each lock to be indexed before running the next one.** Back to back,
the CLI picks the same input cell both times, and since the outputs are
identical too the second transaction is byte-identical to the first. The pool
rejects it as a duplicate it already holds:

```
PoolRejectedDuplicatedTransaction: Transaction(0x128f3cf9…) already exists
```

Poll `getCellLive` on the new out point, or just wait for a block, between
calls.

Note that with the generic (unbound) script, one valid proof opens *any* cell
carrying those args, and a watcher can lift the proof out of the mempool and
redirect it. On testnet that costs nothing, and it is the clearest possible
explanation of why `zk-lock-bound` exists.

## Design

`brand.md` holds the palette with measured contrast ratios, the typography
rule, and the four layout rules the components follow. The short version:
colour is semantics, `private` is anything that never leaves the browser,
`public` is anything that goes on chain, and monospace is reserved for on-chain
data so the typeface itself carries meaning.

## Limits

- Pudge testnet only. The verifier is unaudited and this is not for mainnet.
- The bound variant is not exposed, and cannot be without a second circuit.
  `zk-lock-bound` reads the transaction context from `pi[0]`, so the circuit has
  to take it as a public input. `poseidon-preimage` has one public signal and no
  slot for it; `poseidon-preimage-bound` is the one that fits. Switching would
  mean a different circuit, a different vk cell and a different commitment.
- So the demo is front-runnable by design, and that is the point it is making.
  The secret is published and the coins are testnet, so there is nothing to
  lose, and "could someone steal my proof?" is the question the demo should
  provoke. `zk-lock-bound` is the answer to it.
