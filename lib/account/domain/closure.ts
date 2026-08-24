import { z } from "zod";
export const AccountClosureBlockerSchema = z.object({ authority: z.string().min(1), code: z.string().min(1), message: z.string().min(1), actionHref: z.string().startsWith("/").optional() });
export type AccountClosureBlocker = z.infer<typeof AccountClosureBlockerSchema>;
export interface AccountClosureAuthority { readonly id: string; inspect(ownerId: string): Promise<readonly AccountClosureBlocker[]>; }
export class AccountClosureReadinessService {
  private readonly authorities: readonly AccountClosureAuthority[];
  constructor(authorities: readonly AccountClosureAuthority[]) { this.authorities = authorities; }
  async inspect(ownerId: string) { const blockers = (await Promise.all(this.authorities.map((authority) => authority.inspect(ownerId)))).flat(); return { ready: blockers.length === 0, blockers } as const; }
}
