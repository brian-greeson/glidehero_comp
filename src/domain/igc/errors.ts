export type IgcParseFailureCode =
  | 'missing_manufacturer'
  | 'missing_date'
  | 'invalid_date'
  | 'invalid_fix'
  | 'insufficient_fixes';

export class IgcParseError extends Error {
  constructor(public readonly code: IgcParseFailureCode) {
    super(code);
    this.name = 'IgcParseError';
  }
}
