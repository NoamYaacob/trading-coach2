import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  sendProactiveCheckin,
  sendProactiveReview,
  sendInterventionAlert,
} from "@/lib/telegram-coach-push";
import type { CurrentInterventionEvent } from "@/lib/intervention-engine";

type PushRequest =
  | { type: "checkin" }
  | { type: "review" }
  | { type: "intervention"; event: CurrentInterventionEvent };

function isCronAuthed(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("x-cron-secret") === secret;
}

export async function POST(request: Request) {
  // Accept either a logged-in session (dashboard trigger) or CRON_SECRET (scheduler)
  const currentUser = await getCurrentUser();
  const cronAuthed = isCronAuthed(request);

  if (!currentUser && !cronAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PushRequest;
  try {
    body = (await request.json()) as PushRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // For CRON requests the userId must be supplied in the body.
  // For session requests it comes from the authenticated user.
  const bodyWithUserId = body as PushRequest & { userId?: string };
  const userId = currentUser?.id ?? bodyWithUserId.userId;

  if (!userId) {
    return NextResponse.json({ error: "missing_user_id" }, { status: 400 });
  }

  try {
    if (body.type === "checkin") {
      await sendProactiveCheckin(userId);
      return NextResponse.json({ ok: true, sent: true });
    }

    if (body.type === "review") {
      await sendProactiveReview(userId);
      return NextResponse.json({ ok: true, sent: true });
    }

    if (body.type === "intervention") {
      await sendInterventionAlert(userId, body.event);
      return NextResponse.json({ ok: true, sent: true });
    }

    return NextResponse.json({ error: "unknown_type" }, { status: 400 });
  } catch {
    // Log silently — the caller gets a 200 with sent: false so UI can show a notice
    return NextResponse.json({ ok: true, sent: false });
  }
}
