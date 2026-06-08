import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth.js";
import { config } from "../src/config.js";

const prisma = new PrismaClient();

const space = await prisma.space.upsert({
  where: { slug: config.DEFAULT_SPACE_SLUG },
  create: {
    name: config.DEFAULT_SPACE_NAME,
    slug: config.DEFAULT_SPACE_SLUG,
  },
  update: {},
});

const users = [
  {
    username: config.DEFAULT_USER_1_USERNAME,
    password: config.DEFAULT_USER_1_PASSWORD,
    displayName: config.DEFAULT_USER_1_DISPLAY_NAME,
    role: "owner" as const,
  },
  {
    username: config.DEFAULT_USER_2_USERNAME,
    password: config.DEFAULT_USER_2_PASSWORD,
    displayName: config.DEFAULT_USER_2_DISPLAY_NAME,
    role: "member" as const,
  },
];

for (const item of users) {
  const user = await prisma.user.upsert({
    where: { username: item.username },
    create: {
      username: item.username,
      displayName: item.displayName,
      passwordHash: await hashPassword(item.password),
    },
    update: {
      displayName: item.displayName,
    },
  });

  await prisma.membership.upsert({
    where: { userId_spaceId: { userId: user.id, spaceId: space.id } },
    create: {
      userId: user.id,
      spaceId: space.id,
      role: item.role,
    },
    update: {
      role: item.role,
    },
  });
}

await prisma.$disconnect();
console.log(`[seed] created space ${space.slug} and ${users.length} users`);
