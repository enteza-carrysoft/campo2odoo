import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  appPassword,
  createSessionToken,
  passwordMatches,
} from "@/shared/lib/auth/session";

const loginSchema = z.object({ password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  const password = appPassword();
  if (!password) {
    return NextResponse.json(
      { error: "La app no tiene contraseña configurada (variable APP_PASSWORD)." },
      { status: 503 }
    );
  }

  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !(await passwordMatches(parsed.data.password, password))) {
    // Pausa ante fallos para frenar ataques de fuerza bruta.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
