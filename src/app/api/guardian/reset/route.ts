import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { resetGuardianStatus } from "@/lib/guardian";

export async function POST() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await resetGuardianStatus(currentUser.id);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reset Guardian state.",
      },
      { status: 400 },
    );
  }
}
