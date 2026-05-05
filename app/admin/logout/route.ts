import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  cookies().delete(ADMIN_COOKIE);
  const url = new URL("/admin/login", req.url);
  return NextResponse.redirect(url, { status: 303 });
}
