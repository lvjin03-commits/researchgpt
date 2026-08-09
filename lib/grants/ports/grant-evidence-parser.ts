export type ParsedGrantEvidence = {
  text: string;
  originalLength: number;
  truncated: boolean;
};

export interface GrantEvidenceParser {
  parse(input: { buffer: Buffer; fileName: string }): Promise<ParsedGrantEvidence>;
}
