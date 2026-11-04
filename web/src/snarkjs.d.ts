// snarkjs 0.7.5 ships no type declarations. Only the surface the demo uses is
// declared here; widen it as more of snarkjs gets used.
declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, string | string[]>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{ proof: unknown; publicSignals: string[] }>;

    verify(
      verificationKey: unknown,
      publicSignals: string[],
      proof: unknown
    ): Promise<boolean>;
  };
}
