const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { UserRole, SubscriptionStatus, GuardianConnectionStatus, GuardianResetMode, GuardianLockoutReason, TraderCurrentState } = require('@prisma/client');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function buildSessionDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function upsertScenario(email, events, sessionData, guardianStatusData) {
  await prisma.dailySessionEvent.deleteMany({ where: { user: { email } } }).catch(() => {});
  await prisma.dailyGuardianSession.deleteMany({ where: { user: { email } } }).catch(() => {});
  await prisma.guardianStatus.deleteMany({ where: { user: { email } } }).catch(() => {});
  await prisma.guardianProfile.deleteMany({ where: { user: { email } } }).catch(() => {});
  await prisma.traderProfile.deleteMany({ where: { user: { email } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { user: { email } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email } }).catch(() => {});

  const passwordHash = await bcrypt.hash('Password123!', 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: UserRole.USER,
      subscriptionStatus: SubscriptionStatus.TRIALING,
      trialStartedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
      traderProfile: {
        create: {
          tradingExperience: '1-2 years',
          primaryMarket: 'Stocks',
          tradingStyle: 'Swing',
          experienceYears: 2,
          tradingDays: 'Mon-Fri',
          tradingSession: 'Morning',
          preferredSession: 'US market open',
          timezone: 'UTC',
        },
      },
      guardianProfile: {
        create: {
          guardianEnabled: true,
          platformName: 'Mock Platform',
          connectionStatus: GuardianConnectionStatus.MOCK_CONNECTED,
          maxTradesPerDay: 5,
          maxDailyLoss: 100.0,
          stopAfterConsecutiveLosses: 2,
          dailyProfitTarget: 200.0,
          copyTradeMode: false,
          resetMode: GuardianResetMode.DAILY,
          dailyResetHour: 9,
          dailyResetTimezone: 'UTC',
        },
      },
      guardianStatus: {
        create: {
          todayTradesCount: 0,
          todayPnL: 0,
          consecutiveLosses: 0,
          currentLockoutActive: false,
          lockoutReason: 'NONE',
        },
      },
    },
  });

  const now = new Date();
  const sessionDateKey = buildSessionDateKey(now);

  await prisma.dailyGuardianSession.create({
    data: {
      userId: user.id,
      sessionDateKey,
      source: 'dashboard',
      startedAt: sessionData.startedAt,
      endedAt: sessionData.endedAt,
      endedSource: sessionData.endedSource,
    },
  });

  if (guardianStatusData) {
    await prisma.guardianStatus.update({
      where: { userId: user.id },
      data: guardianStatusData,
    });
  }

  for (const ev of events) {
    await prisma.dailySessionEvent.create({
      data: {
        userId: user.id,
        source: ev.source,
        message: ev.message,
        detectedIntent: ev.detectedIntent,
        coachMode: ev.coachMode,
        traderState: ev.traderState,
        cooldownActive: ev.cooldownActive,
        metadataJson: ev.metadataJson || {},
      },
    });
  }

  console.log('Created', email);
}

async function main() {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 60 * 60 * 1000);
  const endedAt = new Date(now.getTime() - 30 * 60 * 1000);

  await upsertScenario(
    'quiet.day@example.com',
    [],
    {
      startedAt,
      endedAt,
      endedSource: 'dashboard',
    },
    null,
  );

  await upsertScenario(
    'emotional.pressure@example.com',
    [
      {
        source: 'telegram',
        message: 'Feeling urgent before a trade',
        detectedIntent: 'coach_interaction',
        coachMode: 'live',
        traderState: TraderCurrentState.FOMO,
        cooldownActive: false,
      },
      {
        source: 'telegram',
        message: 'Feeling calm again',
        detectedIntent: 'coach_interaction',
        coachMode: 'live',
        traderState: TraderCurrentState.CALM,
        cooldownActive: false,
      },
    ],
    {
      startedAt,
      endedAt,
      endedSource: 'dashboard',
    },
    null,
  );

  await upsertScenario(
    'guardian.intervention@example.com',
    [
      {
        source: 'telegram',
        message: 'I lost two trades and feel tilted',
        detectedIntent: 'coach_interaction',
        coachMode: 'live',
        traderState: TraderCurrentState.TILTED,
        cooldownActive: false,
      },
    ],
    {
      startedAt,
      endedAt,
      endedSource: 'dashboard',
    },
    {
      todayTradesCount: 5,
      todayPnL: -150.0,
      consecutiveLosses: 2,
      currentLockoutActive: true,
      lockoutReason: GuardianLockoutReason.MAX_DAILY_LOSS,
      lockoutStartedAt: new Date(now.getTime() - 20 * 60 * 1000),
      lockoutEndsAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      nextAllowedResetAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    },
  );

  await upsertScenario(
    'no.ended.session@example.com',
    [
      {
        source: 'telegram',
        message: 'Checking in before trading',
        detectedIntent: 'coach_interaction',
        coachMode: 'live',
        traderState: TraderCurrentState.PREMARKET_READY,
        cooldownActive: false,
      },
    ],
    {
      startedAt,
      endedAt: null,
      endedSource: null,
    },
    null,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
