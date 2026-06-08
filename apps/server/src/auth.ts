import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import argon2 from "argon2";
import { loginPayloadSchema } from "@map-of-us/shared";
import { prisma } from "./prisma.js";
import type { AuthenticatedRequest, AuthContext } from "./types.js";

type JwtPayload = AuthContext & {
  type: "access" | "refresh";
};

export async function hashPassword(password: string) {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await request.jwtVerify<JwtPayload>();
    if (payload.type !== "access") throw new Error("Invalid token type");
    (request as AuthenticatedRequest).auth = {
      userId: payload.userId,
      spaceId: payload.spaceId,
      role: payload.role,
    };
  } catch {
    return reply.code(401).send({ error: "Authentication required" });
  }
}

export async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
  const auth = (request as AuthenticatedRequest).auth;
  if (auth?.role !== "owner") return reply.code(403).send({ error: "Owner permission required" });
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    const payload = loginPayloadSchema.safeParse(request.body);
    if (!payload.success) return reply.code(400).send({ error: "Invalid login payload" });

    const user = await prisma.user.findUnique({
      where: { username: payload.data.username },
      include: {
        memberships: {
          include: { space: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!user || !(await verifyPassword(user.passwordHash, payload.data.password))) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    const membership = user.memberships[0];
    if (!membership) return reply.code(403).send({ error: "User has no space" });

    const authPayload = {
      userId: user.id,
      spaceId: membership.spaceId,
      role: membership.role,
    };
    const accessToken = app.jwt.sign({ ...authPayload, type: "access" }, { expiresIn: "30m" });
    const refreshToken = app.jwt.sign({ ...authPayload, type: "refresh" }, { expiresIn: "30d" });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, username: user.username, displayName: user.displayName },
      space: {
        id: membership.space.id,
        name: membership.space.name,
        slug: membership.space.slug,
        plan: membership.space.plan,
        status: membership.space.status,
        trialEndsAt: membership.space.trialEndsAt?.toISOString(),
      },
      membership: { role: membership.role },
    };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const body = request.body as { refreshToken?: unknown } | null;
    if (!body || typeof body.refreshToken !== "string") {
      return reply.code(400).send({ error: "Invalid refresh payload" });
    }

    try {
      const payload = app.jwt.verify<JwtPayload>(body.refreshToken);
      if (payload.type !== "refresh") throw new Error("Invalid token type");
      const accessToken = app.jwt.sign(
        { userId: payload.userId, spaceId: payload.spaceId, role: payload.role, type: "access" },
        { expiresIn: "30m" },
      );
      return { accessToken };
    } catch {
      return reply.code(401).send({ error: "Invalid refresh token" });
    }
  });

  app.post("/auth/logout", async () => ({ ok: true }));

  app.post("/auth/password", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthenticatedRequest).auth;
    const body = request.body as { newPassword?: unknown } | null;
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword.trim() : "";
    if (newPassword.length < 1 || newPassword.length > 128) {
      return reply.code(400).send({ error: "Password length must be 1-128" });
    }

    await prisma.user.update({
      where: { id: auth.userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    return { ok: true };
  });

  app.get("/me", { preHandler: requireAuth }, async (request) => {
    const auth = (request as AuthenticatedRequest).auth;
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_spaceId: { userId: auth.userId, spaceId: auth.spaceId } },
      include: { user: true, space: true },
    });

    return {
      user: {
        id: membership.user.id,
        username: membership.user.username,
        displayName: membership.user.displayName,
      },
      space: {
        id: membership.space.id,
        name: membership.space.name,
        slug: membership.space.slug,
        plan: membership.space.plan,
        status: membership.space.status,
        trialEndsAt: membership.space.trialEndsAt?.toISOString(),
      },
      membership: { role: membership.role },
    };
  });
}
