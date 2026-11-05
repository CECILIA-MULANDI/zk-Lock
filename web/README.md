# zk-Lock web demo

A browser demo of zk-Lock, built so the wider community can understand what it
does without reading any code. Type a secret word, watch a real Groth16 proof
get built in your tab, see that your word is not in the bytes that go on chain,
and watch a CKB node open the lock with it.

No wallet. No faucet. No install. Nothing here is simulated: the proof is real
Groth16 over BN254 from the same 1.6 MB wasm and 182 KB key the CLI uses, and
the verdict comes from the deployed script, not from this page.

Pudge testnet only. The verifier is unaudited and this is not for mainnet.

## Why there is no wallet

A zk-Lock cell's lock script *is* the proof, so there is no signature to
produce and therefore no key and no wallet. The transaction fee comes out of
the locked cell's own capacity, so there is no funding input either. An unlock
is one input, one output, two cell deps, and the proof in `witness.lock`.

That is a property of the contract, not a trick of the demo: `cli/src/unlock.rs`
has always worked this way.

## How the chain step works

Every attempt is judged twice, and only the second judgement counts.

The page checks the commitment locally, then asks a Pudge node to run the
deployed lock script against the proof via `estimate_cycles`. That RPC executes
every script in the transaction and returns either a cycle count or the failing
script's own exit code, and it broadcasts nothing. The verdict therefore comes
from the real binary loaded from its cell dep, and the cell it references is
never consumed.

`DRY_RUN_CELL` in `src/lib/config.ts` is the input that check resolves. It is
deliberately kept out of `DEMO_CELLS` so the spend path can never take it, which
is what lets one cell serve every visitor indefinitely.

Spending is the optional extra on top. While `DEMO_CELLS` holds unspent cells a
visitor can take one for real and get a transaction hash. When they run out the
unlock button retires and the node check carries the demo on its own, so the
demo degrades instead of breaking.

`RuleTrace` reads the same verdict. On acceptance all six steps report what the
node did; on rejection the exit code locates the failing step, and the steps
after it are marked as never reached rather than predicted.

The demo runs the generic mode only, and cannot run the other one without a
second circuit. Under transaction binding the script reads the context from
`pi[0]`, so the circuit has to take it as a public input, and `poseidon-preimage`
has one public signal with no slot for it. `poseidon-preimage-bound` is the one
that fits, so switching would mean a different circuit, a different vk cell and
a different commitment. The consequence is that the spend path here is
replayable out of the mempool, which is the gap
[Section 11 of the tutorial](../docs/tutorial.md#11-transaction-binding-recommended-for-production)
covers.

## A wrong word is a commitment mismatch, not a failed proof

Worth stating plainly, because it is the easy thing to get wrong: a wrong
secret still produces a perfectly valid proof. It proves a different statement.
The cell committed to one specific digest in its `lock.args` when it was
locked, and the script's fourth check compares `blake2b(public_inputs)` against
it. That is where a wrong word stops, and the node reports it as exit code 15.
The UI says so rather than pretending the proof broke.

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
layout, without a browser. Run it after changing `DEMO_SECRET`, and paste the
`pi_commitment` it prints into `config.ts`, or every unlock will be rejected.

## Funding the demo pool

Optional. With `DEMO_CELLS` empty or fully spent the demo still proves and a
node still returns a verdict; only the coin giveaway stops.

To add cells, lock them behind the demo secret and paste their out points into
`DEMO_CELLS`:

```sh
cargo run -p cli --release -- lock \
  0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b \
  0x1f0424a56478f21e3890d5101ead7c3c4eaee7394dae31ed56c15e965fe82fa7 \
  0x9766cc019cd6340da5ee5b66e0aed600404233bc3e2fe2ccab1826dcb1e56cea \
  105
```

105 CKB is the floor for these cells: 8 for the capacity field plus 97 for a
lock script with 64-byte args. Each cell is spendable once. The CLI reads the
key from `CKB_PRIVKEY`, and only ever funds from cells with no type script and
no data, so the contract and vk deployment cells cannot be selected by mistake.

**Wait for each lock to be indexed before running the next one.** Back to back,
the CLI picks the same input cell both times, and since the outputs are
identical too the second transaction is byte-identical to the first. The pool
rejects it as a duplicate it already holds:

```
PoolRejectedDuplicatedTransaction: Transaction(0x128f3cf9…) already exists
```

Poll `getCellLive` on the new out point, or just wait for a block, between
calls.
