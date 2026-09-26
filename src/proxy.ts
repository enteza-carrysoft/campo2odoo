import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, appPassword, verifySessionToken } from "@/shared/lib/auth/session";

// Rutas accesibles sin sesión: la pantalla de acceso y su API.
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

/**
 * Toda la app exige sesión. Sin APP_PASSWORD, en desarrollo se deja pasar para
 * no estorbar; en producción se bloquea (falla cerrado) hasta configurarla.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const password = appPassword();
  if (!password && process.env.NODE_ENV !== "production") return NextResponse.next();

  const authorized = !!password && (await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, password));
  if (authorized) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sesión caducada: vuelve a entrar." }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
