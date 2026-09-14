export interface GrantTokenCounter {
  readonly tokenizerId: string;
  count(text: string): number;
}

