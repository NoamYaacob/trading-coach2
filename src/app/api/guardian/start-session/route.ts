import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { startTodayGuardianSession } from "@/lib/guardian";

export async function POST() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const session = await startTodayGuardianSession(currentUser.id);

    revalidatePath("/dashboard");
    revalidatePath("/guardian");

    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to start session.",
      },
      { status: 409 },
    );
  }
}
