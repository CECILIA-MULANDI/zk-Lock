/**
 * The design's container: a centred 1600px column, applied per section so
 * full-bleed bands can still span the viewport behind it.
 *
 * The gutter grows with the viewport rather than sitting at a fixed 32px. On a
 * phone 24px is all the room there is, and on a wide screen a gutter that does
 * not grow lets the content run to the edges of its own container and stop
 * reading as a column at all.
 */
export const SHELL = "mx-auto w-full max-w-[1600px] px-[clamp(24px,5vw,96px)]";

export const REPO_URL = "https://github.com/CECILIA-MULANDI/zk-Lock";
