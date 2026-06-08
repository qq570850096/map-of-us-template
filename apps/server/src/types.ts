import type { FastifyRequest } from "fastify";

export type AuthContext = {
  userId: string;
  spaceId: string;
  role: "owner" | "member";
};

export type AuthenticatedRequest = FastifyRequest & {
  auth: AuthContext;
};
