# Transaction binding, and why it ended up being the whole transaction

A lock script that verifies a Groth16 proof answers one question: is this proof valid for
this verifying key and these public inputs? It does not answer a second one: was this proof
made for *this* spend? Nothing in a pairing check mentions a transaction.

That gap is transaction binding, and I have now given three different answers to it. This is
a record of all three, what each was for, and what broke. The second answer had a real hole
in it, so this is partly a postmortem. Most of what went wrong was not about zero knowledge
at all, and the parts that generalise are collected at the end.

`@truthixify` raised the need for binding in a review of the generic script.

## Answer one: no binding

`contracts/zk-lock/` calls the shared spend check with `Binding::None`. Every public input
belongs to the circuit author, `pi_commitment` in `lock.args` covers all of them, and a valid
proof spends the cell in any transaction whatsoever.

This was the right thing to build first, and it is still deployed and still useful. The
question it answers is whether Groth16 verification can work as a CKB lock at all: whether
the verifying key fits in cell data, whether the cycle budget holds, whether the byte
encoding survives a round trip through a witness. Those are hard enough on their own, and
mixing in a second unsolved problem would have made a failure impossible to attribute.

What it means in practice is that the witness is a bearer token. Anyone who sees an unlock
in the mempool can copy `witness.lock` verbatim, point it at a different cell with the same
`lock.args`, send the capacity to themselves, and the script will accept it, because from the
script's point of view nothing is wrong: the proof is valid for those public inputs.

So `Binding::None` is for cells where that is acceptable, which mostly means cells whose
spend condition is public knowledge anyway. The README says it is unfit for production and
means it.

## Answer two: commit to the cell and the recipient

`contracts/zk-lock-bound/` reserves public input 0 for a transaction-context scalar. The
script recomputes that scalar itself and rejects the spend if the proof committed to a
different one. `pi_commitment` then covers inputs `1..n` only, since input 0 is not the
circuit author's to choose.

The scalar was:

```
blake2b(input_outpoint ‖ blake2b(output_0_cell ‖ output_0_data))
```

with the top byte cleared so the little-endian value stays below the BN254 scalar modulus and
neither side has to reduce.

Three reasons this looked right at the time, and two of them still hold.

**It covers exactly what the known attacks touch.** Mempool witness-copy varies which cell is
spent, and the input outpoint pins that. Recipient redirect varies who gets paid, and output
0's bytes pin that, capacity included. Both attacks die. If you enumerate the attacks and
cover each one, you feel finished.

**It keeps the fixtures independent of the compiled contract.** This mattered more than it
sounds. The bound test fixture holds a real proof, and a real proof can only be produced by
running snarkjs by hand. A digest over the input outpoint and output 0 can be made entirely
of pinned constants, so the test's expected scalar does not depend on the contract binary.
The comment that used to sit above those constants said so explicitly: output 0's lock was
hardcoded rather than set to the bound script itself "so the scalar does not depend on the
compiled contract, which would invalidate the proof on every rebuild." That was a deliberate
trade, and the cost of giving it up is now paid every build.

**It is small.** One extra public input, two blake2b calls, one comparison.

## What was wrong with answer two

A CKB lock script does not run once per cell. It runs **once per group** of inputs that share
the same lock script.

The scalar named `GroupInput[0]`. It said nothing about `GroupInput[1]`. So:

1. Alice has two cells at the same zk-Lock address, meaning identical `lock.args`.
2. Alice broadcasts an unlock spending the first one.
3. Anyone takes that witness, builds a transaction with **both** cells as inputs in the same
   order, keeps output 0 byte-identical so the scalar still matches, and adds output 1
   carrying the second cell's capacity to themselves.
4. The lock runs once, over `GroupInput[0]`, and accepts. The second cell is spent under a
   proof that never mentioned it.

I measured this before fixing it: accepted, at the same cycle count as the legitimate spend.
The extra cell cost the attacker nothing.

The same shape applies to outputs. The digest named `Output[0]`, so `Output[1]` onward were
free. The input half is the one with a working exploit, because that is where capacity enters
the transaction.

The general statement, which is the thing worth carrying away:

> A hash pins the bytes of what it covers. It cannot say "and nothing else". So a partial
> commitment obliges you to write that part down separately, as an explicit rule about how
> many of each thing may appear.

Bitcoin has had the vocabulary for this for years. The old digest was structurally
`SIGHASH_SINGLE`: one input, one output, nothing about the rest. The fix a cardinality rule
would have been is "the input group must hold exactly one cell", and I wrote that fix and
tested it before deciding not to ship it.

Because the output half has no honest version of the same patch. "Exactly one output" is not a
rule a lock can impose without breaking change outputs, fee cells and every multi-party
transaction. At that point you are not closing a hole, you are maintaining a list, and the
list grows every time someone asks a question about a field you forgot.

## Answer three: commit to tx_hash

```
pi[0] == tx_hash, top byte cleared
```

`tx_hash` is CKB's own transaction hash: the hash of the RawTransaction, covering version,
cell deps, header deps, inputs, outputs and outputs data. Everything a spender could vary, in
one 32-byte value.

Three things fall out of this at once.

**There are no cardinality rules.** Adding an input changes the hash. Adding an output changes
the hash. Changing a dep changes the hash. There is no field to forget, so there is no rule to
write, so there is no list to maintain.

**A circuit author has nothing to learn.** Under the partial digest, writing a bound circuit
meant knowing which fields were covered, in what order, with what framing. Now the convention
is "public input 0 is the transaction", and the script enforces it.

**It is the same scope a signature has.** CKB's own `secp256k1_blake160_sighash_all` signs
`tx_hash` plus the group's witnesses. A bound zk-Lock spend now authorises exactly what a
signed spend authorises, which means "I hold a witness satisfying this circuit" slots in where
"I hold this private key" used to be, with no change in what the authorisation means. That is
`SIGHASH_ALL`, and the reason every chain converges on it is the reason above.

It also **permits something the cardinality rule would have had to forbid**: one proof spending
several cells that share `lock.args`, in a transaction the prover chose. That is a legitimate
thing to want, and the count rule would have banned it to police an attack that the wider
digest kills outright.

### Why committing to the transaction is not circular

The proof goes in `witness.lock`. If `tx_hash` covered the witnesses, committing to it would be
impossible: you would need the proof before you could compute what the proof commits to.

CKB's `tx_hash` deliberately excludes the witnesses. That is what makes signing against it
possible, and it is what makes proving against it possible, for the same reason. So the flow is
two passes:

1. Assemble the complete transaction, with a zero-filled proof of the right length.
2. Compute `tx_hash`, prove with it as public input 0.
3. Put the real proof in `witness.lock` and send. The hash does not move.

Step 1 still needs the placeholder at the **right length**, even though its content is ignored,
because length sets the serialized size, size sets the fee, the fee sets output 0's capacity,
and capacity is inside `tx_hash`. That is the one piece of circularity that does not dissolve,
and it is why the SDK decides the fee and the capacity in a single place
(`planBoundUnlock` in `sdk/ts/src/ckb.ts`) rather than letting a wallet helper add a change
output later.

## What answer three costs

**The prover must know the final transaction.** Not just the recipient: the fee rate, the deps,
the output data, all of it. Change anything after computing the context and the spend fails
with `ContextMismatch`. This was already true under answer two; it is now true of more fields.

That is the whole of the price, but there is a trap on the way to it that cost me a CI run, and
it is worth writing down because anyone testing a lock that commits to `tx_hash` will hit it.

A test fixture holding a real proof is bound to one transaction, and `tx_hash` covers
`cell_deps`, and a dep is identified by an outpoint. `ckb-testtool` derives the outpoint of a
deployed cell from that cell's data hash, so by default the fixture's proof is a function of the
contract binary. That is worse than it sounds. Editing a comment in the contract source shifts
line numbers, changes the debug info, changes the binary, moves the dep outpoint and invalidates
the proof. Worse, the binary is not byte-identical across machines, so a re-proved fixture can
pass locally and fail in CI with a different required context, forever.

The fix is to pin the dep outpoints rather than let them be derived. A lock script is not part
of the RawTransaction, only the outpoint it is spent from, so registering the contract and the
verifying key at fixed outpoints keeps `tx_hash` constant while the script's code hash still
tracks the binary the test actually runs. `tests/src/tests_bound.rs` does this in `pinned_dep`,
and the fixture then depends on nothing but the pinned constants and the vk. Verified by
changing the binary deliberately and confirming the required context did not move.

So the answer-two property this looked like it was giving up, fixtures independent of the
compiled contract, turns out to be recoverable. It just has to be arranged rather than assumed.

## The ZK-specific footgun, which is unrelated to all of the above

A public input that appears in **no constraint** can be assigned a zero IC point by the Groth16
setup. If that happens the pairing check accepts any value in that slot, and the proof is not
bound to the transaction at all, no matter how carefully the script recomputes the scalar.

The bound circuit's `context` signal is exactly such an input: the script constrains its value,
so the circuit has no condition to impose on it. I checked whether this was live, and it was
not. snarkjs pads the QAP with a row per public input, `IC[1]` comes out as a nonzero point,
and editing `public.json` to `context + 1` makes `snarkjs groth16 verify` report an invalid
proof. Binding held.

But it held because of the compiler's behaviour, not because the circuit said so. So the circuit
now says so:

```circom
signal ctxSq;
ctxSq <== context * context;
```

One constraint, 415 to 416. Tornado Cash squares its `recipient` and `fee` inputs for the same
reason. If you write a bound circuit, do this with your context signal.

## Evidence

The reference unlock is `0x013b0946b00ac5db51da4342803b4c81f2460d72802852753b93f7b18b372f85`
on Pudge, block 23,029,477. The scalar the proof committed to was:

```
0x013b0946b00ac5db51da4342803b4c81f2460d72802852753b93f7b18b372f00
```

The same 31 bytes as the transaction it was spent in, differing only in the top byte the script
clears. The binding is legible in the hashes themselves.

That transaction matters because every test in this repository runs in `ckb-testtool` rather
than against a node, so nothing in the test suite can show `load_tx_hash()` behaving as
expected on the real VM, or the off-chain tooling agreeing with the script on the value.

## What generalises

Four of these are not about zero knowledge and apply to any CKB lock:

1. **A lock runs once per group of inputs sharing it.** `GroupInput[0]` is not "the cell being
   spent", it is the first of possibly many. Any lock that reasons about "the" input it is
   protecting has this bug until proven otherwise.
2. **A partial digest owes an explicit cardinality rule.** If you commit to a subset of the
   transaction, write down how many of each uncovered thing may appear, because the hash cannot.
   If the rule you would need is one you cannot live with, your digest is the wrong width.
3. **`tx_hash` excludes the witnesses.** This is the property that makes it possible to commit
   to a transaction from inside that transaction, whether you are signing or proving.
4. **Widening a digest to cover `cell_deps` couples your test fixtures to your deployed code.**
   Worth knowing before it surprises you, and worth the cost.

And one that is:

5. **An unconstrained public input may not bind.** Put it in a constraint, even a meaningless
   one, rather than relying on your toolchain to pad the QAP for you.

## Still open

The deployed `vk_hash` comes from a Groth16 setup with no MPC contribution round, so the
trapdoor is not provably unknown to anyone. That is a per-circuit phase 2 ceremony, and it is
the largest remaining honest limitation of this project. It is also the structural argument for
a universal-setup system: under Groth16, every adopter of a bring-your-own-circuit lock needs
their own ceremony, where one phase 1 would cover all of them.

Binding does not make a lock into a state machine. The circuit receives one opaque 32-byte
scalar it cannot decompose, so it cannot express "output 0 must keep capacity X" or "the
successor must carry this same lock". A lock runs only on spend and cannot constrain its own
creation, so invariants across a state transition belong to a type script. That was true of all
three answers above, and it is a separate piece of work.
