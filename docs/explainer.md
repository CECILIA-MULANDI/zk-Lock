# zk-Lock, explained without code

This page is for anyone who wants to understand what zk-Lock does and why it is
interesting, without reading Rust or knowing how CKB works. There is no code in
it. If you want the code, start with the [tutorial](tutorial.md).

**You can try it before reading any of this.** The [live demo](https://zk-lock.vercel.app/)
takes about a minute, needs no wallet and installs nothing. You type a secret
word, your browser proves you know it without revealing it, and that proof
spends real coins on a test blockchain. Everything below is an explanation of
what you just watched.

## The problem with proving you know something

Think about how you prove you know a password. You type it in. The other side
compares it to what it has stored, and now the other side knows your password
too. That is the deal every login makes: to prove you know the secret, you hand
over the secret.

Usually we paper over this. The website stores a scrambled version instead of
the real one, you are told not to reuse passwords, and everyone hopes the
database is never stolen. But the shape of the problem does not change. Proving
required revealing.

Zero-knowledge proofs are a way out of that shape. They let you prove that you
**know** something, without revealing what you know.

The distinction between knowing and being true is worth a moment, because it is
where the value sits. "Some word scrambles to this particular result" is almost
certainly true whether or not anybody knows that word, so proving it true would
tell you nothing. What the proof establishes is that the person who made it
actually has the word. That is the claim worth paying for.

And "revealing nothing" has one exception, by design rather than by accident.
Anything you choose to publish is published: in the demo, the scrambled form of
the word is public, because that is what the lock compares against. What the
proof adds is nothing further. The word itself stays with you.

## How that is possible, roughly

You run a calculation on your secret. The calculation produces a short piece of
evidence called a proof. For the circuit in this project it is 128 bytes, and
it stays that size no matter how big the statement being proved gets.

The maths behind it arranges two properties at once:

- **Only someone who knew the secret could produce a proof that passes.**
  Guessing your way to a passing proof is not feasible.
- **The proof reveals nothing about the secret.** It is not an encrypted copy
  of it. There is nothing in there to decrypt, and no way to work backwards.

Checking a proof is quick and anyone can do it. Producing one requires the
secret. That asymmetry is the whole trick.

It is worth being clear about what is doing the work here. This is not
obscurity, and it is not a promise that nobody has looked. It is a mathematical
argument that the proof cannot contain the information, in the same sense that
knowing a number is even tells you nothing about which even number it is.

## What zk-Lock does with that

Nearly all the coins on nearly every blockchain sit behind one question: can you
sign with the right private key? If you can, they move. The lock is about **who
you are**.

Locks that ask something else are not new, and it would be wrong to suggest
otherwise. Several chains, CKB among them, let you attach whatever condition you
like to a sum of money, and a condition such as "give me the word that scrambles
to this result" has been possible for many years.

The catch is that every one of those conditions is checked by **publishing the
thing it asks for**. You hand the word to the lock, the lock is public, and now
everybody watching has the word. If the same condition guards nine other sums of
money, the first person to open one has just unlocked the rest for everyone.

zk-Lock replaces the question with one that can be settled without the answer
being published: can you produce a valid proof for this statement? The lock is
about **what you can demonstrate**, and demonstrating it does not cost you the
secret.

Concretely, when you lock up some CKB with zk-Lock you attach a condition to
it. Later, anyone who can produce a proof satisfying that condition can spend
the coins. They never identify themselves and they never reveal the secret.
The network checks the proof and, if it holds, lets the coins move.

No signature is involved at any point. The proof is the authorization.

## Why not just use a normal lock?

This is the right question to ask, and for most purposes a normal lock is the
correct answer. It is simpler, cheaper, audited, and understood.

The difference shows up when the thing you want to express is not "this person
may spend" but "anyone who can demonstrate X may spend", and you do not know in
advance who that person will be, or you do not want them to have to prove who
they are.

A normal lock cannot express that. It names a key in advance. If you want to
pay whoever first solves a problem, you have to learn who they are, ask for an
address, and send it manually, which means you are the one deciding, and they
have to trust you to follow through.

With zk-Lock the condition itself holds the money. Nobody has to be trusted to
honour it, because the network enforces it.

The cost is real: you need a circuit for each statement, proofs take work to
produce, and the whole thing is far more machinery than a signature. It earns
its place only when the condition is the point.

## What you could use it for

These are the use cases the primitive actually enables, with what each one gets
you and how far along it is. Nothing here is a promise about a product; this is
a building block, and these are the things it is a building block for.

**A bounty that pays itself.** Lock funds behind "knows a solution to this
problem" and publish the problem. Whoever solves it takes the money by proving
they solved it.

*What that gets you:* you never learn who claimed it, you cannot change your
mind once the funds are locked, and the solver does not have to trust you to
pay. Nobody has to arrange a handover. Buildable today with what is in this
repository.

**A claim list where nobody learns who claimed.** Put a list of eligible people
into the condition. Each of them can prove they are on the list without
revealing which entry is theirs.

*What that gets you:* an allowlist or a giveaway where participation is private.
The chain records that someone eligible claimed, not who. The piece still
missing is a way to stop one person claiming twice, which needs a second
component this project has not built yet, so treat this one as the direction
rather than something you can ship this week.

**Proving you qualify without showing the document.** The condition can be any
calculation, so it can be "is over eighteen" or "holds at least this much" or
"has a credential from this issuer", checked without the underlying facts ever
being published.

*What that gets you:* the thing being checked stays private while the check
still happens. This is the case most people mean when they talk about privacy
on a blockchain, and it is the one that needs the most care, because a circuit
that leaks is worse than no circuit.

**A secret that survives being used.** Several locked coins can share one
condition, and spending one does not expose the secret, so the next person can
still use it.

*What that gets you:* exactly what the demo does, and it is the one case here
with no non-proof equivalent at all. For the reason, see the problem with
publishing the answer, further up. Many people unlock coins with the same word,
and the word never appears on the chain.

One property runs through all four. Because no signature is required, the person
claiming does not need to already own any coins, and the transaction fee comes
out of the locked amount. Normally you need coins to move coins, which is a hard
place for a newcomer to start. Here you need only the proof. That is why the
demo works with no wallet and nothing installed.

## What the demo shows

The demo in [`web/`](../web) locks real testnet CKB behind a single word. You
type the word, your browser does the proving, and you can watch what happens:

- The word is turned into a number and used to build a proof. This happens on
  your machine. No request carries the word.
- You are shown the exact 164 bytes that go to the blockchain, and the word
  written out in the same format, so you can look for it and confirm it is
  not there.
- The proof is checked against the same verifying key the on-chain script uses.
- If it is valid, the coins move, with no wallet and no signature.

Try a wrong word too. A wrong word still produces a perfectly valid proof, but
it proves a different statement, so the lock refuses it. That failure is worth
seeing, because it shows the lock is checking something specific rather than
just checking that a proof exists.

The whole thing takes about half a second of proving on an ordinary laptop, for
this very small circuit.

## The honest limits

Anyone evaluating this should know the following.

**It is not audited.** It runs on a test network with test coins. Do not put
anything you care about behind it.

**It depends on a trusted setup, and this one was not ceremonial.** The proof
system used here, Groth16, requires a one-time setup per circuit that produces
some secret randomness which must then be destroyed. Anyone who kept that
randomness can forge proofs for that circuit, including proofs of things that
are false. In production this is handled by a ceremony where many independent
people each contribute, so that the setup is safe as long as a single one of
them was honest.

This project's key has had no contributions at all. Whoever generated it could
have kept the randomness. That is fine for a demonstration on a test network
with a published secret, and it is not fine for anything else, so please read
the demo as a demonstration of mechanism rather than as a secure system.

**The simple version can be front-run.** With the basic script, the proof is not
tied to any particular transaction, so somebody watching the network could copy
your proof out of a pending transaction and redirect the coins to themselves.
A second version of the script, `zk-lock-bound`, fixes this by welding the proof
to one specific transaction, so a copied proof is useless. The demo
deliberately uses the simpler one, because this is exactly the question a
careful reader should arrive at on their own.

**Secrets are small.** In the demo the secret has to fit in 31 bytes, which is a
consequence of the number sizes the maths works with. Real uses hash a larger
input down first.

**Being anonymous takes more than this.** The proof does not say who you are,
and there is no signature to trace. But the transaction does say where the money
went, and that is public like everything else on a blockchain. If you send it
somewhere you have used before, anyone can join the two together. A private lock
is one piece of spending privately, not the whole of it.

## Where to go next

- The [tutorial](tutorial.md) builds the whole thing end to end, from a circuit
  to a locked and unlocked cell.
- The [encoding rationale](encoding-rationale.md) explains the byte layouts and
  which of those decisions are still open.
- The [demo README](../web/README.md) covers running the browser demo locally.
