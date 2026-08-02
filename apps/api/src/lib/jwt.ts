import jwt from "jsonwebtoken";
import { z } from "zod";

const sessionClaimsSchema = z.object({
  locationId: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().min(1),
});

export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

export function signSessionToken(claims: SessionClaims, secret: string): string {
  return jwt.sign(claims, secret, { expiresIn: "12h" });
}

export function verifySessionToken(token: string, secret: string): SessionClaims {
  const decoded = jwt.verify(token, secret);
  return sessionClaimsSchema.parse(decoded);
}
