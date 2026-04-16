import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { endTodayGuardianSession } from "@/lib/guardian";

export async function POST() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const session = await endTodayGuardianSession(currentUser.id);

    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to end session.",
      },
      { status: 409 },
    );
  }
}
